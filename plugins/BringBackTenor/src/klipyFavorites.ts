type Result = { url?: string; src?: string; gif_src?: string };
type CacheEntry = { state: "queued" | "pending" | "resolved" | "missing"; query: string; attempts: number; src?: string; retryAfter?: number };

// The favorite proto stores only one source. Recent clients get both a preview
// and a GIF from Discord's search API; recover the exact matching GIF on demand.
export function createKlipyFavoriteResolver(http: any) {
    const cache = new Map<string, CacheEntry>();
    const listeners = new Set<() => void>();
    const queue: Array<{ url: string; query: string }> = [];
    let active = 0;
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const notify = () => {
        if (!disposed) listeners.forEach(listener => {
            try { listener(); } catch (error) { console.warn("[BringBackTenor] favorite refresh failed", error); }
        });
    };
    const queryFor = (page: string) => {
        try {
            const parsed = new URL(page);
            if (parsed.protocol !== "https:" || !/^(?:www\.)?klipy\.com$/i.test(parsed.hostname)) return null;
            const parts = parsed.pathname.split("/").filter(Boolean);
            if (parts.length !== 2 || parts[0] !== "gifs") return null;
            const query = decodeURIComponent(parts[1]).replace(/-/g, " ").trim();
            return query && query.length <= 200 ? query : null;
        } catch { return null; }
    };
    const samePage = (left: string, right: string) => {
        try {
            const a = new URL(left), b = new URL(right);
            return a.protocol === "https:" && b.protocol === "https:" &&
                /^(?:www\.)?klipy\.com$/i.test(a.hostname) && /^(?:www\.)?klipy\.com$/i.test(b.hostname) &&
                a.pathname.replace(/\/+$/, "") === b.pathname.replace(/\/+$/, "");
        } catch { return false; }
    };
    const isGif = (url: unknown): url is string => {
        if (typeof url !== "string") return false;
        try { const parsed = new URL(url); return parsed.protocol === "https:" && /\.gif$/i.test(parsed.pathname); }
        catch { return false; }
    };
    function scheduleRetry() {
        if (retryTimer !== undefined) clearTimeout(retryTimer);
        retryTimer = undefined;
        if (disposed || !listeners.size) return;
        let next = Infinity;
        for (const entry of cache.values()) {
            if (entry.state === "missing") next = Math.min(next, entry.retryAfter ?? Infinity);
        }
        if (next === Infinity) return;
        retryTimer = setTimeout(() => {
            retryTimer = undefined;
            if (disposed || !listeners.size) return;
            for (const [url, entry] of cache) {
                if (entry.state === "missing" && (entry.retryAfter ?? 0) <= Date.now()) {
                    entry.state = "queued";
                    queue.push({ url, query: entry.query });
                }
            }
            pump();
            scheduleRetry();
        }, Math.max(0, next - Date.now()));
    }
    function pump() {
        while (!disposed && active < 3 && queue.length) {
            const job = queue.shift()!;
            const entry = cache.get(job.url)!;
            entry.state = "pending";
            active++;
            runLookup(job, entry);
        }
    }
    // Older Hermes releases can reuse a loop's captured bindings. Give each
    // asynchronous lookup its own function activation and arguments.
    function runLookup(job: { url: string; query: string }, entry: CacheEntry) {
        Promise.resolve().then(() => http.get({
            url: "/gifs/search",
            query: { q: job.query, provider: "klipy", media_format: "gif", limit: 100 },
            __bringBackTenorFavoriteLookup: true,
        })).then((response: any) => {
            if (disposed) return;
            const results: Result[] = Array.isArray(response?.body) ? response.body : [];
            const match = results.find(item => item && typeof item.url === "string" && samePage(item.url, job.url));
            const src = [match?.src, match?.gif_src].find(isGif);
            if (src) { entry.state = "resolved"; entry.src = src; }
            else throw new Error("No matching GIF found");
        }).catch(() => {
            if (!disposed) {
                entry.state = "missing";
                entry.attempts++;
                entry.retryAfter = Date.now() + Math.min(5000 * 2 ** Math.min(entry.attempts - 1, 6), 300000);
            }
        }).then(() => {
            active--;
            if (!disposed) { if (entry.state === "resolved") notify(); pump(); scheduleRetry(); }
        });
    }
    return {
        resolve(pages: string[]) {
            if (disposed) return;
            for (const page of pages) {
                const previous = cache.get(page);
                if (previous && (previous.state !== "missing" || (previous.retryAfter ?? 0) > Date.now())) continue;
                const query = queryFor(page);
                if (!query) continue;
                cache.set(page, {state: "queued", query, attempts: previous?.attempts ?? 0});
                queue.push({url: page, query});
            }
            pump();
        },
        get(page: string) { return cache.get(page)?.src; },
        subscribe(listener: () => void) {
            listeners.add(listener);
            scheduleRetry();
            return () => { listeners.delete(listener); scheduleRetry(); };
        },
        dispose() {
            disposed = true;
            if (retryTimer !== undefined) clearTimeout(retryTimer);
            queue.length = 0; listeners.clear(); cache.clear();
        },
    };
}
