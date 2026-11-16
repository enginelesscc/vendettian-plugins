import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { transformSync } from "@swc/core";

const source = await readFile(new URL("../src/klipyFavorites.ts", import.meta.url), "utf8");
const compiled = transformSync(source, { jsc: { parser: { syntax: "typescript" }, target: "es2020" } });
const { createKlipyFavoriteResolver } = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`);
const page = "https://klipy.com/gifs/example-123";
const gif = "https://static.klipy.com/example.gif?token=test";
const flush = () => new Promise(resolve => setImmediate(resolve));

test("resolves a matching GIF, including gif_src when src is a video", async () => {
    const resolver = createKlipyFavoriteResolver({ get: async () => ({ body: [
        { url: "https://klipy.com/gifs/other", src: gif },
        { url: page, src: "https://static.klipy.com/example.mp4", gif_src: gif },
    ] }) });
    let updates = 0;
    resolver.subscribe(() => updates++);
    resolver.resolve([page]);
    await flush();
    assert.equal(resolver.get(page), gif);
    assert.equal(updates, 1);
    resolver.dispose();
});

test("keeps concurrent lookups attached to their own favorites", async () => {
    const pages = [1, 2, 3].map(id => `https://klipy.com/gifs/example-${id}`);
    const pending = new Map();
    const resolver = createKlipyFavoriteResolver({ get: ({ query }) => new Promise(resolve => {
        pending.set(query.q, resolve);
    }) });
    resolver.subscribe(() => {});
    resolver.resolve(pages);
    await flush();
    assert.equal(pending.size, 3);
    for (const id of [3, 1, 2]) {
        pending.get(`example ${id}`)({ body: [{ url: pages[id - 1], src: `https://static.klipy.com/${id}.gif` }] });
    }
    await flush();
    for (const [index, url] of pages.entries()) {
        assert.equal(resolver.get(url), `https://static.klipy.com/${index + 1}.gif`);
    }
    resolver.dispose();
});

test("retries a failed lookup while subscribed and stops after unsubscribe", async () => {
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const realNow = Date.now;
    let now = 1000;
    let nextId = 0;
    const timers = new Map();
    globalThis.setTimeout = (fn, delay) => { const id = ++nextId; timers.set(id, { fn, delay }); return id; };
    globalThis.clearTimeout = id => timers.delete(id);
    Date.now = () => now;
    let calls = 0;
    const resolver = createKlipyFavoriteResolver({ get: async () => {
        calls++;
        if (calls === 1) throw new Error("temporary failure");
        return { body: [{ url: page, src: gif }] };
    } });
    try {
        let unsubscribe = resolver.subscribe(() => {});
        resolver.resolve([page]);
        await flush();
        assert.equal(calls, 1);
        assert.equal([...timers.values()][0].delay, 5000);
        unsubscribe();
        assert.equal(timers.size, 0);
        unsubscribe = resolver.subscribe(() => {});
        assert.equal(timers.size, 1);
        const [id, timer] = [...timers][0];
        timers.delete(id);
        now += timer.delay;
        timer.fn();
        await flush();
        assert.equal(calls, 2);
        assert.equal(resolver.get(page), gif);
        unsubscribe();
        assert.equal(timers.size, 0);
    } finally {
        resolver.dispose();
        globalThis.setTimeout = realSetTimeout;
        globalThis.clearTimeout = realClearTimeout;
        Date.now = realNow;
    }
});
