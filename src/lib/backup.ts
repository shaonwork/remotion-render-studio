/* Library backup & restore. A backup is one ZIP:
     manifest.json          — what's inside (names, dates, types)
     projects/<id>.zip      — each project's original ZIP, untouched
     projects/<id>.thumb    — its library thumbnail, when it has one
     renders/<id>-<name>    — each render's video file (renders saved only
                              to a folder have no file — the manifest still
                              records them, and they restore as records)
   Restore NEVER overwrites: projects and renders come back under fresh
   IDs (renders are re-pointed at the restored project IDs), so restoring
   the same backup twice simply makes a second copy. */
import { zipSync, unzipSync, strToU8, strFromU8, type Zippable } from "fflate";
import { putProject, putRender, uid, type ProjectRec, type RenderRec } from "./db";

export type BackupManifest = {
  app: "render-studio-backup"; version: 1; createdAt: number;
  projects: { id: string; name: string; size: number; created: number; opened: number; kind?: string; detLabel?: string; file: string; thumbFile?: string }[];
  renders: { id: string; projectId: string; projectName: string; comp: string; name: string; createdAt: number; renderMs: number; size: number; mime: string; container: string; codec: string; width: number; height: number; fps: number; frames: number; settings: Record<string, unknown>; savedTo?: string; file?: string; thumbFile?: string }[];
};

const safeName = (n: string) => n.replace(/[^\w.\- ]+/g, "_");

export async function downloadBackup(projects: ProjectRec[], renders: RenderRec[]): Promise<void> {
  const files: Zippable = {};
  const man: BackupManifest = { app: "render-studio-backup", version: 1, createdAt: Date.now(), projects: [], renders: [] };
  for (const p of projects) {
    const file = `projects/${p.id}.zip`;
    files[file] = [new Uint8Array(await p.zip.arrayBuffer()), { level: 0 }];   // already compressed — store, don't recompress
    const pm: BackupManifest["projects"][number] = { id: p.id, name: p.name, size: p.size, created: p.created, opened: p.opened, kind: p.kind, detLabel: p.detLabel, file };
    if (p.thumb) { pm.thumbFile = `projects/${p.id}.thumb`; files[pm.thumbFile] = new Uint8Array(await p.thumb.arrayBuffer()); }
    man.projects.push(pm);
  }
  for (const r of renders) {
    const rm: BackupManifest["renders"][number] = { id: r.id, projectId: r.projectId, projectName: r.projectName, comp: r.comp, name: r.name, createdAt: r.createdAt, renderMs: r.renderMs, size: r.size, mime: r.mime, container: r.container, codec: r.codec, width: r.width, height: r.height, fps: r.fps, frames: r.frames, settings: r.settings, savedTo: r.savedTo };
    if (r.blob) { rm.file = `renders/${r.id}-${safeName(r.name)}`; files[rm.file] = [new Uint8Array(await r.blob.arrayBuffer()), { level: 0 }]; }
    if (r.thumb) { rm.thumbFile = `renders/${r.id}.thumb`; files[rm.thumbFile] = new Uint8Array(await r.thumb.arrayBuffer()); }
    man.renders.push(rm);
  }
  files["manifest.json"] = strToU8(JSON.stringify(man, null, 2));
  const blob = new Blob([zipSync(files) as BlobPart], { type: "application/zip" });
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u; a.download = `render-studio-backup-${stamp}.zip`; a.click();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}

/** A ZIP is a backup when it carries our manifest at its root. Returns the
    parsed manifest, or null for any ordinary project ZIP. */
export async function readBackupManifest(file: Blob): Promise<BackupManifest | null> {
  try {
    const raw = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const m = raw["manifest.json"];
    if (!m) return null;
    const man = JSON.parse(strFromU8(m));
    return man?.app === "render-studio-backup" && Array.isArray(man.projects) && Array.isArray(man.renders) ? (man as BackupManifest) : null;
  } catch { return null; }
}

export async function restoreBackup(file: Blob, man: BackupManifest): Promise<{ projects: number; renders: number }> {
  const raw = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const idMap = new Map<string, string>();
  let np = 0, nr = 0;
  for (const pm of man.projects) {
    const data = raw[pm.file];
    if (!data) continue;
    const nid = uid();
    idMap.set(pm.id, nid);
    await putProject({
      id: nid, name: pm.name, size: data.byteLength, created: pm.created || Date.now(), opened: Date.now(),
      zip: new Blob([data as BlobPart], { type: "application/zip" }), kind: pm.kind, detLabel: pm.detLabel,
      thumb: pm.thumbFile && raw[pm.thumbFile] ? new Blob([raw[pm.thumbFile] as BlobPart], { type: "image/jpeg" }) : undefined,
    });
    np++;
  }
  for (const rm of man.renders) {
    const pid = idMap.get(rm.projectId);
    if (!pid) continue;
    await putRender({
      id: uid(), projectId: pid, projectName: rm.projectName, comp: rm.comp, name: rm.name, createdAt: rm.createdAt || Date.now(),
      renderMs: rm.renderMs || 0, size: rm.size || 0, mime: rm.mime || "", container: rm.container || "", codec: rm.codec || "",
      width: rm.width || 0, height: rm.height || 0, fps: rm.fps || 0, frames: rm.frames || 0, settings: rm.settings || {},
      blob: rm.file && raw[rm.file] ? new Blob([raw[rm.file] as BlobPart], { type: rm.mime || "application/octet-stream" }) : undefined,
      thumb: rm.thumbFile && raw[rm.thumbFile] ? new Blob([raw[rm.thumbFile] as BlobPart], { type: "image/jpeg" }) : undefined,
      savedTo: rm.savedTo,
    });
    nr++;
  }
  return { projects: np, renders: nr };
}
