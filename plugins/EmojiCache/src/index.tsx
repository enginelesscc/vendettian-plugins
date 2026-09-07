import { findByProps, findByTypeName } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { React, ReactNative as RN } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { customEmojiURL, thumbnailURL, EmojiDiskCache } from "./cache";
import { nativeCacheIO } from "./native";

const patches: (() => void)[] = [];
let cache: EmojiDiskCache | undefined;
let enabled = false;
let status = "Not loaded";
let stopping: Promise<void> = Promise.resolve();
let generation = 0;
let renderers = new WeakMap<Function, Function>();

function CachedEmoji({ imageProps, fallback, url, diskCache }: any) {
    const [result, setResult] = React.useState<{ url: string; uri: string | null } | null>(null);
    React.useEffect(() => {
        let live = true;
        const request = diskCache.acquire(url);
        request.promise.then(uri => { if (live) setResult({ url, uri }); });
        return () => { live = false; request.release(); };
    }, [url, diskCache]);
    if (!enabled || (result?.url === url && !result.uri)) return fallback;
    const { placeholder, enableAnimation, source, ...props } = imageProps;
    const uri = result?.url === url ? result.uri : undefined;
    // Keep Discord's loading placeholder while fetching; do not start a duplicate
    // remote request through FastImage while the disk cache is downloading.
    if (!uri) return <RN.Image style={props.style} source={placeholder} resizeMode={props.resizeMode ?? "contain"} />;
    // Keep Discord's decoder (including WebP/animated images), but feed it a
    // persistent local file rather than another CDN request.
    return React.cloneElement(fallback, { source: { ...source, uri }, onError: (event: any) => {
        diskCache.invalidate(url);
        setResult({ url, uri: null });
        props.onError?.(event);
    }});
}

function patchList(tree: any) {
    if (!enabled || !React.isValidElement(tree)) return tree;
    const props = tree.props as any;
    if (!Array.isArray(props.sections) || typeof props.renderItem !== "function" || props.batchesToRender !== 12) return tree;
    let renderItem = renderers.get(props.renderItem);
    if (!renderItem) {
        const original = props.renderItem;
        renderItem = function(this: any, ...args: any[]) {
            const row = original.apply(this, args);
            if (!enabled || !storage.staticPicker || !React.isValidElement(row)) return row;
            const rowProps = row.props as any;
            if (!Array.isArray(rowProps.emojis) || !("animateEmoji" in rowProps)) return row;
            return React.cloneElement(row, { animateEmoji: false } as any);
        };
        renderers.set(props.renderItem, renderItem);
    }
    // FastList explicitly throws for values below 6 in this bundle.
    return React.cloneElement(tree, { batchesToRender: storage.lighterPicker ? 6 : 12, renderItem } as any);
}

export default {
    onLoad() {
        const currentGeneration = ++generation;
        // Vendetta does not await onLoad. Guard late startup and serialize with
        // the previous plugin instance's pending index write across toggles.
        stopping = (window as any).__emojiCacheShutdown ?? stopping;
        stopping.then(() => {
            if (currentGeneration !== generation) return;
            if (enabled) return;
            let fileFailure = "File API unavailable";
            const io = nativeCacheIO(reason => { fileFailure = reason; });
            const picker = findByTypeName("EmojiPickerList");
            const fastList = findByProps("FastListComputer", "AnimatedFastList");
            const modules = (window as any).modules;
            // FastImage's iOS memo function has no stable name. Gate its numeric ID
            // using TWO identified modules from the supplied 180.0 bundle.
            const image = picker && modules?.[4961]?.publicModule?.exports?.default === picker &&
                modules?.[3782]?.publicModule?.exports?.FastListComputer === fastList?.FastListComputer
                ? modules?.[2423]?.publicModule?.exports?.default : null;
            if (!io || typeof picker?.type !== "function" || typeof image?.type !== "function") {
                const failures = [];
                if (!io) failures.push(fileFailure);
                if (typeof picker?.type !== "function") failures.push("EmojiPickerList memo component not found");
                else if (typeof image?.type !== "function") failures.push("OTA 45365 FastImage module check failed");
                status = `Not active: ${failures.join("; ")}`;
                console.warn(`[EmojiCache] ${status}`);
                return;
            }
            storage.smallerThumbnails ??= true;
            storage.lighterPicker ??= true;
            storage.staticPicker ??= false;
            const diskCache = cache = new EmojiDiskCache(io);
            enabled = true;
            try {
                patches.push(after("type", picker, (_args, tree) => patchList(tree)));
                patches.push(after("type", image, ([props], tree) => {
                    if (!enabled || !customEmojiURL(props?.source?.uri)) return tree;
                    const style = RN.StyleSheet.flatten(props.style);
                    const small = typeof style?.width === "number" && typeof style?.height === "number" &&
                        style.width > 0 && style.height > 0 && style.width <= 48 && style.height <= 48;
                    const url = thumbnailURL(props.source.uri, small && storage.smallerThumbnails, props.enableAnimation === false);
                    return <CachedEmoji imageProps={props} fallback={tree} url={url} diskCache={diskCache} />;
                }));
                status = "Active — custom emoji disk cache";
                console.log(`[EmojiCache] ${status}`);
            } catch (error) {
                enabled = false;
                for (const unpatch of patches.splice(0).reverse()) unpatch();
                stopping = diskCache.stop();
                (window as any).__emojiCacheShutdown = stopping;
                throw error;
            }
        }).catch(error => {
            status = `Could not start: ${error instanceof Error ? error.message : String(error)}`;
            console.error("[EmojiCache]", error);
        });
    },
    onUnload() {
        generation++;
        enabled = false;
        for (const unpatch of patches.splice(0).reverse()) unpatch();
        renderers = new WeakMap();
        if (cache) stopping = cache.stop();
        (window as any).__emojiCacheShutdown = stopping;
        cache = undefined;
        status = "Unloaded";
    },
    settings: function EmojiCacheSettings() {
        useProxy(storage);
        const { FormSection, FormSwitchRow, FormText, FormRow } = findByProps("FormSection", "FormSwitchRow");
        const [clearStatus, setClearStatus] = React.useState("");
        return <RN.ScrollView>
            <FormSection title="Custom emoji cache">
                <FormText>{status}</FormText>
                <FormText>Stores up to 64 MiB on disk, with no time expiry. The least recently used images are removed when full. First downloads still depend on your connection.</FormText>
                <FormText>{`This session: ${cache?.stats.hits ?? 0} disk hits, ${cache?.stats.misses ?? 0} downloads, ${cache?.stats.failures ?? 0} failures. Reopen settings to refresh.`}</FormText>
                <FormSwitchRow label="Smaller custom emoji thumbnails" subLabel="Up to 64 pixels for small emoji images. May look softer on Retina displays." value={storage.smallerThumbnails ?? true} onValueChange={value => { storage.smallerThumbnails = value; }} />
                <FormSwitchRow label="Lighter emoji picker" subLabel="Render fewer offscreen rows to reduce competing image requests." value={storage.lighterPicker ?? true} onValueChange={value => { storage.lighterPicker = value; }} />
                <FormSwitchRow label="Static picker previews" subLabel="Optional: show still previews of animated custom emojis in the picker. Sent emojis keep their animation." value={storage.staticPicker ?? false} onValueChange={value => { storage.staticPicker = value; }} />
                <FormRow label="Clear saved emojis" subLabel={clearStatus || "Close the picker first. Cached files remain when the plugin is disabled."} onPress={async () => {
                    if (!cache) return;
                    setClearStatus("Clearing…");
                    try { await cache.clear(); setClearStatus("Saved emojis cleared."); }
                    catch { setClearStatus("Could not clear all files. Try again."); }
                }} />
                <FormText>Close and reopen the picker after changing settings. Twemoji, local emojis, and non-emoji images keep their existing renderer.</FormText>
            </FormSection>
        </RN.ScrollView>;
    },
};
