(function(exports,patcher,metro,_vendetta,common){'use strict';// The favorite proto stores only one source. Recent clients get both a preview
// and a GIF from Discord's search API; recover the exact matching GIF on demand.
function createKlipyFavoriteResolver(http) {
    const cache = new Map();
    const listeners = new Set();
    const queue = [];
    let active = 0;
    let disposed = false;
    let retryTimer;
    const notify = function() {
        if (!disposed) listeners.forEach(function(listener) {
            try {
                listener();
            } catch (error) {
                console.warn("[BringBackTenor] favorite refresh failed", error);
            }
        });
    };
    const queryFor = function(page) {
        try {
            const parsed = new URL(page);
            if (parsed.protocol !== "https:" || !/^(?:www\.)?klipy\.com$/i.test(parsed.hostname)) return null;
            const parts = parsed.pathname.split("/").filter(Boolean);
            if (parts.length !== 2 || parts[0] !== "gifs") return null;
            const query = decodeURIComponent(parts[1]).replace(/-/g, " ").trim();
            return query && query.length <= 200 ? query : null;
        } catch  {
            return null;
        }
    };
    const samePage = function(left, right) {
        try {
            const a = new URL(left), b = new URL(right);
            return a.protocol === "https:" && b.protocol === "https:" && /^(?:www\.)?klipy\.com$/i.test(a.hostname) && /^(?:www\.)?klipy\.com$/i.test(b.hostname) && a.pathname.replace(/\/+$/, "") === b.pathname.replace(/\/+$/, "");
        } catch  {
            return false;
        }
    };
    const isGif = function(url) {
        if (typeof url !== "string") return false;
        try {
            const parsed = new URL(url);
            return parsed.protocol === "https:" && /\.gif$/i.test(parsed.pathname);
        } catch  {
            return false;
        }
    };
    function scheduleRetry() {
        if (retryTimer !== undefined) clearTimeout(retryTimer);
        retryTimer = undefined;
        if (disposed || !listeners.size) return;
        let next = Infinity;
        for (const entry of cache.values()){
            if (entry.state === "missing") next = Math.min(next, entry.retryAfter ?? Infinity);
        }
        if (next === Infinity) return;
        retryTimer = setTimeout(function() {
            retryTimer = undefined;
            if (disposed || !listeners.size) return;
            for (const [url, entry] of cache){
                if (entry.state === "missing" && (entry.retryAfter ?? 0) <= Date.now()) {
                    entry.state = "queued";
                    queue.push({
                        url,
                        query: entry.query
                    });
                }
            }
            pump();
            scheduleRetry();
        }, Math.max(0, next - Date.now()));
    }
    function pump() {
        while(!disposed && active < 3 && queue.length){
            const job = queue.shift();
            const entry = cache.get(job.url);
            entry.state = "pending";
            active++;
            runLookup(job, entry);
        }
    }
    // Older Hermes releases can reuse a loop's captured bindings. Give each
    // asynchronous lookup its own function activation and arguments.
    function runLookup(job, entry) {
        Promise.resolve().then(function() {
            return http.get({
                url: "/gifs/search",
                query: {
                    q: job.query,
                    provider: "klipy",
                    media_format: "gif",
                    limit: 100
                },
                __bringBackTenorFavoriteLookup: true
            });
        }).then(function(response) {
            if (disposed) return;
            const results = Array.isArray(response?.body) ? response.body : [];
            const match = results.find(function(item) {
                return item && typeof item.url === "string" && samePage(item.url, job.url);
            });
            const src = [
                match?.src,
                match?.gif_src
            ].find(isGif);
            if (src) {
                entry.state = "resolved";
                entry.src = src;
            } else throw new Error("No matching GIF found");
        }).catch(function() {
            if (!disposed) {
                entry.state = "missing";
                entry.attempts++;
                entry.retryAfter = Date.now() + Math.min(5000 * 2 ** Math.min(entry.attempts - 1, 6), 300000);
            }
        }).then(function() {
            active--;
            if (!disposed) {
                if (entry.state === "resolved") notify();
                pump();
                scheduleRetry();
            }
        });
    }
    return {
        resolve (pages) {
            if (disposed) return;
            for (const page of pages){
                const previous = cache.get(page);
                if (previous && (previous.state !== "missing" || (previous.retryAfter ?? 0) > Date.now())) continue;
                const query = queryFor(page);
                if (!query) continue;
                cache.set(page, {
                    state: "queued",
                    query,
                    attempts: previous?.attempts ?? 0
                });
                queue.push({
                    url: page,
                    query
                });
            }
            pump();
        },
        get (page) {
            return cache.get(page)?.src;
        },
        subscribe (listener) {
            listeners.add(listener);
            scheduleRetry();
            return function() {
                listeners.delete(listener);
                scheduleRetry();
            };
        },
        dispose () {
            disposed = true;
            if (retryTimer !== undefined) clearTimeout(retryTimer);
            queue.length = 0;
            listeners.clear();
            cache.clear();
        }
    };
}const { ScrollView } = metro.findByProps("ScrollView");
const { Stack } = metro.findByProps("Stack");
const { Text } = metro.findByProps("Text");
const { Pressable } = metro.findByProps("Pressable");
const { View } = metro.findByProps("View");
const GridQualities = [
    "gif",
    "tinygif",
    "nanogif"
];
const labels = {
    gif: {
        label: "GIF",
        subLabel: "Original quality, ~500px — slowest"
    },
    tinygif: {
        label: "TinyGIF",
        subLabel: "Small animated thumbnail, ~200px — default"
    },
    nanogif: {
        label: "NanoGIF",
        subLabel: "Tiny thumbnail, ~100px — fastest"
    }
};
const get = function(key, fallback) {
    return _vendetta.plugin.storage[key] ?? fallback;
};
const set = function(key, value) {
    _vendetta.plugin.storage[key] = value;
};
function BringBackTenorSettings() {
    const [, forceUpdate] = common.React.useReducer(function(x) {
        return ~x;
    }, 0);
    const gridQuality = get("gridQuality", "tinygif");
    return /*#__PURE__*/ common.React.createElement(ScrollView, {
        style: {
            flex: 1
        }
    }, /*#__PURE__*/ common.React.createElement(Stack, {
        style: {
            padding: 16
        },
        spacing: 16
    }, /*#__PURE__*/ common.React.createElement(Stack, {
        spacing: 8
    }, /*#__PURE__*/ common.React.createElement(Text, null, "Grid Quality"), GridQualities.map(function(q) {
        return /*#__PURE__*/ common.React.createElement(Pressable, {
            key: q,
            onPress: function() {
                set("gridQuality", q);
                forceUpdate();
            },
            style: {
                flexDirection: "row",
                alignItems: "center"
            }
        }, /*#__PURE__*/ common.React.createElement(View, {
            style: {
                width: 20,
                height: 20,
                borderRadius: 10,
                borderWidth: 2,
                alignItems: "center",
                justifyContent: "center",
                marginRight: 8
            }
        }, gridQuality === q && /*#__PURE__*/ common.React.createElement(View, {
            style: {
                width: 10,
                height: 10,
                borderRadius: 5
            }
        })), /*#__PURE__*/ common.React.createElement(Stack, null, /*#__PURE__*/ common.React.createElement(Text, null, labels[q].label), /*#__PURE__*/ common.React.createElement(Text, null, labels[q].subLabel)));
    }))));
}function patchFavoritesTile() {
    const picker = metro.findByProps("useFavoriteGIFCateogryMobile", "useFavoriteGIFsMobile");
    const favoritesType = metro.findByProps("GIFPickerResultTypes")?.GIFPickerResultTypes?.FAVORITES;
    let itemView = metro.findByName("GIFPickerItemView", false);
    // These Discord builds call GIFPickerItemView "c". Check the paired
    // picker module before using a numeric ID from a known bundle.
    const modules = window.modules;
    for (const [pickerId, itemId] of [
        [
            4935,
            4944
        ],
        [
            4934,
            4943
        ]
    ]){
        if (itemView || !picker || modules?.[pickerId]?.publicModule?.exports !== picker) continue;
        const candidate = modules?.[itemId]?.publicModule?.exports;
        if (candidate?.default?.name === "c") itemView = candidate;
    }
    if (!itemView || favoritesType == null) {
        console.warn("[BringBackTenor] Favorites tile component not found; tile fix unavailable");
        return;
    }
    return patcher.after("default", itemView, function([props], tree) {
        if (props?.item?.type !== favoritesType) return tree;
        // GIFPickerItemView renders [button, loadingView]. The loading view
        // covers the button until onLoad; failed/stalled images never clear it.
        const children = tree?.props?.children;
        if (!Array.isArray(children)) return tree;
        const [button, loadingView] = children;
        if (!common.React.isValidElement(button)) return tree;
        const buttonChildren = button.props.children;
        if (!Array.isArray(buttonChildren)) return tree;
        const [image] = buttonChildren;
        if (!common.React.isValidElement(image) || typeof image.props.onLoad !== "function") return tree;
        const imageProps = image.props;
        const safeImage = common.React.cloneElement(image, {
            onError: function(...args) {
                // Use the component's own setter to reveal its name on failure.
                imageProps.onLoad();
                imageProps.onError?.(...args);
            }
        });
        const safeButton = common.React.cloneElement(button, {}, safeImage, ...buttonChildren.slice(1));
        // Allow navigation immediately, including when the request never ends.
        const safeLoadingView = common.React.isValidElement(loadingView) ? common.React.cloneElement(loadingView, {
            pointerEvents: "none"
        }) : loadingView;
        return common.React.cloneElement(tree, {}, safeButton, safeLoadingView, ...children.slice(2));
    });
}const TENOR_KEY = "3Z0688EVWYKH";
const MAX_PAGES = 5;
const patches = [];
function tenorUrl(path, extra = {}) {
    return `https://api.tenor.com/v1/${path}?${new URLSearchParams({
        key: TENOR_KEY,
        ...extra
    })}`;
}
function pickMedia(m) {
    const q = _vendetta.plugin.storage.gridQuality ?? "tinygif";
    return m[q] || m.tinygif || m.gif || m.mp4 || m.webm;
}
function toDiscordGif(item) {
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
        preview: thumb.url
    };
}
function tenorFetch(path, extra = {}, signal) {
    return fetch(tenorUrl(path, extra), {
        signal
    }).then(function(r) {
        return r.ok ? r.json() : {
            results: [],
            next: ""
        };
    });
}
async function doSearch(query, limit = 50, signal, locale) {
    const all = [];
    const seen = new Set();
    let pos = "";
    let pages = 0;
    while(all.length < limit && pages < MAX_PAGES){
        pages++;
        const params = {
            q: query,
            limit: String(Math.min(limit - all.length, 50))
        };
        if (locale) params.locale = locale;
        if (pos) params.pos = pos;
        const { results, next } = await tenorFetch("search", params, signal);
        if (!results?.length) break;
        for (const item of results){
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
async function loadTrendingGIFs(limit = 1, locale, signal) {
    const params = {
        limit: String(limit)
    };
    if (locale) params.locale = locale;
    const { results } = await tenorFetch("trending", params, signal);
    return (results || []).map(toDiscordGif).filter(Boolean);
}
async function loadCategories(locale, signal) {
    try {
        const params = {
            type: "featured"
        };
        if (locale) params.locale = locale;
        const resp = await tenorFetch("categories", params, signal);
        const tags = resp.tags || resp.results || [];
        if (!tags.length) return null;
        return {
            categories: tags.map(function(t) {
                return {
                    name: t.searchterm,
                    src: t.image
                };
            })
        };
    } catch (e) {
        console.warn("[BringBackTenor] failed to load categories", e);
        return null;
    }
}
function makeThenable(p) {
    return p;
}
let lastSearchController = null;
let lastTrendingController = null;
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
    // Klipy favorites have a share-page URL as their key and a separate media
    // URL in src. The page itself is HTML and cannot be loaded by the picker.
    // Preserve the exact media URL, including any delivery query parameters.
    if (typeof alt === "string" && /^https?:\/\/(?:[^\/]+\.)?klipy\.com(?::\d+)?(?:[\/\?#]|$)/i.test(alt)) {
        return typeof url === "string" && url.length > 0 ? url : alt;
    }
    return url.includes("?") ? url : alt;
}
var index = {
    onLoad () {
        const defaults = {
            gridQuality: "tinygif"
        };
        for(const key in defaults){
            _vendetta.plugin.storage[key] = _vendetta.plugin.storage[key] ?? defaults[key];
        }
        const unpatchFavoritesTile = patchFavoritesTile();
        if (unpatchFavoritesTile) patches.push(unpatchFavoritesTile);
        const httpModule = metro.findByProps("get", "post", "put", "patch", "delete");
        if (!httpModule?.get) {
            console.warn("[BringBackTenor] HTTP module not found, plugin disabled");
            return;
        }
        const ProviderConfig = metro.findByProps("getProviderForAPIRequest");
        if (ProviderConfig) {
            patches.push(patcher.instead("getProviderForAPIRequest", ProviderConfig, function() {
                return "tenor";
            }));
        }
        const protoStore = metro.findByStoreName("UserSettingsProtoStore");
        const gifPicker = metro.findByProps("useFavoriteGIFsMobile");
        if (protoStore && gifPicker) {
            const resolver = createKlipyFavoriteResolver(httpModule);
            patches.push(function() {
                return resolver.dispose();
            });
            patches.push(patcher.instead("useFavoriteGIFsMobile", gifPicker, function() {
                const favorites = protoStore?.frecencyWithoutFetchingLatest?.favoriteGifs?.gifs ?? {};
                const entries = Object.entries(favorites).sort(function(a, b) {
                    return (b[1]?.order ?? 0) - (a[1]?.order ?? 0);
                });
                const pages = entries.filter(function([url, gif]) {
                    return /^https:\/\/(?:www\.)?klipy\.com\/gifs\//i.test(url) && !/\.gif(?:[?#]|$)/i.test(String(gif?.src ?? ""));
                }).map(function([url]) {
                    return url;
                });
                const signature = pages.join("\n");
                const [, refresh] = common.React.useReducer(function(n) {
                    return n + 1;
                }, 0);
                common.React.useEffect(function() {
                    return resolver.subscribe(function() {
                        return refresh();
                    });
                }, []);
                common.React.useEffect(function() {
                    resolver.resolve(pages);
                }, [
                    signature
                ]);
                return entries.map(function([url, gif]) {
                    return {
                        ...gif,
                        src: resolver.get(url) ?? getGIFSrc(gif.src, url),
                        url
                    };
                }).sort(function(a, b) {
                    return (b.order ?? 0) - (a.order ?? 0);
                });
            }));
        }
        patches.push(patcher.instead("get", httpModule, function(args, orig) {
            const opts = args[0];
            // This is our own Klipy favorite lookup; send it through Discord's
            // HTTP client instead of redirecting it to Tenor below.
            if (opts?.__bringBackTenorFavoriteLookup) {
                const request = {
                    ...opts
                };
                delete request.__bringBackTenorFavoriteLookup;
                return orig(request, ...args.slice(1));
            }
            if (!opts?.url || typeof opts.url !== "string") return orig(...args);
            const url = opts.url.toLowerCase();
            const q = opts.query?.q;
            const locale = opts.query?.locale?.replace?.("-", "_")?.toLowerCase();
            if (url.endsWith("/gifs/trending-search") || url.endsWith("/gifs/trending_search")) {
                return makeThenable(Promise.resolve({
                    body: []
                }));
            }
            if (url.endsWith("/gifs/trending-gifs") || url.endsWith("/gifs/trending_gifs")) {
                lastTrendingController?.abort();
                const controller = new AbortController();
                lastTrendingController = controller;
                const limit = opts.query?.limit || 50;
                return makeThenable(loadTrendingGIFs(limit, locale, controller.signal).then(function(gifs) {
                    return {
                        body: gifs
                    };
                }).catch(function() {
                    return {
                        body: []
                    };
                }));
            }
            if (url.endsWith("/gifs/search")) {
                lastSearchController?.abort();
                const controller = new AbortController();
                lastSearchController = controller;
                const limit = opts.query?.limit || 50;
                return makeThenable(doSearch(q || "", limit, controller.signal, locale).then(function(items) {
                    return {
                        body: items.map(toDiscordGif).filter(Boolean)
                    };
                }).catch(function() {
                    return {
                        body: []
                    };
                }));
            }
            if (url.endsWith("/gifs/trending")) {
                lastTrendingController?.abort();
                const controller = new AbortController();
                lastTrendingController = controller;
                return makeThenable(Promise.all([
                    loadCategories(locale, controller.signal),
                    loadTrendingGIFs(1, locale, controller.signal)
                ]).then(function([catData, gifs]) {
                    return {
                        body: {
                            categories: catData?.categories || [],
                            gifs: gifs.length ? gifs : [
                                {
                                    src: ""
                                }
                            ]
                        }
                    };
                }).catch(function() {
                    return {
                        body: {
                            categories: [],
                            gifs: [
                                {
                                    src: ""
                                }
                            ]
                        }
                    };
                }));
            }
            if (url.endsWith("/gifs/suggest")) {
                if (!q) return orig(...args);
                const suggestParams = {
                    q,
                    limit: "5"
                };
                if (locale) suggestParams.locale = locale;
                return makeThenable(tenorFetch("search_suggestions", suggestParams).then(function(r) {
                    return {
                        body: r.results || []
                    };
                }).catch(function() {
                    return {
                        body: []
                    };
                }));
            }
            if (url.endsWith("/gifs/select")) {
                const shareParams = {
                    id: q || "",
                    q: q || ""
                };
                if (locale) shareParams.locale = locale;
                fetch(tenorUrl("registershare", shareParams)).catch(function(e) {
                    console.warn("[BringBackTenor] register share failed", e);
                });
                return makeThenable(Promise.resolve({
                    body: {}
                }));
            }
            return orig(...args);
        }));
    },
    onUnload () {
        lastSearchController?.abort();
        lastSearchController = null;
        lastTrendingController?.abort();
        lastTrendingController = null;
        for (const p of patches){
            try {
                p();
            } catch (e) {
                console.warn("[BringBackTenor] failed to unpatch", e);
            }
        }
        patches.length = 0;
    },
    settings: BringBackTenorSettings
};exports.default=index;Object.defineProperty(exports,'__esModule',{value:true});return exports;})({},vendetta.patcher,vendetta.metro,vendetta,vendetta.metro.common);