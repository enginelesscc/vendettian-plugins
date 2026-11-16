import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { transformSync } from "@swc/core";

const compile = async name => transformSync(await readFile(new URL(`../src/${name}.ts`, import.meta.url), "utf8"), {
    jsc: { parser: { syntax: "typescript" }, target: "es2020" }, module: { type: "commonjs" },
}).code;
const gestureModule = { exports: {} };
new Function("require", "module", "exports", await compile("gesture"))(() => {}, gestureModule, gestureModule.exports);
let touchHook, clickHook, removed = 0;
const emitter = { receiveTouches() {} };
const links = { handleClick() {}, isLinkTrusted() {} };
const imports = {
    "@vendetta/metro": { findByProps: () => links },
    "@vendetta/patcher": {
        before: (_name, target, cb) => { assert.equal(target, emitter); touchHook = cb; return () => removed++; },
        instead: (_name, target, cb) => { assert.equal(target, links); clickHook = cb; return () => removed++; },
    },
    "./gesture": gestureModule.exports,
};
const module = { exports: {} };
new Function("require", "module", "exports", await compile("index"))(name => imports[name], module, module.exports);
const plugin = module.exports.default;

test("only blocks the link handler after a canceled touch and removes both hooks", () => {
    const previousBridge = globalThis.__fbBatchedBridge;
    const previousNow = Date.now;
    let now = 100;
    Date.now = () => now;
    globalThis.__fbBatchedBridge = { _lazyCallableModules: { RCTEventEmitter: () => emitter } };
    try {
        plugin.onLoad();
        const touch = (name, x) => touchHook([name, [{ identifier: 1, pageX: x, pageY: 0 }], [0]]);
        const context = { calls: 0 };
        function original(value) { this.calls++; return value; }
        touch("topTouchStart", 0);
        touch("topTouchEnd", 1);
        assert.equal(clickHook.call(context, ["tap"], original), "tap");
        touch("topTouchStart", 0);
        touch("topTouchCancel", 12);
        now += 15;
        assert.equal(clickHook.call(context, ["swipe"], original), undefined);
        assert.equal(context.calls, 1);
        plugin.onUnload();
        assert.equal(removed, 2);
    } finally {
        Date.now = previousNow;
        globalThis.__fbBatchedBridge = previousBridge;
    }
});
