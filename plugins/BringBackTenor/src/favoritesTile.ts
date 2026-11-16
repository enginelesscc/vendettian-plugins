import { after } from "@vendetta/patcher";
import { findByName, findByProps } from "@vendetta/metro";
import { React } from "@vendetta/metro/common";

export default function patchFavoritesTile() {
    const picker = findByProps("useFavoriteGIFCateogryMobile", "useFavoriteGIFsMobile");
    const favoritesType = findByProps("GIFPickerResultTypes")?.GIFPickerResultTypes?.FAVORITES;
    let itemView = findByName("GIFPickerItemView", false);

    // These Discord builds call GIFPickerItemView "c". Check the paired
    // picker module before using a numeric ID from a known bundle.
    const modules = (window as any).modules;
    for (const [pickerId, itemId] of [[4935, 4944], [4934, 4943]]) {
        if (itemView || !picker || modules?.[pickerId]?.publicModule?.exports !== picker) continue;
        const candidate = modules?.[itemId]?.publicModule?.exports;
        if (candidate?.default?.name === "c") itemView = candidate;
    }

    if (!itemView || favoritesType == null) {
        console.warn("[BringBackTenor] Favorites tile component not found; tile fix unavailable");
        return;
    }

    return after("default", itemView, ([props], tree) => {
        if (props?.item?.type !== favoritesType) return tree;

        // GIFPickerItemView renders [button, loadingView]. The loading view
        // covers the button until onLoad; failed/stalled images never clear it.
        const children = tree?.props?.children;
        if (!Array.isArray(children)) return tree;
        const [button, loadingView] = children;
        if (!React.isValidElement(button)) return tree;
        const buttonChildren = (button.props as any).children;
        if (!Array.isArray(buttonChildren)) return tree;
        const [image] = buttonChildren;
        if (!React.isValidElement(image) || typeof (image.props as any).onLoad !== "function") return tree;

        const imageProps = image.props as any;
        const safeImage = React.cloneElement(image, {
            onError: (...args: any[]) => {
                // Use the component's own setter to reveal its name on failure.
                imageProps.onLoad();
                imageProps.onError?.(...args);
            },
        } as any);
        const safeButton = React.cloneElement(button, {}, safeImage, ...buttonChildren.slice(1));
        // Allow navigation immediately, including when the request never ends.
        const safeLoadingView = React.isValidElement(loadingView)
            ? React.cloneElement(loadingView, { pointerEvents: "none" } as any)
            : loadingView;
        return React.cloneElement(tree, {}, safeButton, safeLoadingView, ...children.slice(2));
    });
}
