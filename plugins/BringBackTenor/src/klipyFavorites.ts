type Result = { url?: string; src?: string; gif_src?: string; retryAfter?: number };
type CacheEntry = { state: "queued" | "pending" | "resolved" | "missing"; src?: string; retryAfter?: number };

// The favorite proto stores only one source. Recent clients get both a preview
// and a GIF from Discord's search API; recover the exact matching GIF on demand.
export function createKlipyFavoriteResolver(http: any) {
    const cache = new Map<string, CacheEntry>();
    const listeners = new Set<() => void>();
    const queue: Array<{ url: string; query: string }> = [];
    let active = 0;
    let disposed = false;
    const notify = () => { if (!disposed) listeners.forEach(listener => listener()); };
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
    function pump() {
        while (!disposed && active < 3 && queue.length) {
            const job = queue.shift()!;
            const entry = cache.get(job.url)!;
            entry.state = "pending";
            active++;
            Promise.resolve().then(() => http.get({
                url: "/gifs/search",
                query: { q: job.query, provider: "klipy", media_format: "gif", limit: 100 },
                __bringBackTenorFavoriteLookup: true,
            })).then((response: any) => {
                if (disposed) return;
                const results: Result[] = Array.isArray(response?.body) ? response.body : [];
                const match = results.find(item => item && typeof item.url === "string" && samePage(item.url, job.url));
                if (match && isGif(match.src)) { entry.state = "resolved"; entry.src = match.src; }
                else { entry.state = "missing"; entry.retryAfter = Date.now() + 60000; }
            }, () => { if (!disposed) { entry.state = "missing"; entry.retryAfter = Date.now() + 60000; } }).then(() => {
                active--;
                if (!disposed) { notify(); pump(); }
            });
        }
    }
    return {
        resolve(pages: string[]) {
            if (disposed) return;
            for (const page of pages) {
                const previous = cache.get(page);
                if (previous && (previous.state !== "missing" || (previous.retryAfter ?? 0) > Date.now())) continue;
                const query = queryFor(page);
                if (!query) continue;
                cache.set(page, {state: "queued"});
                queue.push({url: page, query});
            }
            pump();
        },
        get(page: string) { return cache.get(page)?.src; },
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        dispose() { disposed = true; queue.length = 0; listeners.clear(); cache.clear(); },
    };
}
