import type { Files } from "./zip";

/* Publish kit ("upload kit") support.
   A project ZIP may carry an `upload-kit/` folder at its root with the
   copy-paste material for uploading the finished video: titles, captions,
   tags, hashtags and thumbnails for YouTube and Facebook. The studio only
   READS it: detection runs over the project's in-memory file map, and the
   viewer (components/PublishKit.tsx) renders one box per field.
   Convention (kitVersion 1):
     upload-kit/upload-kit.json   — structured data (preferred source)
     upload-kit/facebook.txt      — plain-text fallback
     upload-kit/youtube.txt       — plain-text fallback
   The JSON's thumbnail paths are relative to the project root. */

export type KitBox =
  | { kind: "copy"; label: string; text: string }
  | { kind: "info"; label: string; text: string }
  | { kind: "thumb"; label: string; blob: Blob; fileName: string };

export type KitPlatform = { id: string; label: string; boxes: KitBox[] };
export type PublishKit = { header: string; sub?: string; platforms: KitPlatform[] };

const dec = new TextDecoder();
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : []);

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
  const thumbBox = (label: string, relRaw: unknown): KitBox | null => {
    const rel = str(relRaw);
    if (!rel) return null;
    const hit = findThumb(files, rel.replace(/^\.\//, ""), kitDir);
    if (!hit) return null;
    const base = rel.split("/").pop() || "thumbnail.png";
    const mime = MIME[(base.split(".").pop() || "").toLowerCase()] || "image/png";
    return { kind: "thumb", label, blob: new Blob([hit.data.slice().buffer as ArrayBuffer], { type: mime }), fileName: base };
  };
  const copy = (label: string, text: string) => { if (text) boxes.push({ kind: "copy", label, text }); };
  const info = (label: string, text: string) => { if (text) boxes.push({ kind: "info", label, text }); };

  let boxes: KitBox[] = [];
  const yt = j?.youtube;
  if (yt && typeof yt === "object") {
    boxes = [];
    copy("Title", str(yt.title));
    copy("Description", str(yt.description));
    const tags = strList(yt.tags);
    if (tags.length) copy("Tags", tags.join(", "));
    const tagsHash = strList(yt.hashtags);
    if (tagsHash.length) copy("Hashtags", tagsHash.join(" "));
    info("Category", str(yt.category));
    const th = thumbBox("Thumbnail", yt.thumbnail);
    if (th) boxes.push(th);
    if (boxes.length) platforms.push({ id: "youtube", label: "YouTube", boxes });
  }
  const fb = j?.facebook;
  if (fb && typeof fb === "object") {
    boxes = [];
    copy("Title", str(fb.title));
    copy("Caption", str(fb.caption));
    const hash = strList(fb.hashtags);
    if (hash.length) copy("Hashtags", hash.join(" "));
    copy("Pin comment", str(fb.pinComment));
    info("Suggested post time", str(fb.suggestedPostTime));
    const th = thumbBox("Thumbnail", fb.thumbnail);
    if (th) boxes.push(th);
    if (boxes.length) platforms.push({ id: "facebook", label: "Facebook", boxes });
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
  const dur = typeof v.durationSec === "number" && v.durationSec > 0 ? v.durationSec : 0;
  if (dur) { const s = Math.round(dur); parts.push(s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`); }
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
