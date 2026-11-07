import * as esbuild from "esbuild-wasm";
import wasmURL from "esbuild-wasm/esbuild.wasm?url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Files } from "./zip";
import { HOST_NAMES, makeHost, type CompMeta, type Ctx } from "./host";

let ready: Promise<void> | null = null;
const init = () => (ready ??= (async () => {
  // In the single-file (offline) build the wasm arrives as a data: URI — hand esbuild a compiled module instead of a URL.
  if (wasmURL.startsWith("data:")) {
    const buf = await (await fetch(wasmURL)).arrayBuffer();
    await esbuild.initialize({ wasmModule: await WebAssembly.compile(buf), worker: true });
  } else {
    await esbuild.initialize({ wasmURL, worker: true });
  }
})());

const dec = new TextDecoder();
const dirname = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const norm = (p: string) => { const out: string[] = []; for (const s of p.split("/")) { if (!s || s === ".") continue; if (s === "..") out.pop(); else out.push(s); } return out.join("/"); };
const EXTS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"];
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", avif: "image/avif", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf", json: "application/json", txt: "text/plain" };
const ext = (p: string) => p.slice(p.lastIndexOf(".") + 1).toLowerCase();

export type Loaded = { comps: CompMeta[]; revoke: () => void; warnings: string[] };

export async function loadProject(files: Files, entry: string): Promise<Loaded> {
  await init();
  const urls = new Map<string, string>();
  const blobUrl = (path: string) => {
    let u = urls.get(path); if (u) return u;
    const data = files.get(path)!; u = URL.createObjectURL(new Blob([data as BlobPart], { type: MIME[ext(path)] || "application/octet-stream" })); urls.set(path, u); return u;
  };
  const ctx: Ctx = { root: null, comps: [], missing: new Set(), url: (p: string) => {
    const clean = decodeURIComponent(p).replace(/^\/+/, "").replace(/^public\//, "");
    if (files.has("public/" + clean)) return blobUrl("public/" + clean);
    ctx.missing.add(p); return p;
  } };
  const resolveFile = (base: string) => { for (const c of [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => base + "/index" + e)]) if (files.has(c)) return c; return null; };

  const plugin: esbuild.Plugin = {
    name: "vfs",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => {
        if (a.path === "__entry__") return { path: entry, namespace: "vfs" };
        if (a.path.startsWith(".") || a.path.startsWith("/")) {
          const base = a.path.startsWith("/") ? norm(a.path) : norm(dirname(a.importer) + "/" + a.path);
          const f = resolveFile(base); if (f) return { path: f, namespace: "vfs" };
          return { errors: [{ text: `File not found: ${a.path} (imported from ${a.importer})` }] };
        }
        if (HOST_NAMES.has(a.path)) return { path: a.path, external: true };
        const pkg = a.path.startsWith("@") ? a.path.split("/").slice(0, 2).join("/") : a.path.split("/")[0];
        return { errors: [{ text: `The package “${a.path}” isn’t available in the browser build yet (${pkg}). Supported: remotion, react, @remotion/transitions, shapes, paths, noise, layout-utils, lottie, zod.` }] };
      });
      b.onLoad({ filter: /.*/, namespace: "vfs" }, (a) => {
        const data = files.get(a.path)!, e = ext(a.path);
        if (e === "ts" || e === "tsx" || e === "js" || e === "jsx" || e === "json") return { contents: dec.decode(data), loader: e as any };
        if (e === "mjs") return { contents: dec.decode(data), loader: "js" };
        if (e === "css") return { contents: "", loader: "js" };
        if (e === "txt" || e === "md") return { contents: dec.decode(data), loader: "text" };
        return { contents: `export default ${JSON.stringify(blobUrl(a.path))};`, loader: "js" };
      });
    },
  };
  let out;
  try {
    out = await esbuild.build({ entryPoints: ["__entry__"], bundle: true, write: false, format: "cjs", platform: "browser", target: "es2020", jsx: "automatic", plugins: [plugin], logLevel: "silent",
      define: { "process.env.NODE_ENV": '"production"' } });
  } catch (e: any) {
    const msgs = (e.errors || []).map((x: any) => x.text + (x.location ? `  (${x.location.file}:${x.location.line})` : ""));
    throw new Error(msgs.length ? msgs.join("\n") : String(e.message || e));
  }
  const code = out.outputFiles[0].text, host = makeHost(ctx);
  const mod: any = { exports: {} };
  new Function("require", "module", "exports", code)((n: string) => { if (!(n in host)) throw new Error("Missing host module " + n); return host[n]; }, mod, mod.exports);
  if (!ctx.root) throw new Error("The entry file never called registerRoot().");
  renderToStaticMarkup(createElement(ctx.root));
  if (!ctx.comps.length) throw new Error("No <Composition> found in the Root component.");
  const warnings: string[] = [];
  for (const c of ctx.comps) {
    if (c.calculateMetadata && (!c.width || !c.height || !c.fps || !c.durationInFrames)) {
      try { const m = await c.calculateMetadata({ defaultProps: c.defaultProps || {}, props: c.defaultProps || {}, abortSignal: new AbortController().signal, compositionId: c.id, isRendering: false });
        Object.assign(c, { width: m.width ?? c.width, height: m.height ?? c.height, fps: m.fps ?? c.fps, durationInFrames: m.durationInFrames ?? c.durationInFrames }); } catch (e: any) { warnings.push(`calculateMetadata failed for ${c.id}: ${e.message}`); }
    }
    if (c.still) c.durationInFrames = 1;
  }
  return { comps: ctx.comps, revoke: () => urls.forEach((u) => URL.revokeObjectURL(u)), warnings };
}
