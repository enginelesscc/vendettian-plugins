import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { transformSync } from "@swc/core";

const source = await readFile(new URL("../src/socketWatcher.ts", import.meta.url), "utf8");
const { code } = transformSync(source, { jsc: { parser: { syntax: "typescript" }, target: "es2020" } });
const { createSocketWatcher } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

class Socket {
    constructor(url, readyState = 0) { this.url = url; this.readyState = readyState; this.listeners = new Map(); }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    removeEventListener(name, fn) { if (this.listeners.get(name) === fn) this.listeners.delete(name); }
    emit(name) { this.listeners.get(name)?.(); }
}

test("tracks only the debugger socket and follows open, close and reconnect", () => {
    const changes = [];
    const watcher = createSocketWatcher(() => "10.2.0.3:9090", value => changes.push(value), 1);
    const other = new Socket("wss://gateway.discord.gg", 1);
    watcher.observe(other, true);
    assert.deepEqual(changes, []);
    const first = new Socket("ws://10.2.0.3:9090");
    watcher.observe(first, true);
    first.readyState = 1;
    first.emit("open");
    const staleClose = first.listeners.get("close");
    const second = new Socket("ws://10.2.0.3:9090");
    watcher.observe(second, true);
    second.readyState = 1;
    second.emit("open");
    staleClose();
    assert.equal(changes.at(-1), true);
    second.emit("close");
    assert.equal(changes.at(-1), false);
    assert.equal(second.listeners.size, 0);
    watcher.dispose();
});

test("discovers an already-open debugger and removes listeners on disposal", () => {
    const changes = [];
    const watcher = createSocketWatcher(() => "10.2.0.3:9090", value => changes.push(value), 1);
    const socket = new Socket("ws://10.2.0.3:9090", 1);
    watcher.observe(socket, false);
    watcher.observe(socket, false);
    assert.deepEqual(changes, [true]);
    watcher.dispose();
    assert.equal(socket.listeners.size, 0);
    assert.deepEqual(changes, [true, false]);
    socket.emit("open");
    assert.deepEqual(changes, [true, false]);
});
