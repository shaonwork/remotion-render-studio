/* Fold the SINGLE=1 build (dist/) into ONE self-contained HTML file.
   dist assets are already fully inlined by Vite (data-URI wasm, one JS bundle,
   one CSS file) — here we only inline the bundle + stylesheet into the page. */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dist = new URL("../dist/", import.meta.url).pathname;
const outDir = new URL("../single/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });

let html = readFileSync(join(dist, "index.html"), "utf8");
const assets = readdirSync(join(dist, "assets"));

const jsFile = assets.find((f) => /^index-.*\.js$/.test(f));
const cssFile = assets.find((f) => /\.css$/.test(f));
if (!jsFile) throw new Error("No entry JS found in dist/assets — did the SINGLE=1 build run?");

const js = readFileSync(join(dist, "assets", jsFile), "utf8")
  .replace(/<\/script/g, "<\\/script"); // keep the HTML parser from ending the inline script early
let swappedJs = false;
html = html.replace(/<script type="module"[^>]*src="[^"]*"[^>]*><\/script>/, () => { swappedJs = true; return `<script type="module">\n${js}\n</script>`; });
if (!swappedJs) throw new Error("Entry <script> tag not found in dist/index.html — nothing was inlined.");

if (cssFile) {
  const css = readFileSync(join(dist, "assets", cssFile), "utf8");
  let swappedCss = false;
  html = html.replace(/<link rel="stylesheet"[^>]*>/, () => { swappedCss = true; return `<style>\n${css}\n</style>`; });
  if (!swappedCss) throw new Error("Stylesheet <link> not replaced.");
}

/* the only /assets/ reference allowed to remain is none at all in the document shell */
const shell = html.slice(0, html.indexOf('<script type="module">'));
if (/\/assets\//.test(shell)) throw new Error("External asset references remain in the document shell.");

const out = join(outDir, "Render-Studio.html");
writeFileSync(out, html);
console.log(`Wrote ${out} (${(html.length / 1e6).toFixed(1)} MB)`);
