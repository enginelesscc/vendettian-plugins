import { findByProps, findByStoreName } from "@vendetta/metro";
import { React } from "@vendetta/metro/common";
import { after, before } from "@vendetta/patcher";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { findInReactTree } from "@vendetta/utils";
import { bumpFavorite, toggleFavorite } from "./actions";
import { FavoriteRow, Settings } from "./components";
import { getFilename, getHighestOrder, getMessageMedia } from "./media";
import type { FavoriteGifs, MediaMessage } from "./media";

const actionSheet = findByProps("openLazy", "hideActionSheet");
const settingsStore = findByStoreName("UserSettingsProtoStore");
const sheetPatches = new Set<() => void>();
let unpatchOpenLazy: (() => void) | undefined;
let loadGeneration = 0;

export default {
    onLoad() {
        const generation = ++loadGeneration;
        unpatchOpenLazy = before("openLazy", actionSheet, ([component, key, options]) => {
            const message: MediaMessage | undefined = options?.message;
            if (key !== "MessageLongPressActionSheet" || !message) return;

            component.then(sheet => {
                // A lazy sheet can finish loading after the plugin is disabled.
                if (generation !== loadGeneration) return;

                const unpatch = after("default", sheet, (_args, tree) => {
                    React.useEffect(() => () => {
                        unpatch();
                        sheetPatches.delete(unpatch);
                    }, []);

                    const rows = findInReactTree(tree, node => node?.[0]?.type?.name === "ButtonRow");
                    if (!rows) return tree;

                    for (const media of getMessageMedia(message)) {
                        const gifs: FavoriteGifs = settingsStore.frecencyWithoutFetchingLatest.favoriteGifs.gifs;
                        const highestOrder = getHighestOrder(gifs);
                        const isFavorite = gifs[media.src] !== undefined || gifs[media.url] !== undefined;
                        const isFirst = gifs[media.src]?.order === highestOrder || gifs[media.url]?.order === highestOrder;
                        const filename = getFilename(media.url);

                        rows.unshift(React.createElement(FavoriteRow, {
                            label: isFavorite ? `Remove ${filename} from Favorites` : `Add ${filename} to Favorites`,
                            icon: getAssetIDByName(isFavorite ? "ic_clear" : "ic_star_filled"),
                            onPress: () => toggleFavorite(media, gifs, isFavorite, filename),
                        }));

                        if (isFavorite && !isFirst) {
                            rows.unshift(React.createElement(FavoriteRow, {
                                label: `Bump ${filename} to the top of Favorites`,
                                icon: getAssetIDByName("ic_activity_24px"),
                                onPress: () => bumpFavorite(media, gifs, filename),
                            }));
                        }
                    }

                    return tree;
                });
                sheetPatches.add(unpatch);
            });
        });
    },
    onUnload() {
        loadGeneration++;
        unpatchOpenLazy?.();
        unpatchOpenLazy = undefined;
        for (const unpatch of sheetPatches) unpatch();
        sheetPatches.clear();
    },
    settings: Settings,
};
