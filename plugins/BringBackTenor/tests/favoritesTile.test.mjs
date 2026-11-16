import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { transformSync } from "@swc/core";

const source = await readFile(new URL("../src/favoritesTile.ts", import.meta.url), "utf8");
const compiled = transformSync(source, {
    jsc: { parser: { syntax: "typescript" }, target: "es2020" },
    module: { type: "commonjs" },
}).code;

function setup(pickerId, itemId) {
    const picker = {};
    const item = { default: function c() {} };
    let callback;
    const modules = {
        [pickerId]: { publicModule: { exports: picker } },
        [itemId]: { publicModule: { exports: item } },
    };
    const React = {
        isValidElement: value => Boolean(value?.props),
        cloneElement: (element, props, ...children) => ({
            ...element,
            props: { ...element.props, ...props, ...(children.length ? { children } : {}) },
        }),
    };
    const imports = {
        "@vendetta/patcher": { after: (key, target, fn) => { assert.equal(target, item); callback = fn; return () => {}; } },
        "@vendetta/metro": { findByName: () => null, findByProps: key => key === "GIFPickerResultTypes" ? { GIFPickerResultTypes: { FAVORITES: "Favorites" } } : picker },
        "@vendetta/metro/common": { React },
    };
    const module = { exports: {} };
    new Function("require", "module", "exports", "window", compiled)(name => imports[name], module, module.exports, { modules });
    module.exports.default();
    return callback;
}

for (const [pickerId, itemId] of [[4935, 4944], [4934, 4943]]) {
    test(`unblocks the Favorites tile for picker module ${pickerId}`, () => {
        const patch = setup(pickerId, itemId);
        let loaded = 0;
        let errors = 0;
        const image = { props: { onLoad: () => loaded++, onError: () => errors++ } };
        const button = { props: { onPress: () => {}, children: [image, { props: {} }] } };
        const tree = { props: { children: [button, { props: { style: "overlay" } }] } };
        const result = patch([{ item: { type: "Favorites" } }], tree);
        assert.equal(result.props.children[1].props.pointerEvents, "none");
        result.props.children[0].props.children[0].props.onError();
        assert.equal(loaded, 1);
        assert.equal(errors, 1);
        assert.equal(patch([{ item: { type: "Other" } }], tree), tree);
    });
}
