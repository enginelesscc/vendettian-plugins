import { instead } from "@vendetta/patcher";
import { findByProps, findByStoreName } from "@vendetta/metro";
import { plugin } from "@vendetta";

import Settings from "./settings";
import patchFavoritesTile from "./favoritesTile";

interface TenorMediaFormat {
    url: string;
    dims: number[];
    preview?: string;
    size?: number;
}

interface TenorMediaObject {
    gif?: TenorMediaFormat;
    tinygif?: TenorMediaFormat;
    nanogif?: TenorMediaFormat;
    mp4?: TenorMediaFormat;
    tinymp4?: TenorMediaFormat;
    nanomp4?: TenorMediaFormat;
    webm?: TenorMediaFormat;
    tinywebm?: TenorMediaFormat;
    nanowebm?: TenorMediaFormat;
    loopedmp4?: TenorMediaFormat;
    [key: string]: TenorMediaFormat | undefined;
}

interface TenorGifObject {
    id: string;
    title?: string;
    itemurl: string;
    media: TenorMediaObject[];
}

interface TenorSearchResponse {
    results?: TenorGifObject[];
    next?: string;
}

interface TenorCategory {
    searchterm: string;
    image: string;
}

interface TenorCategoriesResponse {
    tags?: TenorCategory[];
    results?: TenorCategory[];
}

const TENOR_KEY = "3Z0688EVWYKH";
const MAX_PAGES = 5;

const patches: (() => void)[] = [];

function tenorUrl(path: string, extra: Record<string, string> = {}) {
    return `https://api.tenor.com/v1/${path}?${new URLSearchParams({ key: TENOR_KEY, ...extra })}`;
}

function pickMedia(m: TenorMediaObject): TenorMediaFormat | undefined {
    const q: string = plugin.storage.gridQuality ?? "tinygif";
    return m[q] || m.tinygif || m.gif || m.mp4 || m.webm;
}

function toDiscordGif(item: TenorGifObject) {
    const m = item.media?.[0];
    if (!m) return null;
    const fmt = pickMedia(m);
    if (!fmt?.url) return null;
    const thumb = m.tinygif || m.nanogif || fmt;
    return {
        id: item.id,
        title: item.title || "",
        url: item.itemurl,
        src: fmt.url,
        gif_src: fmt.url,
        width: fmt.dims?.[0] || 0,
        height: fmt.dims?.[1] || 0,
        preview: thumb.url,
    };
}

function tenorFetch(path: string, extra: Record<string, string> = {}, signal?: AbortSignal) {
    return fetch(tenorUrl(path, extra), { signal }).then(r => r.ok ? r.json() : { results: [], next: "" });
}

async function doSearch(query: string, limit = 50, signal?: AbortSignal, locale?: string) {
    const all: TenorGifObject[] = [];
    const seen = new Set<string>();
    let pos = "";
    let pages = 0;
    while (all.length < limit && pages < MAX_PAGES) {
        pages++;
        const params: Record<string, string> = { q: query, limit: String(Math.min(limit - all.length, 50)) };
        if (locale) params.locale = locale;
        if (pos) params.pos = pos;
        const { results, next } = await tenorFetch("search", params, signal) as TenorSearchResponse;
        if (!results?.length) break;
        for (const item of results) {
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            all.push(item);
            if (all.length >= limit) break;
        }
        if (!next || next === pos) break;
        pos = next;
    }
    return all;
}

async function loadTrendingGIFs(limit = 1, locale?: string, signal?: AbortSignal) {
    const params: Record<string, string> = { limit: String(limit) };
    if (locale) params.locale = locale;
    const { results } = await tenorFetch("trending", params, signal) as TenorSearchResponse;
    return (results || []).map(toDiscordGif).filter(Boolean);
}

async function loadCategories(locale?: string, signal?: AbortSignal) {
    try {
        const params: Record<string, string> = { type: "featured" };
        if (locale) params.locale = locale;
        const resp = await tenorFetch("categories", params, signal) as TenorCategoriesResponse;
        const tags = resp.tags || resp.results || [];
        if (!tags.length) return null;
        return {
            categories: tags.map(t => ({ name: t.searchterm, src: t.image })),
        };
    } catch (e) {
        console.warn("[BringBackTenor] failed to load categories", e);
        return null;
    }
}

function makeThenable<T>(p: Promise<T>): Promise<T> {
    return p;
}

let lastSearchController: AbortController | null = null;
let lastTrendingController: AbortController | null = null;

function getGIFSrc(url, alt) {
	if (/(giphy\.com)/.test(alt)) {
        const match = /-(?:.(?!-))+$/.exec(alt);
        const id = match ? match[0].slice(1) : undefined;
        return `https://media.giphy.com/media/${id}/giphy.gif`;
    } else if (/(tenor\.com)/.test(alt)) {
        return alt + '.gif';
    } else if (/(imgur\.com)/.test(alt) && /i\.imgur\.com\/.*$/.test(url)) {
		const match = /i\.imgur\.com\/([^/.]+)(?=\.[a-z0-9]+(?:$|[?#]))/i.exec(url);
        const id = match ? match[0] : undefined;
        return `https://${id}.gif`;
    }
    return url.includes("?") ? url : alt;
}

export default {
    onLoad() {
        const defaults: Record<string, any> = {
            gridQuality: "tinygif",
        };
        for (const key in defaults) {
            plugin.storage[key] = plugin.storage[key] ?? defaults[key];
        }

        const unpatchFavoritesTile = patchFavoritesTile();
        if (unpatchFavoritesTile) patches.push(unpatchFavoritesTile);

        const httpModule = findByProps("get", "post", "put", "patch", "delete");
        if (!httpModule?.get) {
            console.warn("[BringBackTenor] HTTP module not found, plugin disabled");
            return;
        }

        const ProviderConfig = findByProps("getProviderForAPIRequest");
        if (ProviderConfig) {
            patches.push(instead("getProviderForAPIRequest", ProviderConfig, () => "tenor"));
        }

		const protoStore = findByStoreName("UserSettingsProtoStore");
		const gifPicker = findByProps("useFavoriteGIFsMobile");
		if (protoStore && gifPicker) {
			patches.push(instead("useFavoriteGIFsMobile", gifPicker, (args: any[], orig: Function) => {
				let gifs = Object.entries(protoStore?.frecencyWithoutFetchingLatest?.favoriteGifs?.gifs ?? {})
					.map(([alt, gif]) => ({ ...gif, src: getGIFSrc(gif.src, alt), url: alt }))
					.sort((a, b) => (b.order ?? 0) - (a.order ?? 0));
				return gifs;
			}));
		}

        patches.push(instead("get", httpModule, (args: any[], orig: Function) => {
                const opts = args[0];
                if (!opts?.url || typeof opts.url !== "string") return orig(...args);

                const url = opts.url.toLowerCase();
                const q = opts.query?.q;
                const locale = opts.query?.locale?.replace?.("-", "_")?.toLowerCase();
				
                if (url.endsWith("/gifs/trending-search") || url.endsWith("/gifs/trending_search")) {
                    return makeThenable(Promise.resolve({ body: [] }));
                }

                if (url.endsWith("/gifs/trending-gifs") || url.endsWith("/gifs/trending_gifs")) {
                    lastTrendingController?.abort();
                    const controller = new AbortController();
                    lastTrendingController = controller;
                    const limit = opts.query?.limit || 50;
                    return makeThenable(
                        loadTrendingGIFs(limit, locale, controller.signal)
                            .then(gifs => ({ body: gifs }))
                            .catch(() => ({ body: [] }))
                    );
                }

                if (url.endsWith("/gifs/search")) {
                    lastSearchController?.abort();
                    const controller = new AbortController();
                    lastSearchController = controller;
                    const limit = opts.query?.limit || 50;
                    return makeThenable(
                        doSearch(q || "", limit, controller.signal, locale)
                            .then(items => ({ body: items.map(toDiscordGif).filter(Boolean) }))
                            .catch(() => ({ body: [] }))
                    );
                }

                if (url.endsWith("/gifs/trending")) {
                    lastTrendingController?.abort();
                    const controller = new AbortController();
                    lastTrendingController = controller;
                    return makeThenable(
                        Promise.all([loadCategories(locale, controller.signal), loadTrendingGIFs(1, locale, controller.signal)])
                            .then(([catData, gifs]) => ({
                                body: {
                                    categories: catData?.categories || [],
                                    gifs: gifs.length ? gifs : [{ src: "" }]
                                }
                            }))
                            .catch(() => ({ body: { categories: [], gifs: [{ src: "" }] } }))
                    );
                }

                if (url.endsWith("/gifs/suggest")) {
                    if (!q) return orig(...args);
                    const suggestParams: Record<string, string> = { q, limit: "5" };
                    if (locale) suggestParams.locale = locale;
                    return makeThenable(
                        tenorFetch("search_suggestions", suggestParams)
                            .then(r => ({ body: r.results || [] }))
                            .catch(() => ({ body: [] }))
                    );
                }

                if (url.endsWith("/gifs/select")) {
                    const shareParams: Record<string, string> = { id: q || "", q: q || "" };
                    if (locale) shareParams.locale = locale;
                    fetch(tenorUrl("registershare", shareParams)).catch((e) => {
                        console.warn("[BringBackTenor] register share failed", e);
                    });
                    return makeThenable(Promise.resolve({ body: {} }));
                }

                return orig(...args);
            }),
        );
    },
    onUnload() {
        lastSearchController?.abort();
        lastSearchController = null;
        lastTrendingController?.abort();
        lastTrendingController = null;
        for (const p of patches) {
            try { p(); } catch (e) { console.warn("[BringBackTenor] failed to unpatch", e); }
        }
        patches.length = 0;
    },
    settings: Settings,
};
