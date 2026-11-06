import { useRef } from "react";
import type { ProjectRec, RenderRec } from "../lib/db";
import { fmtB, fmtD, useObjectUrl } from "../lib/util";
import { Gallery } from "./Gallery";
import { Icon, IC } from "./ui";
import { fsaSupported } from "../lib/fsa";
import { askConfirm } from "../lib/confirm";

export const DropHero = ({ onFiles, busy, onFolder }: { onFiles: (f: File[]) => void; busy: string; onFolder: () => void }) => {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="drop" onClick={() => !busy && input.current?.click()}>
      <div className="ic"><Icon d={IC.upload} size={34} /></div>
      <h2>{busy || "Drop a project ZIP here"}</h2>
      <p>Drag &amp; drop · click to browse · or paste with <kbd>⌘</kbd>+<kbd>V</kbd> · Remotion, HyperFrames &amp; more — detected automatically</p>
      {busy && <div className="spin lg" style={{ margin: "18px auto 0" }} />}
      {!busy && fsaSupported() && <button className="btn" style={{ marginTop: 18 }} onClick={(e) => { e.stopPropagation(); onFolder(); }}><Icon d={IC.folder} /> Open a project folder instead</button>}
      <input ref={input} type="file" accept=".zip,application/zip" multiple hidden onChange={(e) => { if (e.target.files?.length) onFiles([...e.target.files]); e.target.value = ""; }} />
    </div>
  );
};
const PCard = ({ p, count, last, onOpen, onDelete }: { p: ProjectRec; count: number; last?: RenderRec; onOpen: () => void; onDelete: () => void }) => {
  const th = useObjectUrl(last?.thumb || p.thumb, "p_" + p.id);
  return (
    <div className="pc" onClick={onOpen}>
      <div className="pth" style={th ? { backgroundImage: `url(${th})` } : undefined}>{!th && <Icon d={IC.box} size={34} />}</div>
      <div className="pin"><div className="pn" title={p.name}>{p.name}</div><div className="mt">{fmtB(p.size)} · {fmtD(p.opened)}</div>
        <div className="pb"><span className="badge kind">{p.detLabel || "Remotion"}</span><span className="badge">{count} render{count === 1 ? "" : "s"}</span>{p.comps && <span className="badge">{p.comps.length} comp{p.comps.length === 1 ? "" : "s"}</span>}</div></div>
      <button className="pdel" title="Delete project" onClick={(e) => { e.stopPropagation(); onDelete(); }}><Icon d={IC.trash} size={16} /></button>
    </div>
  );
};
/* Library bar: how much this browser is holding for the studio, and the
   three library-wide actions — backup, restore, and the full clean. */
const LibraryBar = ({ used, quota, projects, renders, backupBusy, onBackup, onRestore, onClean }: { used: number; quota: number; projects: number; renders: number; backupBusy: string; onBackup: () => void; onRestore: () => void; onClean: () => void }) => {
  const pct = quota ? Math.min(100, Math.max(1, Math.round((100 * used) / quota))) : 0;
  return (
    <div className="card libbar">
      <div className="librow">
        <div className="libinfo">
          <b>Library &amp; cache</b>
          <div className="meter" style={{ margin: "9px 0 7px" }}><div style={{ width: pct + "%" }} /></div>
          <small className="mt">{quota ? <>{fmtB(used)} of ~{fmtB(quota)} used</> : <>{fmtB(used)} stored in this browser</>} · {projects} project{projects === 1 ? "" : "s"} · {renders} render{renders === 1 ? "" : "s"}</small>
        </div>
        <div className="libacts">
          <button className="btn sm" onClick={onBackup} disabled={!!backupBusy}><Icon d={IC.dl} size={15} /> {backupBusy || "Download backup"}</button>
          <button className="btn sm" onClick={onRestore}><Icon d={IC.upload} size={15} /> Restore backup…</button>
          <button className="btn sm danger" onClick={onClean}><Icon d={IC.trash} size={15} /> Clean everything</button>
        </div>
      </div>
      <p className="hint">A backup is one ZIP with every project and render in this library. Restoring adds them back as new copies — nothing is overwritten. “Clean everything” wipes the whole library, settings and caches, so take a backup first if you want to keep anything. Backup ZIPs are recognised automatically — you can also just drop one anywhere in the window.</p>
    </div>
  );
};

export const Home = ({ projects, renders, onFiles, onFolder, busy, onOpen, onDeleteProject, onDeleteRender, usage: use, backupBusy, onBackup, onRestore, onClean }: { projects: ProjectRec[]; renders: RenderRec[]; onFiles: (f: File[]) => void; onFolder: () => void; busy: string; onOpen: (id: string) => void; onDeleteProject: (id: string) => void; onDeleteRender: (id: string) => void; usage: { used: number; quota: number }; backupBusy: string; onBackup: () => void; onRestore: () => void; onClean: () => void }) => (
  <div>
    <DropHero onFiles={onFiles} busy={busy} onFolder={onFolder} />
    <LibraryBar used={use.used} quota={use.quota} projects={projects.length} renders={renders.length} backupBusy={backupBusy} onBackup={onBackup} onRestore={onRestore} onClean={onClean} />
    {projects.length > 0 && <><div className="sechead"><h2>Projects</h2><span className="badge">{projects.length}</span></div>
      <div className="plist">{projects.map((p) => { const rs = renders.filter((r) => r.projectId === p.id); return <PCard key={p.id} p={p} count={rs.length} last={rs[0]} onOpen={() => onOpen(p.id)} onDelete={() => { void askConfirm({ title: "Delete this project?", message: `Delete “${p.name}” and its ${rs.length} render(s)? The project and everything rendered from it will be removed from this browser.`, confirmLabel: "Delete project", danger: true }).then((ok) => { if (ok) onDeleteProject(p.id); }); }} />; })}</div></>}
    {renders.length > 0 && <><div className="sechead"><h2>Showcase</h2><span className="badge">{renders.length}</span></div><Gallery renders={renders.slice(0, 12)} showProject onDelete={onDeleteRender} /></>}
  </div>
);
