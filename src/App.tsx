import { useCallback, useEffect, useState } from "react";
import { clearAll, deleteProject, deleteRender, listProjects, listRenders, persist, putProject, uid, usage, type ProjectRec, type RenderRec } from "./lib/db";
import { openAny } from "./lib/zip";
import { supported } from "./lib/render";
import { fmtB, isZip, useObjectUrl, useRoute } from "./lib/util";
import { Home } from "./components/Home";
import { MachinePage } from "./components/Machine";
import { dirToZip, pickDir } from "./lib/fsa";
import { ProjectView } from "./components/ProjectView";
import { HFView } from "./components/HFView";
import { InfoView } from "./components/InfoView";
import { Gallery } from "./components/Gallery";
import { Icon, IC, Seg } from "./components/ui";
import { detectMachineCached, loadPower, savePower, type Machine, type PowerPref } from "./lib/hw";

const SideItem = ({ p, on, count, onClick }: { p: ProjectRec; on: boolean; count: number; onClick: () => void }) => {
  const th = useObjectUrl(p.thumb, "p_" + p.id);
  return (
    <div className={"pi" + (on ? " on" : "")} onClick={onClick}>
      {th ? <img className="pithumb" src={th} alt="" /> : <Icon d={IC.folder} />}
      <div className="pit"><b title={p.name}>{p.name}</b><small>{fmtB(p.size)} · {p.detLabel || "Remotion"} · {count} renders</small></div>
    </div>
  );
};

export default function App() {
  const [route, go] = useRoute();
  const [projects, setProjects] = useState<ProjectRec[]>([]);
  const [renders, setRenders] = useState<RenderRec[]>([]);
  const [busy, setBusy] = useState("");
  const [over, setOver] = useState(false);
  const [msg, setMsg] = useState("");
  const [use, setUse] = useState({ used: 0, quota: 0 });
  const [machine, setMachine] = useState<Machine | null>(null);
  const [power, setPowerState] = useState<PowerPref>(() => loadPower());
  useEffect(() => { detectMachineCached().then(setMachine); }, []);
  useEffect(() => { setPowerState(loadPower()); }, [route]);
  const setPower = (p: PowerPref) => { setPowerState(p); savePower(p); };
  const toast = useCallback((m: string) => { setMsg(m); setTimeout(() => setMsg(""), 3400); }, []);
  const refresh = useCallback(async () => { setProjects(await listProjects()); setRenders(await listRenders()); setUse(await usage()); }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const ingest = useCallback(async (files: File[]) => {
    const zips = files.filter(isZip); if (!zips.length) return toast("Please choose a .zip file");
    let last = "";
    for (const f of zips) {
      try {
        setBusy(`Reading ${f.name}…`); const { det } = await openAny(f);   // auto-detect: Remotion / HyperFrames / OpenMontage / skills
        const id = uid(); await putProject({ id, name: f.name.replace(/\.zip$/i, ""), size: f.size, created: Date.now(), opened: Date.now(), zip: f, kind: det.kind, detLabel: det.label }); last = id;
      } catch (e: any) { toast(`${f.name}: ${e.message}`); }
    }
    setBusy(""); persist(); await refresh();
    if (last) { toast(zips.length > 1 ? `${zips.length} projects added` : "Project added"); go(`/p/${last}/studio`); }
  }, [go, refresh, toast]);

  const ingestFolder = useCallback(async (h?: any) => {
    try { const dir = h || await pickDir("project-in", "read"); setBusy(`Reading folder “${dir.name}”…`); const z = await dirToZip(dir, (n) => setBusy(`Reading folder “${dir.name}” · ${n} files`)); setBusy(""); await ingest([z]); }
    catch (e: any) { setBusy(""); if (e?.name !== "AbortError") toast(String(e.message || e)); }
  }, [ingest, toast]);
  useEffect(() => {
    let depth = 0;
    const has = (e: DragEvent) => e.dataTransfer?.types?.includes("Files");
    const enter = (e: DragEvent) => { if (has(e)) { depth++; setOver(true); } };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setOver(false); };
    const dov = (e: DragEvent) => { if (has(e)) e.preventDefault(); };
    const drop = async (e: DragEvent) => {
      if (!has(e)) return; e.preventDefault(); depth = 0; setOver(false);
      const items = [...(e.dataTransfer?.items || [])], hs = items.map((i: any) => i.getAsFileSystemHandle?.());   // collect synchronously
      const files = [...(e.dataTransfer?.files || [])];
      const handles = (await Promise.all(hs)).filter(Boolean) as any[], dir = handles.find((h) => h.kind === "directory");
      if (dir) return ingestFolder(dir);
      ingest(files);
    };
    const paste = (e: ClipboardEvent) => { const f = [...(e.clipboardData?.files || [])].filter(isZip); if (f.length) { e.preventDefault(); ingest(f); } };
    window.addEventListener("dragenter", enter); window.addEventListener("dragleave", leave); window.addEventListener("dragover", dov); window.addEventListener("drop", drop); window.addEventListener("paste", paste);
    return () => { window.removeEventListener("dragenter", enter); window.removeEventListener("dragleave", leave); window.removeEventListener("dragover", dov); window.removeEventListener("drop", drop); window.removeEventListener("paste", paste); };
  }, [ingest, ingestFolder]);

  const m = /^\/p\/([\w]+)(?:\/(\w+))?/.exec(route), pid = m?.[1], tab = m?.[2] || "studio";
  const active = projects.find((p) => p.id === pid);
  const rmProject = async (id: string) => { await deleteProject(id); if (id === pid) go("/"); await refresh(); toast("Project deleted"); };
  const rmRender = async (id: string) => { await deleteRender(id); await refresh(); };
  const wipe = async () => { if (confirm("Delete ALL projects and renders stored in this browser? This cannot be undone.")) { await clearAll(); go("/"); location.reload(); } };
  const pct = use.quota ? Math.max(1, Math.round((100 * use.used) / use.quota)) : 0;
  const pickRef = () => { const i = document.createElement("input"); i.type = "file"; i.accept = ".zip,application/zip"; i.multiple = true; i.onchange = () => i.files && ingest([...i.files]); i.click(); };

  return (
    <div className="shell">
      <nav className="side">
        <div className="brand" onClick={() => go("/")}><div className="logo"><Icon d={IC.play} size={20} /></div><div><h1>Render Studio</h1><p>Remotion + HyperFrames · in your browser</p></div></div>
        <button className="btn primary wide" onClick={pickRef}><Icon d={IC.upload} /> New project</button>
        <div className="navl"><button className={route === "/" ? "on" : ""} onClick={() => go("/")}><Icon d={IC.grid} /> Library</button><button className={route === "/showcase" ? "on" : ""} onClick={() => go("/showcase")}><Icon d={IC.film} /> Showcase <span className="badge">{renders.length}</span></button><button className={route === "/pc" ? "on" : ""} onClick={() => go("/pc")}><Icon d={IC.box} /> This computer</button></div>
        <div className="syscard">
          <div className="syshead"><b>System</b><button className="sysre" title="Re-detect this machine" onClick={() => detectMachineCached(true).then(setMachine)}>↻ Re-detect</button></div>
          {machine ? <>
            <div className="sysrow"><span>CPU</span><b>{machine.threads ? `${machine.threads} cores` : "Not reported"}</b></div>
            <div className="sysrow"><span>RAM</span><b>{machine.memGB ? `≥ ${machine.memGB} GB · approx.` : "Not reported"}</b></div>
            <div className="sysrow"><span>GPU</span><b title={machine.gpu}>{machine.gpu}</b></div>
          </> : <div className="sysrow"><span>Detecting this machine…</span></div>}
          <label className="l" style={{ marginTop: 6 }}>Render power</label>
          <Seg value={power.mode} onChange={(mode) => setPower({ mode, cores: power.cores || machine?.threads || 0 })} options={[["auto", "Auto"], ["custom", "Cores"], ["full", "Full power"]]} />
          {power.mode === "custom" && <select value={power.cores || machine?.threads || 1} onChange={(e) => setPower({ mode: "custom", cores: +e.target.value })}>{Array.from({ length: machine?.threads || navigator.hardwareConcurrency || 1 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} core{n > 1 ? "s" : ""}</option>)}</select>}
          <small className="sysnote">Cores set the worker count for HyperFrames render kits. The browser Remotion renderer draws frames on one thread, so Full power there means GPU encoding + the largest media cache. GPU info is read-only — no browser API can throttle a GPU.</small>
          <button className="btn sm" onClick={() => go("/pc")}>Full system details</button>
        </div>
        <div className="nh">Projects</div>
        <div className="plistside">{projects.map((p) => (
          <SideItem key={p.id} p={p} on={p.id === pid} count={renders.filter((r) => r.projectId === p.id).length} onClick={() => go(`/p/${p.id}/studio`)} />))}
          {!projects.length && <div className="hint" style={{ padding: "6px 10px" }}>Nothing here yet.</div>}</div>
        <div className="foot">
          <div className="meter"><div style={{ width: pct + "%" }} /></div>
          <small>{fmtB(use.used)} used in this browser{use.quota ? ` · ${pct}%` : ""}</small>
          <button className="btn sm danger" onClick={wipe}><Icon d={IC.trash} size={15} /> Clear all data</button>
          <small className="dim">Everything lives in your browser only. Clearing site data deletes it all.</small>
        </div>
      </nav>

      <main className="main">
        {!supported() && <div className="banner">Your browser doesn’t support WebCodecs. Please use <b>Chrome</b> or <b>Edge</b> on desktop to render.</div>}
        {route === "/" && <Home projects={projects} renders={renders} onFiles={ingest} onFolder={() => ingestFolder()} busy={busy} onOpen={(id) => go(`/p/${id}/studio`)} onDeleteProject={rmProject} onDeleteRender={rmRender} />}
        {route === "/pc" && <MachinePage toast={toast} />}
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
    </div>
  );
}
