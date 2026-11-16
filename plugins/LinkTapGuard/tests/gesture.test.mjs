import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { transformSync } from "@swc/core";

const source = await readFile(new URL("../src/gesture.ts", import.meta.url), "utf8");
const { code } = transformSync(source, { jsc: { parser: { syntax: "typescript" }, target: "es2020" } });
const { createGestureGuard } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const send = (guard, name, x, y, time, id = 1) => guard.receive(name, [{ identifier: id, pageX: x, pageY: y }], [0], time);

test("a normal tap and non-touch activation remain allowed", () => {
    const guard = createGestureGuard();
    assert.equal(guard.shouldBlock(0), false);
    send(guard, "topTouchStart", 30, 40, 100);
    send(guard, "topTouchEnd", 32, 41, 200);
    assert.equal(guard.shouldBlock(203), false);
});

test("canceled swipes and swipes that return to their start are blocked briefly", () => {
    const guard = createGestureGuard();
    send(guard, "topTouchStart", 30, 40, 100);
    send(guard, "topTouchCancel", 39, 40, 200);
    assert.equal(guard.shouldBlock(215), true);
    assert.equal(guard.shouldBlock(450), false);
    send(guard, "topTouchStart", 30, 40, 500);
    send(guard, "topTouchMove", 90, 40, 510);
    send(guard, "topTouchEnd", 30, 40, 520);
    assert.equal(guard.shouldBlock(523), true);
});

test("a new tap and disposal clear a prior canceled gesture", () => {
    const guard = createGestureGuard();
    send(guard, "topTouchStart", 0, 0, 10);
    send(guard, "topTouchCancel", 15, 0, 20);
    send(guard, "topTouchStart", 0, 0, 21);
    assert.equal(guard.shouldBlock(22), false);
    send(guard, "topTouchCancel", 0, 0, 23);
    guard.dispose();
    assert.equal(guard.shouldBlock(24), false);
});
