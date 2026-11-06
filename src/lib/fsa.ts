/* File System Access helpers (Chrome / Edge on Windows, macOS, Linux). */
import { zipSync } from "fflate";
import { delMeta, getMeta, setMeta } from "./db";
export const fsaSupported = () => "showDirectoryPicker" in window;
export type Dir = FileSystemDirectoryHandle;
const SKIP = new Set(["node_modules", ".git", "__MACOSX", ".DS_Store", "out", ".next", "dist", ".cache"]);

export async function pickDir(id: string, mode: "read" | "readwrite"): Promise<Dir> {
  const t = (window as any).__TEST_DIR; if (t) return t;         // test hook
  return (window as any).showDirectoryPicker({ id, mode, startIn: mode === "readwrite" ? "videos" : "documents" });
}
export const saveOutDir = (h: Dir) => setMeta("outDir", h);
export const loadOutDir = () => getMeta<Dir>("outDir");
export const clearOutDir = () => delMeta("outDir");

/* ---- write permission, reported honestly ----
   A directory handle restored from IndexedDB (i.e. chosen in an earlier
   session) comes back with permission "prompt", not "granted" — and any of
   these calls can throw (stale handle, folder moved/deleted, no user
   gesture). Callers must KNOW which state they are in; the old ensureWrite
   swallowed every exception and returned true, which made the completion
   code believe a folder write would succeed when it could not. */
export type WritePerm = "granted" | "prompt" | "denied";
export async function queryWrite(h: Dir): Promise<WritePerm> {
  try { return (await (h as any).queryPermission({ mode: "readwrite" })) as WritePerm; }
  catch { return "denied"; }
}
export async function requestWrite(h: Dir): Promise<boolean> {
  try { return (await (h as any).requestPermission({ mode: "readwrite" })) === "granted"; }
  catch { return false; }
}
/** Ask (if needed) and report truthfully: true only when writing is allowed. */
export async function ensureWrite(h: Dir): Promise<boolean> {
  if ((await queryWrite(h)) === "granted") return true;
  return requestWrite(h);
}
/** The saved folder itself is gone (moved/deleted since it was chosen). */
export const isStaleDirError = (e: any) => e?.name === "NotFoundError";
/** Plain-language reason a folder write failed, for the result area. */
export function folderErrorText(e: any, folder: string): string {
  if (isStaleDirError(e)) return `The folder “${folder}” can't be found any more — it may have been moved or deleted. Choose it again to keep saving there.`;
  if (e?.name === "NotAllowedError" || e?.name === "SecurityError") return `The browser blocked writing to “${folder}” — it needs your permission first.`;
  if (e?.name === "QuotaExceededError") return `“${folder}” doesn't have room for this file.`;
  return `Couldn't write to “${folder}”: ${e?.message || e}`;
}
async function walk(dir: Dir, prefix: string, out: Record<string, Uint8Array>, tick: () => void) {
  for await (const [name, h] of (dir as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
    if (SKIP.has(name)) continue;
    if (h.kind === "directory") await walk(h as Dir, prefix + name + "/", out, tick);
    else { out[prefix + name] = new Uint8Array(await (await (h as FileSystemFileHandle).getFile()).arrayBuffer()); tick(); }
  }
}
/** Turn a project FOLDER into the same ZIP format the app already understands. */
export async function dirToZip(dir: Dir, onTick: (n: number) => void = () => {}): Promise<File> {
  const files: Record<string, Uint8Array> = {}; let n = 0;
  await walk(dir, "", files, () => onTick(++n));
  const data = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: 0 }]])) as any);
  return new File([data as BlobPart], dir.name + ".zip", { type: "application/zip" });
}
export async function writeToDir(dir: Dir, name: string, blob: Blob) {
  const fh = await dir.getFileHandle(name, { create: true }); const w = await (fh as any).createWritable(); await w.write(blob); await w.close();
}
