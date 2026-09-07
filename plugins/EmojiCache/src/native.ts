import { ReactNative as RN } from "@vendetta/metro/common";
import { CacheIO, MAX_IMAGE_BYTES } from "./cache";

const FOLDER = "vendetta_emoji_cache_v1";

export function nativeCacheIO(report: (reason: string) => void = () => {}): CacheIO | null {
    if (RN.Platform.OS !== "ios") {
        report(`Expected iOS; received ${RN.Platform.OS}`);
        return null;
    }
    // A present proxy (or legacy module stub) must not hide a working module
    // exposed through RN.NativeModules. Read each candidate independently.
    let fm: any;
    let documents: string | undefined;
    const failures: string[] = [];
    for (const provider of ["proxy", "RN"] as const) {
        for (const name of ["DCDFileManager", "RTNFileManager"]) {
            try {
                const modules = provider === "proxy" ? (window as any).nativeModuleProxy : RN.NativeModules;
                const candidate = modules?.[name];
                if (!candidate) continue;
                const missing = ["writeFile", "readFile", "fileExists"].filter(key => typeof candidate[key] !== "function");
                if (missing.length) {
                    failures.push(`${provider}.${name} missing ${missing.join(", ")}`);
                    continue;
                }
                const constants = typeof candidate.getConstants === "function" ? candidate.getConstants() : null;
                const path = constants?.DocumentsDirPath ?? candidate.DocumentsDirPath;
                const normalized = typeof path === "string" ? path.replace(/^file:\/\//, "").replace(/\/$/, "") : "";
                if (!normalized.startsWith("/")) {
                    failures.push(`${provider}.${name} has no absolute DocumentsDirPath`);
                    continue;
                }
                fm = candidate;
                documents = normalized;
                break;
            } catch {
                failures.push(`${provider}.${name} could not be read`);
            }
        }
        if (fm) break;
    }
    if (!fm || !documents) {
        report(failures.join("; ") || "DCDFileManager and RTNFileManager were not found");
        return null;
    }
    // Same RTN/DCD path distinction used by Vendetta's storage backend.
    const relative = (name: string) => `${fm.saveFileToGallery ? "" : "Documents/"}${FOLDER}/${name}`;
    const absolute = (name: string) => `${documents.replace(/\/$/, "")}/${FOLDER}/${name}`;
    return {
        exists: name => fm.fileExists(absolute(name)),
        read: name => fm.readFile(absolute(name), "utf8"),
        write: async (name, data, encoding) => { await fm.writeFile("documents", relative(name), data, encoding); },
        remove: async name => {
            if (typeof fm.removeFile === "function") {
                await fm.removeFile("documents", relative(name));
            } else {
                // Discord 180's iOS DCDFileManager exports no removeFile method.
                // Empty the payload instead: the index drops the entry, and a
                // future download of this URL overwrites the same filename.
                // Zero-byte file metadata remains, but evicted image bytes do not.
                await fm.writeFile("documents", relative(name), "", "utf8");
            }
        },
        uri: name => `file://${absolute(name)}`,
        async download(url, signal) {
            const response = await fetch(url, { signal, credentials: "omit" });
            if (!response.ok) throw new Error(`Emoji HTTP ${response.status}`);
            const type = response.headers.get("content-type") ?? "";
            if (!/^image\/(png|gif|webp)(?:;|$)/i.test(type)) throw new Error("Unexpected emoji response");
            if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) throw new Error("Emoji is too large");
            const blob = await response.blob();
            if (!blob.size || blob.size > MAX_IMAGE_BYTES || signal.aborted) throw new Error("Emoji download cancelled or too large");
            const data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                const abort = () => { reader.abort(); reject(new Error("Emoji download cancelled")); };
                reader.onload = () => {
                    const value = reader.result;
                    if (typeof value !== "string" || !value.includes(";base64,")) reject(new Error("Invalid image encoding"));
                    else resolve(value.slice(value.indexOf(",") + 1));
                };
                reader.onerror = () => reject(new Error("Could not read emoji bytes"));
                reader.onloadend = () => signal.removeEventListener("abort", abort);
                signal.addEventListener("abort", abort);
                if (signal.aborted) abort();
                else reader.readAsDataURL(blob);
            });
            return { data, bytes: blob.size };
        },
    };
}
