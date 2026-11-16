type SocketLike = {
    url?: string;
    readyState: number;
    addEventListener: (name: string, listener: () => void) => void;
    removeEventListener: (name: string, listener: () => void) => void;
};

export function createSocketWatcher(getDebuggerUrl: () => unknown, onChange: (connected: boolean) => void, openState: number) {
    let current: SocketLike | undefined;
    let disposed = false;
    const tracked = new Map<SocketLike, { open: () => void; end: () => void }>();

    function detach(socket: SocketLike) {
        const handlers = tracked.get(socket);
        if (!handlers) return;
        socket.removeEventListener("open", handlers.open);
        socket.removeEventListener("close", handlers.end);
        socket.removeEventListener("error", handlers.end);
        tracked.delete(socket);
    }

    function observe(socket: SocketLike, newlyCreated: boolean) {
        if (disposed || !socket || !getDebuggerUrl() || socket.url !== `ws://${getDebuggerUrl()}`) return;
        if (!newlyCreated && current && current !== socket) return;
        if (current !== socket) {
            if (current) detach(current);
            current = socket;
            onChange(socket.readyState === openState);
        }
        if (tracked.has(socket)) return;
        const handlers = {
            open: () => { if (!disposed && current === socket) onChange(true); },
            end: () => {
                if (current === socket) { current = undefined; onChange(false); }
                detach(socket);
            },
        };
        tracked.set(socket, handlers);
        socket.addEventListener("open", handlers.open);
        socket.addEventListener("close", handlers.end);
        socket.addEventListener("error", handlers.end);
    }

    return {
        observe,
        dispose() {
            disposed = true;
            for (const socket of tracked.keys()) detach(socket);
            current = undefined;
            onChange(false);
        },
    };
}
