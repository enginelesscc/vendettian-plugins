import { readFile, writeFile, readdir, exists, mkdir } from "fs/promises";
import { extname } from "path";
import { createHash } from "crypto";

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from "@noble/hashes/utils.js";

import { rollup } from "rollup";
import esbuild from "rollup-plugin-esbuild";
import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import swc from "@swc/core";

const extensions = [".js", ".jsx", ".mjs", ".ts", ".tsx", ".cts", ".mts"];

/** @type import("rollup").InputPluginOption */
const plugins = [
    nodeResolve(),
    commonjs(),
    {
        name: "swc",
        async transform(code, id) {
            const ext = extname(id);
            if (!extensions.includes(ext)) return null;

            const ts = ext.includes("ts");
            const tsx = ts ? ext.endsWith("x") : undefined;
            const jsx = !ts ? ext.endsWith("x") : undefined;

            const result = await swc.transform(code, {
                filename: id,
                jsc: {
                    externalHelpers: true,
                    parser: {
                        syntax: ts ? "typescript" : "ecmascript",
                        tsx,
                        jsx,
                    },
                },
                env: {
                    targets: "defaults",
                    include: [
                        "transform-classes",
                        "transform-arrow-functions",
                    ],
                },
            });
            return result.code;
        },
    },
    esbuild({ minify: true }),
];

function normalizeSha256(hash) {
	const normalized = hash.trim().toLowerCase();
	return normalized.startsWith("sha256-") ? normalized.slice("sha256-".length) : normalized;
}

function signPluginHash(hash) {
	const PRIVATE_KEY = process.env.VENDETTA_SIGN_KEY;
	ed.hashes.sha512 = sha512;
	const message = new TextEncoder().encode(hash);
	const signature = ed.sign(message, Uint8Array.fromBase64(PRIVATE_KEY));
	return signature.toBase64();
}

for (let plug of await readdir("./plugins")) {
    const manifest = JSON.parse(await readFile(`./plugins/${plug}/manifest.json`));
    const outPath = `./dist/${plug}/index.js`;

    try {
        const bundle = await rollup({
            input: `./plugins/${plug}/${manifest.main}`,
            onwarn: () => {},
            plugins,
        });
    
        await bundle.write({
            file: outPath,
            globals(id) {
                if (id.startsWith("@vendetta")) return id.substring(1).replace(/\//g, ".");
                const map = {
                    react: "window.React",
                };

                return map[id] || null;
            },
            format: "iife",
            compact: true,
            exports: "named",
        });
        await bundle.close();
    
		const toHash = await readFile(outPath);
		manifest.hash = createHash("sha256").update(toHash).digest("hex");
		manifest.signature = signPluginHash(manifest.hash);
		manifest.main = "index.js";
		await writeFile(`./dist/${plug}/manifest.json`, JSON.stringify(manifest));
    
        console.log(`Successfully built ${manifest.name}!`);
    } catch (e) {
        console.error("Failed to build plugin...", e);
        process.exit(1);
    }
}

for (let signer of await readdir("./resigners")) {
    const manifest = JSON.parse(await readFile(`./resigners/${signer}/manifest.json`));
    const outPath = `./dist/${signer}/index.js`;
	manifest.signature = signPluginHash(manifest.hash);
	manifest.main = "index.js";
	if (!await exists(`./dist/${signer}`)){
		await mkdir(`./dist/${signer}`);
	}
	await writeFile(`./dist/${signer}/manifest.json`, JSON.stringify(manifest));
	console.log(`Successfully signed ${manifest.name}!`);
}