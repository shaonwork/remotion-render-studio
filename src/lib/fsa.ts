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
export async function ensureWrite(h: Dir): Promise<boolean> {
  try { const o: any = { mode: "readwrite" }; if ((await (h as any).queryPermission(o)) === "granted") return true; return (await (h as any).requestPermission(o)) === "granted"; } catch { return true; }
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
