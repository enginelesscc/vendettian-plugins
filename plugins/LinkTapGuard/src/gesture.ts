const MAX_MOVEMENT_SQUARED = 100;
const LINK_EVENT_WINDOW_MS = 250;

type Touch = { identifier?: number; pageX?: number; pageY?: number };
type TouchState = { x?: number; y?: number; moved: boolean };

// Discord invokes its link handler shortly after React Native finishes
// dispatching the touch event, so retain only a short-lived gesture outcome.
export function createGestureGuard() {
    const touches = new Map<number, TouchState>();
    let last: { blocked: boolean; time: number } | undefined;

    function record(name: string, touch: Touch, time: number) {
        const id = touch?.identifier;
        if (id == null) return;
        if (name === "topTouchStart") {
            last = undefined;
            touches.set(id, { x: touch.pageX, y: touch.pageY, moved: false });
            return;
        }
        const state = touches.get(id);
        if (!state) return;
        if (Number.isFinite(state.x) && Number.isFinite(state.y) &&
            Number.isFinite(touch.pageX) && Number.isFinite(touch.pageY)) {
            const dx = touch.pageX! - state.x!;
            const dy = touch.pageY! - state.y!;
            if (dx * dx + dy * dy > MAX_MOVEMENT_SQUARED) state.moved = true;
        }
        if (name === "topTouchEnd" || name === "topTouchCancel") {
            last = { blocked: name === "topTouchCancel" || state.moved, time };
            touches.delete(id);
        }
    }

    return {
        receive(name: string, all: Touch[], changed: number[], time = Date.now()) {
            if (!Array.isArray(all) || !Array.isArray(changed)) return;
            for (const index of changed) {
                const touch = all[index];
                if (touch) record(name, touch, time);
            }
        },
        shouldBlock(time = Date.now()) {
            const age = last ? time - last.time : Infinity;
            return !!last?.blocked && age >= 0 && age < LINK_EVENT_WINDOW_MS;
        },
        dispose() { touches.clear(); last = undefined; },
    };
}
