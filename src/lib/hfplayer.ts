/* Builds a self-contained, playable HTML page out of a HyperFrames project.
   The official HyperFrames MP4 renderer is a desktop tool, so the studio
   plays projects in the browser with this mini-runtime instead: it mounts
   each composition into its host (exactly like the format specifies),
   seeks every GSAP timeline deterministically, time-gates every
   [data-start] element, and syncs audio/video clips to the playhead. */
import type { Files } from "./zip";

export type HFScene = { id: string; src: string; start: number; duration: number };
export type HFMeta = { width: number; height: number; duration: number; scenes: HFScene[] };
export type BuiltPlayer = { html: string; meta: HFMeta; revoke: () => void };

const MIME: Record<string, string> = {
  js: "text/javascript", mjs: "text/javascript", json: "application/json",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", avif: "image/avif",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg",
  woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf",
};
const ext = (p: string) => p.slice(p.lastIndexOf(".") + 1).toLowerCase();
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");
export const resolvePath = (baseDir: string, rel: string) => {
  if (/^(https?:|data:|blob:|\/\/|#)/i.test(rel)) return rel;
  const out: string[] = [];
  for (const s of (baseDir + rel).split("/")) {
    if (!s || s === ".") continue;
    if (s === "..") out.pop(); else out.push(s);
  }
  return out.join("/");
};

const BRIDGE = String.raw`
(function () {
  var comps = window.__HF_COMPS__ || {};
  var indexDir = window.__HF_INDEX_DIR__ || "";
  var hosts = [], timed = [], audios = [], videos = [], scripts = [];
  var duration = 0, cur = 0, playing = false, raf = 0, lastTs = 0, lastPost = 0, scopeN = 0;
  function post(m) { parent.postMessage(m, "*"); }
  function scopeCss(cssText, scopeSel) {
    var tmp = document.createElement("style");
    tmp.textContent = cssText;
    document.head.appendChild(tmp);
    var out = "";
    try {
      var rules = tmp.sheet ? tmp.sheet.cssRules : [];
      for (var i = 0; i < rules.length; i++) {
        var rule = rules[i];
        if (rule.type === 1) {
          var sels = rule.selectorText.split(",").map(function (s) {
            s = s.trim();
            if (s === ":root" || s === "html" || s === "body") return scopeSel;
            return scopeSel + " " + s;
          });
          out += sels.join(", ") + " { " + rule.style.cssText + " }\n";
        } else { out += rule.cssText + "\n"; }
      }
    } catch (e) { out = cssText; }
    tmp.remove();
    return out;
  }
  function resolve(baseDir, rel) {
    if (/^(https?:|data:|blob:|\/\/|#)/i.test(rel)) return rel;
    var out = [], parts = (baseDir + rel).split("/");
    for (var i = 0; i < parts.length; i++) { var s = parts[i]; if (!s || s === ".") continue; if (s === "..") out.pop(); else out.push(s); }
    return out.join("/");
  }
  function populate(host, path) {
    var text = comps[path];
    if (text == null) return;
    var doc = new DOMParser().parseFromString(text, "text/html");
    var tpl = doc.querySelector("template");
    if (!tpl) return;
    var frag = tpl.content.cloneNode(true);
    var ss = frag.querySelectorAll("script");
    for (var i = 0; i < ss.length; i++) { scripts.push(ss[i].textContent || ""); ss[i].remove(); }
    var scopeSel = '[data-hf-scope="' + host.getAttribute("data-hf-scope") + '"]';
    var styles = frag.querySelectorAll("style");
    for (var si = 0; si < styles.length; si++) styles[si].textContent = scopeCss(styles[si].textContent || "", scopeSel);
    host.appendChild(frag);
    var nested = host.querySelectorAll("[data-composition-src]");
    for (var j = 0; j < nested.length; j++) {
      var h = nested[j], src = h.getAttribute("data-composition-src");
      h.__path = resolve(path ? path.slice(0, path.lastIndexOf("/") + 1) : indexDir, src);
      h.setAttribute("data-hf-scope", "hfs" + (++scopeN));
      h.style.position = "absolute"; h.style.inset = "0";
      hosts.push(h); populate(h, h.__path);
    }
  }
  function chainOffset(el) {
    var sum = 0, p = el.parentElement;
    while (p) { if (p.hasAttribute && p.hasAttribute("data-composition-src")) sum += parseFloat(p.getAttribute("data-start") || "0"); p = p.parentElement; }
    return sum;
  }
  function apply(t) {
    var tls = window.__timelines || {};
    if (tls.main) { try { tls.main.seek(t, false); } catch (e) {} }
    for (var i = 0; i < hosts.length; i++) {
      var h = hosts[i], id = h.getAttribute("data-composition-id"), tl = id && tls[id];
      if (tl) { var lt = Math.min(Math.max(t - chainOffset(h) - parseFloat(h.getAttribute("data-start") || "0"), 0), parseFloat(h.getAttribute("data-duration") || "0")); try { tl.seek(lt, false); } catch (e) {} }
    }
    for (var k = 0; k < timed.length; k++) {
      var it = timed[k], local = t - it.offset, vis = local >= it.start - 0.001 && local < it.start + it.dur;
      var d = vis ? "" : "none";
      if (it.el.style.display !== d) it.el.style.display = d;
    }
  }
  function syncMedia(playState) {
    var i, m, local;
    for (i = 0; i < audios.length; i++) {
      m = audios[i]; local = cur - m.offset - m.start;
      var inWin = local >= 0 && local < m.dur;
      if (inWin && Math.abs(m.el.currentTime - local) > 0.35) { try { m.el.currentTime = local; } catch (e) {} }
      if (playState && inWin) { if (m.el.paused) m.el.play().catch(function () {}); }
      else if (!m.el.paused) m.el.pause();
    }
    for (i = 0; i < videos.length; i++) {
      m = videos[i]; local = cur - m.offset - m.start;
      var inWinV = local >= 0 && local < m.dur;
      if (inWinV && Math.abs(m.el.currentTime - local) > 0.4) { try { m.el.currentTime = local; } catch (e) {} }
      if (playState && inWinV) { if (m.el.paused) m.el.play().catch(function () {}); }
      else if (!m.el.paused) m.el.pause();
    }
  }
  function loop(ts) {
    if (!playing) return;
    var dt = Math.min((ts - lastTs) / 1000, 0.1); lastTs = ts;
    cur = Math.min(cur + dt, duration);
    apply(cur); syncMedia(true);
    if (ts - lastPost > 120) { lastPost = ts; post({ type: "hf-time", t: cur }); }
    if (cur >= duration) { pause(); post({ type: "hf-ended" }); return; }
    raf = requestAnimationFrame(loop);
  }
  function play() { if (playing) return; playing = true; lastTs = performance.now(); raf = requestAnimationFrame(loop); syncMedia(true); post({ type: "hf-state", playing: true }); }
  function pause() { playing = false; cancelAnimationFrame(raf); syncMedia(false); post({ type: "hf-state", playing: false }); }
  function seek(t) { cur = Math.max(0, Math.min(t || 0, duration)); apply(cur); syncMedia(playing); post({ type: "hf-time", t: cur }); }
  function init() {
    var rootEl = document.querySelector('[data-composition-id="main"]') || document.querySelector("[data-duration]");
    duration = rootEl ? parseFloat(rootEl.getAttribute("data-duration") || "0") : 0;
    var W = rootEl && rootEl.getAttribute("data-width"), H = rootEl && rootEl.getAttribute("data-height");
    if (rootEl && W && H) { rootEl.style.position = "relative"; rootEl.style.width = W + "px"; rootEl.style.height = H + "px"; rootEl.style.overflow = "hidden"; rootEl.style.margin = "0"; }
    document.body.style.margin = "0"; document.body.style.background = "#000";
    var rootHosts = document.querySelectorAll("[data-composition-src]");
    for (var i = 0; i < rootHosts.length; i++) {
      var h = rootHosts[i];
      h.__path = resolve(indexDir, h.getAttribute("data-composition-src"));
      h.setAttribute("data-hf-scope", "hfs" + (++scopeN));
      h.style.position = "absolute"; h.style.inset = "0";
      hosts.push(h); populate(h, h.__path);
    }
    for (var s = 0; s < scripts.length; s++) {
      try { var el = document.createElement("script"); el.textContent = ";(() => {\n" + scripts[s] + "\n})();"; document.body.appendChild(el); el.remove(); } catch (e) {}
    }
    var all = document.querySelectorAll("[data-start]");
    for (var k = 0; k < all.length; k++) {
      var el = all[k], rec = { el: el, start: parseFloat(el.getAttribute("data-start") || "0"), dur: parseFloat(el.getAttribute("data-duration") || "0"), offset: chainOffset(el) };
      if (el.tagName === "AUDIO") audios.push(rec);
      else if (el.tagName === "VIDEO") videos.push(rec);
      else timed.push(rec);
    }
    apply(0);
    post({ type: "hf-ready", duration: duration });
  }
  window.addEventListener("message", function (e) {
    var m = e.data || {};
    if (m.type === "hf-play") play();
    else if (m.type === "hf-pause") pause();
    else if (m.type === "hf-seek") seek(m.t || 0);
    else if (m.type === "hf-muted") { for (var i = 0; i < audios.length; i++) audios[i].el.muted = !!m.muted; for (var j = 0; j < videos.length; j++) videos[j].el.muted = !!m.muted; }
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
`;

export function buildPlayer(files: Files, indexPath: string): BuiltPlayer {
  const dec = new TextDecoder();
  const urls: string[] = [];
  const blobUrl = (path: string) => {
    const data = files.get(path)!;
    const u = URL.createObjectURL(new Blob([data as BlobPart], { type: MIME[ext(path)] || "application/octet-stream" }));
    urls.push(u);
    return u;
  };
  const assetUrl = new Map<string, string>();
  for (const k of files.keys()) if (!k.toLowerCase().endsWith(".html")) assetUrl.set(k, blobUrl(k));

  const indexDir = dirOf(indexPath);
  const rewriteText = (text: string, baseDir: string) =>
    text
      .replace(/(\b(?:src|href)\s*=\s*")([^"]+)(")/gi, (m, a, u, b) => {
        const r = resolvePath(baseDir, u);
        return assetUrl.has(r) ? a + assetUrl.get(r) + b : m;
      })
      .replace(/(\b(?:src|href)\s*=\s*')([^']+)(')/gi, (m, a, u, b) => {
        const r = resolvePath(baseDir, u);
        return assetUrl.has(r) ? a + assetUrl.get(r) + b : m;
      })
      .replace(/url\(\s*"?([^")]+)"?\s*\)/gi, (m, u) => {
        const r = resolvePath(baseDir, String(u).trim());
        return assetUrl.has(r) ? `url(${assetUrl.get(r)})` : m;
      });

  // composition texts (rewritten, keyed by their files-map path)
  const comps: Record<string, string> = {};
  for (const [k, v] of files) {
    if (k.toLowerCase().endsWith(".html") && k !== indexPath) comps[k] = rewriteText(dec.decode(v), dirOf(k));
  }

  // root document: parse, read meta + scenes, rewrite asset attributes
  const doc = new DOMParser().parseFromString(dec.decode(files.get(indexPath)!), "text/html");
  const rootEl = doc.querySelector('[data-composition-id="main"]') || doc.querySelector("[data-duration]");
  const meta: HFMeta = {
    width: parseFloat(rootEl?.getAttribute("data-width") || "1080"),
    height: parseFloat(rootEl?.getAttribute("data-height") || "1920"),
    duration: parseFloat(rootEl?.getAttribute("data-duration") || "0"),
    scenes: [...doc.querySelectorAll("[data-composition-src]")].map((h) => ({
      id: h.getAttribute("data-composition-id") || h.getAttribute("data-composition-src") || "scene",
      src: h.getAttribute("data-composition-src") || "",
      start: parseFloat(h.getAttribute("data-start") || "0"),
      duration: parseFloat(h.getAttribute("data-duration") || "0"),
    })),
  };
  doc.querySelectorAll("[src], [href]").forEach((el) => {
    for (const attr of ["src", "href"]) {
      const v = el.getAttribute(attr);
      if (!v) continue;
      const r = resolvePath(indexDir, v);
      if (assetUrl.has(r)) el.setAttribute(attr, assetUrl.get(r)!);
    }
  });

  const compsJson = JSON.stringify(comps).replace(/<\/(script)/gi, "<\\/$1");
  const inject = `<script>window.__HF_COMPS__ = ${compsJson};\nwindow.__HF_INDEX_DIR__ = ${JSON.stringify(indexDir)};</script>\n<script>${BRIDGE}</script>`;
  let html = "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
  html = html.includes("</body>") ? html.replace("</body>", inject + "</body>") : html + inject;
  return { html, meta, revoke: () => urls.forEach((u) => URL.revokeObjectURL(u)) };
}
