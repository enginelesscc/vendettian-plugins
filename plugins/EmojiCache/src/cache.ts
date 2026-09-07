export interface CacheIO {
    exists(name: string): Promise<boolean>;
    read(name: string): Promise<string>;
    write(name: string, data: string, encoding: "utf8" | "base64"): Promise<void>;
    remove(name: string): Promise<void>;
    uri(name: string): string;
    download(url: string, signal: AbortSignal): Promise<{ data: string; bytes: number }>;
}

type Entry = { bytes: number; used: number };
type Job = {
    url: string; name: string; users: number; running: boolean;
    controller: AbortController; promise: Promise<string | null>;
    resolve(value: string | null): void;
};

const INDEX = "index.json";
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const LIMIT = 64 * 1024 * 1024;

// Exact, reversible filenames: no URL hash collisions or directory traversal.
export function cacheName(url: string): string {
    const extension = /\.(png|gif|webp)(?:\?|$)/.exec(url)?.[1] ?? "png";
    return `${url.replace(/[^a-zA-Z0-9-]/g, c => `_${c.charCodeAt(0).toString(16)}_`)}.${extension}`;
}

export function customEmojiURL(value: unknown): value is string {
    return typeof value === "string" && value.length < 180 &&
        /^https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/emojis\/\d+\.(?:png|gif|webp)(?:\?[a-zA-Z0-9_=&.-]*)?$/.test(value);
}

export function thumbnailURL(url: string, small: boolean, still: boolean): string {
    if (!customEmojiURL(url)) return url;
    if (small) url = url.replace(/([?&]size=)(\d+)(?=&|$)/, (s, prefix, size) => Number(size) > 64 ? `${prefix}64` : s);
    if (still) url = url.replace(/\.gif(?=\?|$)/, ".png");
    return url;
}

export class EmojiDiskCache {
    private entries: Record<string, Entry>;
    private jobs: Map<string, Job>;
    private queue: Job[];
    private active: number;
    private stopped: boolean;
    private saveTimer: ReturnType<typeof setTimeout> | undefined;
    private writes: Promise<void>;
    private ready: Promise<void>;
    // Serialize file writes, eviction, and index updates, including concurrent downloads.
    private commits: Promise<void>;
    stats: { hits: number; misses: number; failures: number };

    constructor(private io: CacheIO, private limit = LIMIT) {
        // This repo's SWC transform-classes configuration drops class-field
        // initializers. Explicit constructor assignments also work in Hermes.
        this.entries = {};
        this.jobs = new Map();
        this.queue = [];
        this.active = 0;
        this.stopped = false;
        this.writes = Promise.resolve();
        this.commits = Promise.resolve();
        this.stats = { hits: 0, misses: 0, failures: 0 };
        this.ready = this.load();
    }

    private async load() {
        try {
            const saved = JSON.parse(await this.io.read(INDEX));
            for (const [name, e] of Object.entries(saved) as [string, Entry][]) {
                if (/^[a-zA-Z0-9_-]+\.(png|gif|webp)$/.test(name) && name.length <= 240 && e && Number.isFinite(e.bytes) &&
                    e.bytes > 0 && e.bytes <= MAX_IMAGE_BYTES && Number.isFinite(e.used)) this.entries[name] = e;
            }
        } catch { /* A new cache or invalid index is an empty cache. */ }
    }

    private save() {
        if (this.saveTimer || this.stopped) return;
        this.saveTimer = setTimeout(() => {
            this.saveTimer = undefined;
            this.flush();
        }, 1000);
    }

    private flush() {
        const data = JSON.stringify(this.entries);
        this.writes = this.writes.then(() => this.io.write(INDEX, data, "utf8")).catch(() => {});
        return this.writes;
    }

    acquire(url: string): { promise: Promise<string | null>; release(): void } {
        if (this.stopped || !customEmojiURL(url) || cacheName(url).length > 240) return { promise: Promise.resolve(null), release() {} };
        let job = this.jobs.get(url);
        if (!job) {
            let resolve!: Job["resolve"];
            const promise = new Promise<string | null>(done => { resolve = done; });
            job = { url, name: cacheName(url), users: 0, running: false, controller: new AbortController(), promise, resolve };
            this.jobs.set(url, job);
            this.prepare(job).catch(() => { this.stats.failures++; this.finish(job!, null); });
        } else if (!job.running && this.queue.includes(job)) {
            this.queue = this.queue.filter(item => item !== job);
            this.queue.unshift(job);
        }
        job.users++;
        let released = false;
        return {
            promise: job.promise,
            release: () => {
                if (released) return;
                released = true;
                if (--job!.users === 0 && this.jobs.get(url) === job) {
                    job!.controller.abort();
                    this.jobs.delete(url);
                    this.queue = this.queue.filter(item => item !== job);
                    job!.resolve(null);
                }
            },
        };
    }

    private finish(job: Job, result: string | null) {
        if (this.jobs.get(job.url) === job) this.jobs.delete(job.url);
        job.resolve(result);
    }

    // Disk hits never wait for a network slot, including during a new search.
    private async prepare(job: Job) {
        await this.ready;
        const { signal } = job.controller;
        if (signal.aborted || this.stopped) return this.finish(job, null);
        const entry = this.entries[job.name];
        if (entry && await this.io.exists(job.name)) {
            if (signal.aborted || this.stopped) return this.finish(job, null);
            entry.used = Date.now();
            this.stats.hits++;
            this.save();
            return this.finish(job, this.io.uri(job.name));
        }
        delete this.entries[job.name];
        if (signal.aborted || this.stopped) return this.finish(job, null);
        this.queue.unshift(job);
        this.pump();
    }

    private pump() {
        while (!this.stopped && this.active < 4 && this.queue.length) {
            const job = this.queue.shift()!;
            if (!job.users || job.controller.signal.aborted) continue;
            this.active++;
            job.running = true;
            this.run(job).then(result => this.finish(job, result), () => {
                if (!job.controller.signal.aborted && !this.stopped) this.stats.failures++;
                this.finish(job, null);
            }).finally(() => {
                this.active--;
                this.pump();
            });
        }
    }

    private async run(job: Job): Promise<string | null> {
        const { signal } = job.controller;
        if (signal.aborted || this.stopped) return null;
        this.stats.misses++;
        const timeout = setTimeout(() => job.controller.abort(), 15000);
        let downloaded: { data: string; bytes: number };
        try { downloaded = await this.io.download(job.url, signal); }
        finally { clearTimeout(timeout); }
        if (signal.aborted || this.stopped) return null;
        if (!downloaded.bytes || downloaded.bytes > Math.min(MAX_IMAGE_BYTES, this.limit)) return null;
        const commit = this.commits.then(async () => {
            if (signal.aborted || this.stopped) return;
            let bytes = Object.values(this.entries).reduce((sum, e) => sum + e.bytes, 0);
            const oldest = Object.keys(this.entries).sort((a, b) => this.entries[a].used - this.entries[b].used);
            for (const name of oldest) {
                if (bytes + downloaded.bytes <= this.limit) break;
                // Keep an entry if deletion failed; never silently exceed the byte budget.
                await this.io.remove(name);
                bytes -= this.entries[name].bytes;
                delete this.entries[name];
            }
            await this.io.write(job.name, downloaded.data, "base64");
            this.entries[job.name] = { bytes: downloaded.bytes, used: Date.now() };
            this.save();
        });
        this.commits = commit.catch(() => {});
        await commit;
        return signal.aborted || this.stopped ? null : this.io.uri(job.name);
    }

    async invalidate(url: string) {
        const name = cacheName(url);
        const commit = this.commits.then(async () => {
            delete this.entries[name];
            await this.io.remove(name).catch(() => {});
            this.save();
        });
        this.commits = commit.catch(() => {});
        await commit;
    }

    async clear() {
        await this.ready;
        const commit = this.commits.then(async () => {
            for (const name of Object.keys(this.entries)) {
                if (await this.io.exists(name)) await this.io.remove(name);
                delete this.entries[name];
            }
            await this.flush();
        });
        this.commits = commit.catch(() => {});
        await commit;
    }

    async stop() {
        this.stopped = true;
        clearTimeout(this.saveTimer);
        for (const job of this.jobs.values()) { job.controller.abort(); job.resolve(null); }
        this.jobs.clear();
        this.queue.length = 0;
        await this.ready;
        await this.commits;
        await this.flush();
    }
}
