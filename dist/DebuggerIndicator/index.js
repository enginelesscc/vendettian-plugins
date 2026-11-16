(function(exports,_vendetta,common,patcher){'use strict';function createSocketWatcher(getDebuggerUrl, onChange, openState) {
    let current;
    let disposed = false;
    const tracked = new Map();
    function detach(socket) {
        const handlers = tracked.get(socket);
        if (!handlers) return;
        socket.removeEventListener("open", handlers.open);
        socket.removeEventListener("close", handlers.end);
        socket.removeEventListener("error", handlers.end);
        tracked.delete(socket);
    }
    function observe(socket, newlyCreated) {
        if (disposed || !socket || !getDebuggerUrl() || socket.url !== `ws://${getDebuggerUrl()}`) return;
        if (!newlyCreated && current && current !== socket) return;
        if (current !== socket) {
            if (current) detach(current);
            current = socket;
            onChange(socket.readyState === openState);
        }
        if (tracked.has(socket)) return;
        const handlers = {
            open: function() {
                if (!disposed && current === socket) onChange(true);
            },
            end: function() {
                if (current === socket) {
                    current = undefined;
                    onChange(false);
                }
                detach(socket);
            }
        };
        tracked.set(socket, handlers);
        socket.addEventListener("open", handlers.open);
        socket.addEventListener("close", handlers.end);
        socket.addEventListener("error", handlers.end);
    }
    return {
        observe,
        dispose () {
            disposed = true;
            for (const socket of tracked.keys())detach(socket);
            current = undefined;
            onChange(false);
        }
    };
}let connected = false;
const listeners = new Set();
const patches = [];
let disposeWatcher;
function setConnected(value) {
    if (connected === value) return;
    connected = value;
    listeners.forEach(function(listener) {
        return listener();
    });
}
function Outline() {
    const [visible, setVisible] = common.React.useState(connected);
    common.React.useEffect(function() {
        const update = function() {
            return setVisible(connected);
        };
        listeners.add(update);
        update();
        return function() {
            listeners.delete(update);
        };
    }, []);
    if (!visible) return null;
    return /*#__PURE__*/ common.React.createElement(common.ReactNative.View, {
        pointerEvents: "none",
        accessible: false,
        importantForAccessibility: "no-hide-descendants",
        style: {
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            borderWidth: 2,
            borderColor: "#ff3030",
            zIndex: 99999
        }
    });
}
var index = {
    onLoad () {
        const container = common.NavigationNative?.NavigationContainer;
        const proto = WebSocket.prototype;
        if (typeof container?.render !== "function" || typeof proto?._registerEvents !== "function" || typeof proto?.send !== "function") {
            console.warn("[DebuggerIndicator] Required components are unavailable");
            return;
        }
        const watcher = createSocketWatcher(function() {
            return _vendetta.settings.debuggerUrl;
        }, setConnected, WebSocket.OPEN);
        disposeWatcher = function() {
            return watcher.dispose();
        };
        try {
            patches.push(patcher.after("render", container, function(_, tree) {
                if (!common.React.isValidElement(tree)) return tree;
                return /*#__PURE__*/ common.React.createElement(common.React.Fragment, null, tree, /*#__PURE__*/ common.React.createElement(Outline, null));
            }));
            patches.push(patcher.after("_registerEvents", proto, function(_args, result) {
                watcher.observe(this, true);
                return result;
            }));
            // A debugger may already be connected when the plugin is enabled.
            // Its next log send lets us discover that existing socket.
            patches.push(patcher.after("send", proto, function(_args, result) {
                watcher.observe(this, false);
                return result;
            }));
            console.log("[DebuggerIndicator] Ready");
        } catch (error) {
            for (const unpatch of patches.splice(0).reverse())unpatch();
            disposeWatcher();
            disposeWatcher = undefined;
            throw error;
        }
    },
    onUnload () {
        for (const unpatch of patches.splice(0).reverse())unpatch();
        disposeWatcher?.();
        disposeWatcher = undefined;
    }
};exports.default=index;Object.defineProperty(exports,'__esModule',{value:true});return exports;})({},vendetta,vendetta.metro.common,vendetta.patcher);