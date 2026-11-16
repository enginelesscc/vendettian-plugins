import { findByProps } from "@vendetta/metro";
import { before, instead } from "@vendetta/patcher";
import { createGestureGuard } from "./gesture";

let patches: Array<() => void> = [];
let disposeGesture: (() => void) | undefined;

export default {
    onLoad() {
        const emitter = (globalThis as any).__fbBatchedBridge?._lazyCallableModules?.RCTEventEmitter?.();
        const links = findByProps("handleClick", "isLinkTrusted");
        if (typeof emitter?.receiveTouches !== "function" || typeof links?.handleClick !== "function") {
            console.warn("[LinkTapGuard] Touch or link handler not found");
            return;
        }
        const gesture = createGestureGuard();
        disposeGesture = () => gesture.dispose();
        try {
            patches.push(before("receiveTouches", emitter, ([name, touches, changed]) => {
                gesture.receive(name, touches, changed);
            }));
            patches.push(instead("handleClick", links, function (this: any, args, original) {
                if (gesture.shouldBlock()) return;
                return original.apply(this, args);
            }));
        } catch (error) {
            for (const unpatch of patches.splice(0).reverse()) unpatch();
            disposeGesture();
            disposeGesture = undefined;
            throw error;
        }
    },
    onUnload() {
        for (const unpatch of patches.splice(0).reverse()) unpatch();
        disposeGesture?.();
        disposeGesture = undefined;
    },
};
