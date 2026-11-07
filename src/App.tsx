import { useCallback, useEffect, useRef, useState } from "react";
import { deleteProject, deleteRender, listProjects, listRenders, persist, putProject, uid, usage, type ProjectRec, type RenderRec } from "./lib/db";
import { openAny } from "./lib/zip";
import { supported } from "./lib/render";
import { fmtB, isZip, useRoute } from "./lib/util";
import { Home } from "./components/Home";
import { SettingsPage } from "./components/Settings";
import { Palette, type PalItem } from "./components/Palette";
import { dirToZip, pickDir } from "./lib/fsa";
import { ProjectView } from "./components/ProjectView";
import { HFView } from "./components/HFView";
import { InfoView } from "./components/InfoView";
import { Gallery } from "./components/Gallery";
import { Icon, IC } from "./components/ui";
import { detectMachineCached, type Machine } from "./lib/hw";
import { askConfirm, ConfirmHost } from "./lib/confirm";
import { cleanEverything } from "./lib/clean";
import { downloadBackup, readBackupManifest, restoreBackup } from "./lib/backup";

/* A dropped/picked file counts as a ZIP by name or type — or, when a file
   manager stripped the extension, by its content: real ZIPs start with the
   "PK" magic bytes. Without this, perfectly good archives were filtered
   out before the studio ever looked inside them. */
const sniffZip = async (f: File): Promise<boolean> => {
  if (isZip(f)) return true;
  try {
    const b = new Uint8Array(await f.slice(0, 4).arrayBuffer());
    return b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07);
  } catch { return false; }
};
/* Turn fflate's technical unzip errors into a sentence a person can act on. */
const plainZipError = (e: any): string => {
  const m = String(e?.message || e);
  return /unzip|zip|central|end of data|invalid|unknown compression|encrypted|password/i.test(m)
    ? "the file couldn't be read as a ZIP — it may be damaged, only partly downloaded, or saved in a format the studio can't open."
    : m;
};

export default function App() {
  const [route, go] = useRoute();
  const [projects, setProjects] = useState<ProjectRec[]>([]);
  const [renders, setRenders] = useState<RenderRec[]>([]);
  const [busy, setBusy] = useState("");
  const [over, setOver] = useState(false);
  const [msg, setMsg] = useState("");
  const [ingestErr, setIngestErr] = useState("");   // persistent, dismissible — ingest failures must not vanish like a toast
  const [notice, setNotice] = useState("");         // same treatment for good news that matters (backup restored)
  const [libBusy, setLibBusy] = useState("");       // backup build in progress
  const [use, setUse] = useState({ used: 0, quota: 0 });
  const [machine, setMachine] = useState<Machine | null>(null);
  const [palOpen, setPalOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { detectMachineCached().then(setMachine); }, []);
  /* Ctrl+K / Cmd+K toggles the command palette, from anywhere. */
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalOpen((o) => !o); }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);
  const toast = useCallback((m: string) => {
    setMsg(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);   // an older toast's timer must not kill a newer message early
    toastTimer.current = setTimeout(() => setMsg(""), 3400);
  }, []);
  const refresh = useCallback(async () => { setProjects(await listProjects()); setRenders(await listRenders()); setUse(await usage()); }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const ingest = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const accepted: File[] = [], rejected: string[] = [];
    for (const f of files) { if (await sniffZip(f)) accepted.push(f); else rejected.push(f.name); }
    const problems: string[] = [];
    if (rejected.length) problems.push(`${rejected.map((n) => `“${n}”`).join(", ")} ${rejected.length === 1 ? "isn't" : "aren't"} a project ZIP — the studio opens .zip files of Remotion or HyperFrames projects.`);
    let last = "", added = 0;
    const restoredNotes: string[] = [];
    for (const f of accepted) {
      try {
        /* A backup ZIP carries our manifest at its root — restore it
           instead of trying (and failing) to open it as a project. */
        const man = await readBackupManifest(f);
        if (man) {
          setBusy(`Restoring backup ${f.name}…`);
          const r = await restoreBackup(f, man);
          restoredNotes.push(`Backup restored from “${f.name}”: ${r.projects} project${r.projects === 1 ? "" : "s"} and ${r.renders} render${r.renders === 1 ? "" : "s"} added as new copies — nothing was overwritten.`);
          continue;
        }
        setBusy(`Reading ${f.name}…`); const { det } = await openAny(f);   // auto-detect: Remotion / HyperFrames / OpenMontage / skills
        const id = uid(); await putProject({ id, name: f.name.replace(/\.zip$/i, ""), size: f.size, created: Date.now(), opened: Date.now(), zip: f, kind: det.kind, detLabel: det.label }); last = id; added++;
      } catch (e: any) { problems.push(`Couldn't open “${f.name}”: ${plainZipError(e)}`); }
    }
    setBusy(""); persist(); await refresh();
    setIngestErr(problems.join(" "));
    if (restoredNotes.length) setNotice(restoredNotes.join(" "));
    if (last) { toast(added > 1 ? `${added} projects added` : "Project added"); go(`/p/${last}/studio`); }
  }, [go, refresh, toast]);

  const ingestFolder = useCallback(async (h?: any) => {
    try { const dir = h || await pickDir("project-in", "read"); setBusy(`Reading folder “${dir.name}”…`); const z = await dirToZip(dir, (n) => setBusy(`Reading folder “${dir.name}” · ${n} files`)); setBusy(""); await ingest([z]); }
    catch (e: any) { setBusy(""); if (e?.name !== "AbortError") setIngestErr(`Couldn't read that folder: ${String(e.message || e)}`); }
  }, [ingest]);
  useEffect(() => {
    /* Window-level drag & drop. Robustness rules learned the hard way:
       - ALWAYS preventDefault on dragover/drop. Skipping it when the type
         check failed let the browser navigate away to the dropped file,
         which looked exactly like "the drop didn't take".
       - Handle promises from getAsFileSystemHandle are collected
         individually with a catch each: one rejection must never abort
         the whole drop (the old Promise.all did — plain files were
         captured, then silently never ingested).
       - The depth counter self-heals: reset on drop, on dragend, when the
         drag leaves the window (relatedTarget null) and on window blur,
         and dragover re-asserts the overlay in case an enter was missed. */
    let depth = 0;
    const has = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
    const reset = () => { depth = 0; setOver(false); };
    const enter = (e: DragEvent) => { if (!has(e)) return; e.preventDefault(); depth++; setOver(true); };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) { reset(); return; }
      depth = Math.max(0, depth - 1); if (!depth) setOver(false);
    };
    const dov = (e: DragEvent) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; if (has(e)) setOver(true); };
    const drop = (e: DragEvent) => {
      e.preventDefault(); reset();
      const dt = e.dataTransfer; if (!dt) return;
      const files = [...dt.files];   // captured synchronously, as the spec requires
      const handlePromises = [...dt.items]
        .filter((i) => i.kind === "file" && typeof (i as any).getAsFileSystemHandle === "function")
        .map((i) => (i as any).getAsFileSystemHandle().catch(() => null));
      void (async () => {
        const handles = (await Promise.all(handlePromises)).filter(Boolean) as any[];
        const dir = handles.find((h) => h.kind === "directory");
        if (files.length) ingest(files);          // plain files always win; handles can never block them
        else if (dir) ingestFolder(dir);
      })();
    };
    const paste = (e: ClipboardEvent) => { const f = [...(e.clipboardData?.files || [])]; if (!f.length) return; e.preventDefault(); void ingest(f); };
    window.addEventListener("dragenter", enter); window.addEventListener("dragleave", leave); window.addEventListener("dragover", dov); window.addEventListener("drop", drop);
    window.addEventListener("dragend", reset); window.addEventListener("blur", reset); window.addEventListener("paste", paste);
    return () => { window.removeEventListener("dragenter", enter); window.removeEventListener("dragleave", leave); window.removeEventListener("dragover", dov); window.removeEventListener("drop", drop); window.removeEventListener("dragend", reset); window.removeEventListener("blur", reset); window.removeEventListener("paste", paste); };
  }, [ingest, ingestFolder]);

  const m = /^\/p\/([\w]+)(?:\/(\w+))?/.exec(route), pid = m?.[1], tab = m?.[2] || "studio";
  const active = projects.find((p) => p.id === pid);
  const rmProject = async (id: string) => { await deleteProject(id); if (id === pid) go("/"); await refresh(); toast("Project deleted"); };
  const rmRender = async (id: string) => { await deleteRender(id); await refresh(); };
  const wipe = async () => { if (await askConfirm({ title: "Clean everything?", message: "This removes EVERYTHING Render Studio keeps in this browser: all projects and renders, your saved settings, the chosen output folder, and every cache. The studio then restarts completely fresh. This cannot be undone — if you want to keep your work, download a backup from the Library first.", confirmLabel: "Clean everything", danger: true })) { await cleanEverything(); location.reload(); } };
  const doBackup = async () => {
    if (libBusy) return;
    setLibBusy("Preparing backup…");
    try { await downloadBackup(projects, renders); toast("Backup downloaded — one ZIP with every project and render"); }
    catch (e: any) { setIngestErr(`Couldn't build the backup: ${String(e?.message || e)}`); }
    setLibBusy(""); await refresh();
  };
  const pct = use.quota ? Math.max(1, Math.round((100 * use.used) / use.quota)) : 0;

  /* Command-palette items. The in-project commands are forwarded to the
     project view as window events — it owns the render state and decides
     whether each applies (no kit → "Open Publish kit" simply does
     nothing there). */
  const palItems: PalItem[] = [
    { id: "go-lib", title: "Go to Library", hint: "View", run: () => go("/") },
    { id: "go-show", title: "Go to Showcase", hint: "View", run: () => go("/showcase") },
    { id: "go-set", title: "Go to Settings", hint: "View", run: () => go("/settings") },
    ...projects.map((p) => ({ id: "open-" + p.id, title: `Open ${p.name}`, hint: "Project", run: () => go(`/p/${p.id}/studio`) })),
    ...(pid ? [
      { id: "cmd-start", title: "Start render", hint: "This project", run: () => window.dispatchEvent(new CustomEvent("rs-cmd", { detail: "start" })) },
      { id: "cmd-both", title: "Render both platforms", hint: "This project", run: () => window.dispatchEvent(new CustomEvent("rs-cmd", { detail: "both" })) },
      { id: "cmd-kit", title: "Open Publish kit", hint: "This project", run: () => window.dispatchEvent(new CustomEvent("rs-cmd", { detail: "kit" })) },
    ] : []),
  ];

  return (
    <div className="shell">
      <nav className="side">
        <div className="brand" onClick={() => go("/")}><div className="logo"><Icon d={IC.play} size={20} /></div><div><h1>Render Studio</h1><p>Remotion + HyperFrames · in your browser</p></div></div>
        <button className="btn primary wide" onClick={() => fileRef.current?.click()}><Icon d={IC.upload} /> New project</button>
        <input ref={fileRef} type="file" accept=".zip,application/zip,application/x-zip-compressed" multiple hidden
          onChange={(e) => { const fs = e.target.files ? [...e.target.files] : []; e.target.value = ""; if (fs.length) void ingest(fs); }} />
        <button className="kbtn" onClick={() => setPalOpen(true)}><Icon d={IC.search} size={15} /> Quick actions <span><kbd>Ctrl</kbd>+<kbd>K</kbd></span></button>
        {/* Navigation only — machine specs, render power, storage actions
            and every other control live on the Settings page now. */}
        <div className="navl">
          <button className={route === "/" ? "on" : ""} onClick={() => go("/")}><Icon d={IC.grid} /> Library</button>
          <button className={route === "/showcase" ? "on" : ""} onClick={() => go("/showcase")}><Icon d={IC.film} /> Showcase <span className="badge">{renders.length}</span></button>
          {pid && active?.hasKit && <button onClick={() => window.dispatchEvent(new CustomEvent("rs-open-kit"))}><Icon d={IC.send} /> Publish kit</button>}
          <button className={route === "/settings" || route === "/pc" ? "on" : ""} onClick={() => go("/settings")}><Icon d={IC.gear} /> Settings</button>
        </div>
        <div className="sidespacer" />
        <div className="foot">
          <div className="sstatus">{machine ? <>Ready{machine.threads ? ` · ${machine.threads} cores` : ""}{machine.memGB ? ` · ≥ ${machine.memGB} GB RAM` : ""}</> : "Detecting this machine…"}</div>
          <div className="meter"><div style={{ width: pct + "%" }} /></div>
          <small>{fmtB(use.used)} used in this browser{use.quota ? ` · ${pct}%` : ""}</small>
        </div>
      </nav>

      <main className="main">
        {!supported() && <div className="banner">Your browser doesn’t support WebCodecs. Please use <b>Chrome</b> or <b>Edge</b> on desktop to render.</div>}
        {ingestErr && <div className="banner errb" role="alert"><span>{ingestErr}</span><button className="btn sm" onClick={() => setIngestErr("")}>Dismiss</button></div>}
        {notice && <div className="banner okb" role="status"><span>{notice}</span><button className="btn sm" onClick={() => setNotice("")}>Dismiss</button></div>}
        {route === "/" && <Home projects={projects} renders={renders} onFiles={ingest} onFolder={() => ingestFolder()} busy={busy} onOpen={(id) => go(`/p/${id}/studio`)} onDeleteProject={rmProject} onDeleteRender={rmRender} usage={use} backupBusy={libBusy} onBackup={doBackup} onRestore={() => fileRef.current?.click()} onClean={wipe} onChanged={refresh} />}
        {(route === "/settings" || route === "/pc") && <SettingsPage toast={toast} usage={use} projects={projects} renders={renders} backupBusy={libBusy} onBackup={doBackup} onRestore={() => fileRef.current?.click()} onClean={wipe} />}
        {route === "/showcase" && <div><div className="phead"><div><h1>Showcase</h1><p className="mt">All your finished renders, newest first.</p></div></div>
          {projects.map((p) => { const rs = renders.filter((r) => r.projectId === p.id); return rs.length ? <div key={p.id}><div className="sechead"><h2>{p.name}</h2><span className="badge">{rs.length}</span><button className="btn sm" onClick={() => go(`/p/${p.id}/studio`)}>Open project</button></div><Gallery renders={rs} onDelete={rmRender} /></div> : null; })}
          {!renders.length && <div className="empty">No renders yet.</div>}</div>}
        {pid && (active || !projects.length) && (() => {
          const kind = active?.kind || "remotion";
          const props = { id: pid, tab, setTab: (t: string) => go(`/p/${pid}/${t}`), onChanged: refresh, toast };
          return kind === "hyperframes" ? <HFView key={pid} {...props} />
            : kind === "remotion" ? <ProjectView key={pid} {...props} />
            : <InfoView key={pid} {...props} />;
        })()}
      </main>
      {over && <div className="overlay"><div><Icon d={IC.upload} size={46} /><h2>Drop to add project</h2><p>ZIP files only · the project type is detected automatically</p></div></div>}
      {msg && <div className="toast">{msg}</div>}
      {palOpen && <Palette items={palItems} onClose={() => setPalOpen(false)} />}
      <ConfirmHost />
    </div>
  );
}
