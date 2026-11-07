/* Projects/renders live in this browser's IndexedDB. On pages where IndexedDB is
   unavailable (some browsers block it for local file:// pages), the studio falls back
   to in-memory storage: everything works, but projects last only for the session. */
export type ProjectRec = { id: string; name: string; size: number; created: number; opened: number; zip: Blob; entry?: string; comps?: string[]; kind?: string; detLabel?: string; thumb?: Blob; hasKit?: boolean };
export type RenderRec = {
  id: string; projectId: string; projectName: string; comp: string; name: string; createdAt: number; renderMs: number; size: number;
  mime: string; container: string; codec: string; width: number; height: number; fps: number; frames: number; settings: Record<string, unknown>; blob?: Blob; thumb?: Blob; savedTo?: string;
};
const DB = "render-studio", V = 2;
let dbp: Promise<IDBDatabase> | null = null;
const open = () => (dbp ??= new Promise((ok, no) => {
  const r = indexedDB.open(DB, V);
  r.onupgradeneeded = () => {
    const d = r.result;
    if (!d.objectStoreNames.contains("projects")) d.createObjectStore("projects", { keyPath: "id" });
    if (!d.objectStoreNames.contains("renders")) { const s = d.createObjectStore("renders", { keyPath: "id" }); s.createIndex("projectId", "projectId"); }
    if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta", { keyPath: "key" });
  };
  r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
}));
const tx = async <T,>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> => {
  const d = await open();
  return new Promise((ok, no) => { const t = d.transaction(store, mode), req = fn(t.objectStore(store)); t.oncomplete = () => ok((req as IDBRequest<T>)?.result as T); t.onerror = () => no(t.error); t.onabort = () => no(t.error); });
};

/* ---- in-memory fallback ---- */
const MEM = { projects: new Map<string, ProjectRec>(), renders: new Map<string, RenderRec>(), meta: new Map<string, unknown>() };
let memMode: boolean | null = null;
const useMem = async (): Promise<boolean> => {
  if (memMode !== null) return memMode;
  try { await open(); memMode = false; } catch { memMode = true; }
  return memMode;
};
export const storageIsMemory = () => memMode === true;

export const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
export const putProject = async (p: ProjectRec) => { if (await useMem()) { MEM.projects.set(p.id, p); return; } return tx("projects", "readwrite", (s) => s.put(p)); };
export const listProjects = async () => { if (await useMem()) return [...MEM.projects.values()].sort((x, y) => y.opened - x.opened); return tx<ProjectRec[]>("projects", "readonly", (s) => s.getAll()).then((a) => a.sort((x, y) => y.opened - x.opened)); };
export const getProject = async (id: string) => { if (await useMem()) return MEM.projects.get(id); return tx<ProjectRec | undefined>("projects", "readonly", (s) => s.get(id)); };
export const putRender = async (r: RenderRec) => { if (await useMem()) { MEM.renders.set(r.id, r); return; } return tx("renders", "readwrite", (s) => s.put(r)); };
export const listRenders = async (projectId?: string) => {
  if (await useMem()) return [...MEM.renders.values()].filter((r) => !projectId || r.projectId === projectId).sort((x, y) => y.createdAt - x.createdAt);
  return tx<RenderRec[]>("renders", "readonly", (s) => (projectId ? s.index("projectId").getAll(projectId) : s.getAll())).then((a) => a.sort((x, y) => y.createdAt - x.createdAt));
};
export const deleteRender = async (id: string) => { if (await useMem()) { MEM.renders.delete(id); return; } return tx("renders", "readwrite", (s) => s.delete(id)); };
export async function deleteProject(id: string) {
  for (const r of await listRenders(id)) await deleteRender(r.id);
  if (await useMem()) { MEM.projects.delete(id); return; }
  await tx("projects", "readwrite", (s) => s.delete(id));
}
export async function clearAll() {
  MEM.projects.clear(); MEM.renders.clear(); MEM.meta.clear();
  try { (await open()).close(); } catch {}
  dbp = null;
  if (!memMode) await new Promise<void>((ok) => { try { const r = indexedDB.deleteDatabase(DB); r.onsuccess = r.onerror = r.onblocked = () => ok(); } catch { ok(); } });
  memMode = null;
  try { localStorage.clear(); sessionStorage.clear(); } catch {}
}
export async function usage() {
  try { const e = await navigator.storage.estimate(); return { used: e.usage || 0, quota: e.quota || 0 }; } catch { return { used: 0, quota: 0 }; }
}
export const persist = () => { try { navigator.storage?.persist?.(); } catch {} };

export const setMeta = async (key: string, value: unknown) => { if (await useMem()) { MEM.meta.set(key, value); return; } return tx("meta", "readwrite", (s) => s.put({ key, value })); };
export const getMeta = async <T,>(key: string): Promise<T | undefined> => { if (await useMem()) return MEM.meta.get(key) as T | undefined; return tx<{ key: string; value: T } | undefined>("meta", "readonly", (s) => s.get(key)).then((r) => r?.value); };
export const delMeta = async (key: string) => { if (await useMem()) { MEM.meta.delete(key); return; } return tx("meta", "readwrite", (s) => s.delete(key)); };
