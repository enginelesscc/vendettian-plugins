import { findByProps } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { showConfirmationAlert } from "@vendetta/ui/alerts";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { showToast } from "@vendetta/ui/toasts";
import { toFavorite } from "./media";
import type { FavoriteGifs, FavoriteMedia } from "./media";

const actionSheet = findByProps("openLazy", "hideActionSheet");
const { addFavoriteGIF, removeFavoriteGIF } = findByProps("addFavoriteGIF", "removeFavoriteGIF");

export function toggleFavorite(media: FavoriteMedia, gifs: FavoriteGifs, isFavorite: boolean, filename: string) {
    actionSheet.hideActionSheet();

    const remove = () => {
        removeFavoriteGIF(media.url);
        showToast(`Removed ${filename} from Favorites`, getAssetIDByName("check"));
    };
    const add = () => {
        addFavoriteGIF(toFavorite(gifs, media));
        showToast(`Added ${filename} to Favorites`, getAssetIDByName("check"));
    };

    if (isFavorite) {
        if (storage.confirm) {
            showConfirmationAlert({
                title: "Remove from Favorites",
                content: `Are you sure you want to remove ${filename} from your favorites?`,
                confirmText: "Remove",
                cancelText: "Cancel",
                onConfirm: remove,
            });
        } else remove();
    } else if (media.isVideo) {
        showConfirmationAlert({
            title: "Add video to Favorites",
            content: "If a video is the first entry in the GIF picker, on mobile this breaks the picker until a new valid item is added or the video is removed. It will only show on Desktop.",
            confirmText: "Add to Favorites",
            cancelText: "Cancel",
            onConfirm: add,
        });
    } else if (storage.confirm) {
        showConfirmationAlert({
            title: "Add to Favorites",
            content: `Are you sure you want to add ${filename} to your favorites?`,
            confirmText: "Add to Favorites",
            cancelText: "Cancel",
            onConfirm: add,
        });
    } else add();
}

export function bumpFavorite(media: FavoriteMedia, gifs: FavoriteGifs, filename: string) {
    actionSheet.hideActionSheet();
    const bump = () => {
        removeFavoriteGIF(media.url);
        addFavoriteGIF(toFavorite(gifs, media));
        showToast(`Bumped ${filename} to the top of Favorites`, getAssetIDByName("check"));
    };

    if (storage.confirm) {
        showConfirmationAlert({
            title: "Bump Favorite",
            content: `Are you sure you want to bump ${filename} to the top of your favorites?`,
            confirmText: "Bump",
            onConfirm: bump,
        });
    } else bump();
}
