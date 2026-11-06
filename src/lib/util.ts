import { useEffect, useState } from "react";
export const fmtB = (b: number) => (b > 1e9 ? (b / 1e9).toFixed(2) + " GB" : b > 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1e3)) + " KB");
export const fmtT = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)), m = Math.floor(s / 60); return m ? `${m}m ${s % 60}s` : `${s}s`; };
export const fmtD = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
/* Object URLs for blobs that come out of IndexedDB need a cache: every DB read
   returns a NEW Blob object for the same image, so a naive create/revoke per
   effect run makes thumbnails visibly blink on every list refresh. Keyed by a
   stable id (project / render id), a URL is only recreated when the blob's
   size actually changes (i.e. the image really was replaced). */
const urlCache = new Map<string, { size: number; url: string }>();
export function useObjectUrl(blob?: Blob | null, key?: string) {
  const [u, setU] = useState<string>();
  useEffect(() => {
    if (!blob) { setU(undefined); return; }
    if (key) {
      const hit = urlCache.get(key);
      if (hit && hit.size === blob.size) { setU(hit.url); return; }
      const url = URL.createObjectURL(blob);
      if (hit) URL.revokeObjectURL(hit.url);
      urlCache.set(key, { size: blob.size, url });
      setU(url);
      return;
    }
    const url = URL.createObjectURL(blob); setU(url); return () => URL.revokeObjectURL(url);
  }, [blob, key]);
  return u;
}
export function useRoute() {
  const get = () => location.hash.replace(/^#/, "") || "/";
  const [r, setR] = useState(get());
  useEffect(() => { const f = () => setR(get()); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  return [r, (to: string) => { location.hash = to; }] as const;
}
export const isZip = (f: File) => /\.zip$/i.test(f.name) || f.type === "application/zip" || f.type === "application/x-zip-compressed";
