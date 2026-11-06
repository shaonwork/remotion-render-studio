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
export const Home = ({ projects, renders, onFiles, onFolder, busy, onOpen, onDeleteProject, onDeleteRender }: { projects: ProjectRec[]; renders: RenderRec[]; onFiles: (f: File[]) => void; onFolder: () => void; busy: string; onOpen: (id: string) => void; onDeleteProject: (id: string) => void; onDeleteRender: (id: string) => void }) => (
  <div>
    <DropHero onFiles={onFiles} busy={busy} onFolder={onFolder} />
    {projects.length > 0 && <><div className="sechead"><h2>Projects</h2><span className="badge">{projects.length}</span></div>
      <div className="plist">{projects.map((p) => { const rs = renders.filter((r) => r.projectId === p.id); return <PCard key={p.id} p={p} count={rs.length} last={rs[0]} onOpen={() => onOpen(p.id)} onDelete={() => { void askConfirm({ title: "Delete this project?", message: `Delete “${p.name}” and its ${rs.length} render(s)? The project and everything rendered from it will be removed from this browser.`, confirmLabel: "Delete project", danger: true }).then((ok) => { if (ok) onDeleteProject(p.id); }); }} />; })}</div></>}
    {renders.length > 0 && <><div className="sechead"><h2>Showcase</h2><span className="badge">{renders.length}</span></div><Gallery renders={renders.slice(0, 12)} showProject onDelete={onDeleteRender} /></>}
  </div>
);
