import type { Files } from "./zip";

/* Publish kit ("upload kit") support.
   A project ZIP may carry an `upload-kit/` folder at its root with the
   copy-paste material for uploading the finished video: titles, captions,
   tags, hashtags, hook comments, SEO keywords and thumbnails for YouTube
   and Facebook. The studio only READS it: detection runs over the
   project's in-memory file map, and the viewer (components/PublishKit.tsx)
   renders one box per field.
   Conventions:
     kitVersion 1 — video.durationSec is a NUMBER, video.composition names
       the single render, facebook.pinComment is the comment to pin.
     kitVersion 2 — one render PER platform: video.compositions
       {facebook, youtube} (mirrored by facebook.composition /
       youtube.composition), video.durationSec is an OBJECT
       {facebook, youtube}, pinComment is replaced by hookComments[3] on
       both platforms (hookComments[0] is the default pin), and video.seo
       {primaryKeyword, keywords[], researchSource} carries the researched
       search keywords.
   Detection is by SHAPE, not by the version number alone, and every field
   is optional — a kit that is missing pieces simply shows fewer boxes.
     upload-kit/upload-kit.json   — structured data (preferred source)
     upload-kit/facebook.txt      — plain-text fallback
     upload-kit/youtube.txt       — plain-text fallback
   The JSON's thumbnail paths are relative to the project root. */

export type KitBox =
  | { kind: "copy"; label: string; text: string }
  | { kind: "info"; label: string; text: string }
  | { kind: "thumb"; label: string; blob: Blob; fileName: string };

export type KitPlatform = { id: string; label: string; boxes: KitBox[]; durationSec?: number; composition?: string };
export type PublishKit = { header: string; sub?: string; platforms: KitPlatform[] };

const dec = new TextDecoder();
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : []);
const num = (v: unknown): number | undefined => (typeof v === "number" && isFinite(v) && v > 0 ? v : undefined);

/** "97.2s" -> "1m 37s"; under a minute stays "45s". */
export const fmtKitDur = (sec: number): string => {
  const s = Math.round(sec);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
};

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

/* Find a file in the project map: exact key first, then any key that ends
   with the given root-relative path (tolerates a kit nested under a folder
   the ingest didn't slice away). */
function findFile(files: Files, rel: string): { key: string; data: Uint8Array } | null {
  const direct = files.get(rel);
  if (direct) return { key: rel, data: direct };
  for (const [k, v] of files) if (k.endsWith("/" + rel)) return { key: k, data: v };
  return null;
}

/* Thumbnail paths in the JSON are project-root relative; if that exact key
   is missing, fall back to the file name next to the kit JSON itself. */
function findThumb(files: Files, rel: string, kitDir: string): { data: Uint8Array } | null {
  const direct = findFile(files, rel);
  if (direct) return direct;
  const base = rel.split("/").pop() || rel;
  return findFile(files, (kitDir ? kitDir + "/" : "") + base) || findFile(files, base);
}

function boxesFromJson(files: Files, kitDir: string, j: any): KitPlatform[] {
  const platforms: KitPlatform[] = [];
  const video = j?.video && typeof j.video === "object" ? j.video : {};
  const thumbBox = (label: string, relRaw: unknown): KitBox | null => {
    const rel = str(relRaw);
    if (!rel) return null;
    const hit = findThumb(files, rel.replace(/^\.\//, ""), kitDir);
    if (!hit) return null;
    const base = rel.split("/").pop() || "thumbnail.png";
    const mime = MIME[(base.split(".").pop() || "").toLowerCase()] || "image/png";
    return { kind: "thumb", label, blob: new Blob([hit.data.slice().buffer as ArrayBuffer], { type: mime }), fileName: base };
  };
  /* Per-platform facts, by shape: a v2 kit names a composition and a
     duration per platform; a v1 kit has one of each for the whole video. */
  const compFor = (id: string, plat: any): string | undefined =>
    str(plat?.composition) || str(video.compositions?.[id]) || str(video.composition) || undefined;
  const durFor = (id: string, plat: any): number | undefined => {
    const own = num(plat?.durationSec);
    if (own) return own;
    const all = video.durationSec;
    if (all && typeof all === "object") return num(all[id]);
    return num(all);
  };

  let boxes: KitBox[] = [];
  const yt = j?.youtube;
  if (yt && typeof yt === "object") {
    boxes = [];
    const copy = (label: string, text: string) => { if (text) boxes.push({ kind: "copy", label, text }); };
    const info = (label: string, text: string) => { if (text) boxes.push({ kind: "info", label, text }); };
    copy("Title", str(yt.title));
    copy("Description", str(yt.description));
    const tags = strList(yt.tags);
    if (tags.length) copy("Tags", tags.join(", "));
    const tagsHash = strList(yt.hashtags);
    if (tagsHash.length) copy("Hashtags", tagsHash.join(" "));
    /* v2: engagement hooks to post + pin after publishing — one box each,
       the first is the default pin. */
    strList(yt.hookComments).forEach((h, i) => copy(i === 0 ? "Hook comment 1 · pin this one" : `Hook comment ${i + 1}`, h));
    info("Category", str(yt.category));
    /* v2: the researched SEO keywords live on the video block. They are
       YouTube-search research, so they ride along in the YouTube tab. */
    const seo = video.seo && typeof video.seo === "object" ? video.seo : null;
    if (seo) {
      copy("SEO · primary keyword", str(seo.primaryKeyword));
      const kw = strList(seo.keywords);
      if (kw.length) copy("SEO · keywords", kw.join(", "));
      info("SEO · research source", str(seo.researchSource));
    }
    const th = thumbBox("Thumbnail", yt.thumbnail);
    if (th) boxes.push(th);
    if (boxes.length) platforms.push({ id: "youtube", label: "YouTube", boxes, durationSec: durFor("youtube", yt), composition: compFor("youtube", yt) });
  }
  const fb = j?.facebook;
  if (fb && typeof fb === "object") {
    boxes = [];
    const copy = (label: string, text: string) => { if (text) boxes.push({ kind: "copy", label, text }); };
    const info = (label: string, text: string) => { if (text) boxes.push({ kind: "info", label, text }); };
    copy("Title", str(fb.title));
    copy("Caption", str(fb.caption));
    const hash = strList(fb.hashtags);
    if (hash.length) copy("Hashtags", hash.join(" "));
    const hooks = strList(fb.hookComments);
    if (hooks.length) hooks.forEach((h, i) => copy(i === 0 ? "Hook comment 1 · pin this one" : `Hook comment ${i + 1}`, h));
    else copy("Pin comment", str(fb.pinComment));   // v1 kits: the single pin comment
    info("Suggested post time", str(fb.suggestedPostTime));
    const th = thumbBox("Thumbnail", fb.thumbnail);
    if (th) boxes.push(th);
    if (boxes.length) platforms.push({ id: "facebook", label: "Facebook", boxes, durationSec: durFor("facebook", fb), composition: compFor("facebook", fb) });
  }
  return platforms;
}

function headerFromJson(j: any): { header: string; sub?: string } {
  const v = j?.video && typeof j.video === "object" ? j.video : {};
  const series = str(v.series) || str(v.seriesBadge);
  const ep = str(v.episodeLabel) || (v.episode != null && v.episode !== "" ? `Episode ${v.episode}` : "");
  const header = [series, ep].filter(Boolean).join(" · ") || str(v.slug) || "Publish kit";
  const parts: string[] = [];
  const fmt = str(j?.youtube?.format);
  if (fmt) parts.push(fmt === "shorts" ? "Shorts" : fmt);
  /* A single duration belongs in the header only when the kit gives ONE
     number for the whole video (v1). V2 durations differ per platform and
     are shown in each platform tab instead. */
  const dur = num(v.durationSec);
  if (dur) parts.push(fmtKitDur(dur));
  return { header, sub: parts.length ? parts.join(" · ") : undefined };
}

const PLATFORM_LABEL: Record<string, string> = { youtube: "YouTube", facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok", x: "X", twitter: "X" };

/** Detect and parse the project's publish kit, or return null when the
    project has none (then the project view shows no Publish kit button). */
export function findPublishKit(files: Files): PublishKit | null {
  const jsonHit = findFile(files, "upload-kit/upload-kit.json");
  const kitDir = jsonHit ? jsonHit.key.slice(0, jsonHit.key.length - "upload-kit.json".length).replace(/\/$/, "") : "upload-kit";

  if (jsonHit) {
    try {
      const j = JSON.parse(dec.decode(jsonHit.data));
      const platforms = boxesFromJson(files, kitDir, j);
      if (platforms.length) return { ...headerFromJson(j), platforms };
    } catch { /* unusable JSON — fall through to the txt fallback */ }
  }

  /* Fallback: one box per upload-kit/*.txt file, the file's full text. */
  const platforms: KitPlatform[] = [];
  const txtKeys = Array.from(files.keys()).filter((k) => /(^|\/)upload-kit\/[^/]+\.txt$/i.test(k)).sort();
  for (const k of txtKeys) {
    const stem = (k.split("/").pop() || "notes").replace(/\.txt$/i, "").toLowerCase();
    const text = dec.decode(files.get(k)!).trim();
    if (!text) continue;
    platforms.push({ id: stem, label: PLATFORM_LABEL[stem] || stem.charAt(0).toUpperCase() + stem.slice(1), boxes: [{ kind: "copy", label: "Copy-paste text", text }] });
  }
  if (!platforms.length) return null;
  return { header: "Publish kit", platforms };
}
