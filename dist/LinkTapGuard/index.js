(function(exports,metro,patcher){'use strict';const MAX_MOVEMENT_SQUARED = 100;
const LINK_EVENT_WINDOW_MS = 250;
// Discord invokes its link handler shortly after React Native finishes
// dispatching the touch event, so retain only a short-lived gesture outcome.
function createGestureGuard() {
    const touches = new Map();
    let last;
    function record(name, touch, time) {
        const id = touch?.identifier;
        if (id == null) return;
        if (name === "topTouchStart") {
            last = undefined;
            touches.set(id, {
                x: touch.pageX,
                y: touch.pageY,
                moved: false
            });
            return;
        }
        const state = touches.get(id);
        if (!state) return;
        if (Number.isFinite(state.x) && Number.isFinite(state.y) && Number.isFinite(touch.pageX) && Number.isFinite(touch.pageY)) {
            const dx = touch.pageX - state.x;
            const dy = touch.pageY - state.y;
            if (dx * dx + dy * dy > MAX_MOVEMENT_SQUARED) state.moved = true;
        }
        if (name === "topTouchEnd" || name === "topTouchCancel") {
            last = {
                blocked: name === "topTouchCancel" || state.moved,
                time
            };
            touches.delete(id);
        }
    }
    return {
        receive (name, all, changed, time = Date.now()) {
            if (!Array.isArray(all) || !Array.isArray(changed)) return;
            for (const index of changed){
                const touch = all[index];
                if (touch) record(name, touch, time);
            }
        },
        shouldBlock (time = Date.now()) {
            const age = last ? time - last.time : Infinity;
            return !!last?.blocked && age >= 0 && age < LINK_EVENT_WINDOW_MS;
        },
        dispose () {
            touches.clear();
            last = undefined;
        }
    };
}let patches = [];
let disposeGesture;
var index = {
    onLoad () {
        const emitter = globalThis.__fbBatchedBridge?._lazyCallableModules?.RCTEventEmitter?.();
        const links = metro.findByProps("handleClick", "isLinkTrusted");
        if (typeof emitter?.receiveTouches !== "function" || typeof links?.handleClick !== "function") {
            console.warn("[LinkTapGuard] Touch or link handler not found");
            return;
        }
        const gesture = createGestureGuard();
        disposeGesture = function() {
            return gesture.dispose();
        };
        try {
            patches.push(patcher.before("receiveTouches", emitter, function([name, touches, changed]) {
                gesture.receive(name, touches, changed);
            }));
            patches.push(patcher.instead("handleClick", links, function(args, original) {
                if (gesture.shouldBlock()) return;
                return original.apply(this, args);
            }));
        } catch (error) {
            for (const unpatch of patches.splice(0).reverse())unpatch();
            disposeGesture();
            disposeGesture = undefined;
            throw error;
        }
    },
    onUnload () {
        for (const unpatch of patches.splice(0).reverse())unpatch();
        disposeGesture?.();
        disposeGesture = undefined;
    }
};exports.default=index;Object.defineProperty(exports,'__esModule',{value:true});return exports;})({},vendetta.metro,vendetta.patcher);