import { settings } from "@vendetta";
import { React, ReactNative as RN, NavigationNative } from "@vendetta/metro/common";
import { after } from "@vendetta/patcher";
import { createSocketWatcher } from "./socketWatcher";

let connected = false;
const listeners = new Set<() => void>();
const patches: Array<() => void> = [];
let disposeWatcher: (() => void) | undefined;

function setConnected(value: boolean) {
    if (connected === value) return;
    connected = value;
    listeners.forEach(listener => listener());
}

function Outline() {
    const [visible, setVisible] = React.useState(connected);
    React.useEffect(() => {
        const update = () => setVisible(connected);
        listeners.add(update);
        update();
        return () => { listeners.delete(update); };
    }, []);
    if (!visible) return null;
    return <RN.View
        pointerEvents="none"
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, borderWidth: 2, borderColor: "#ff3030", zIndex: 99999 }}
    />;
}

export default {
    onLoad() {
        const container = NavigationNative?.NavigationContainer as any;
        const proto = WebSocket.prototype as any;
        if (typeof container?.render !== "function" || typeof proto?._registerEvents !== "function" || typeof proto?.send !== "function") {
            console.warn("[DebuggerIndicator] Required components are unavailable");
            return;
        }
        const watcher = createSocketWatcher(() => settings.debuggerUrl, setConnected, WebSocket.OPEN);
        disposeWatcher = () => watcher.dispose();
        try {
            patches.push(after("render", container, (_, tree) => {
                if (!React.isValidElement(tree)) return tree;
                return <React.Fragment>{tree}<Outline /></React.Fragment>;
            }));
            patches.push(after("_registerEvents", proto, function (this: WebSocket, _args, result) {
                watcher.observe(this, true);
                return result;
            }));
            // A debugger may already be connected when the plugin is enabled.
            // Its next log send lets us discover that existing socket.
            patches.push(after("send", proto, function (this: WebSocket, _args, result) {
                watcher.observe(this, false);
                return result;
            }));
            console.log("[DebuggerIndicator] Ready");
        } catch (error) {
            for (const unpatch of patches.splice(0).reverse()) unpatch();
            disposeWatcher();
            disposeWatcher = undefined;
            throw error;
        }
    },
    onUnload() {
        for (const unpatch of patches.splice(0).reverse()) unpatch();
        disposeWatcher?.();
        disposeWatcher = undefined;
    },
};
