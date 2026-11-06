import { useState } from "react";
import type { RenderRec } from "../lib/db";
import { fmtB, fmtD, fmtT, useObjectUrl } from "../lib/util";
import { Icon, IC, Modal } from "./ui";
import { askConfirm } from "../lib/confirm";

const Card = ({ r, showProject, onOpen }: { r: RenderRec; showProject: boolean; onOpen: () => void }) => {
  const th = useObjectUrl(r.thumb, "r_" + r.id);
  return (
    <div className="gi" onClick={onOpen}>
      <div className="thumb" style={th ? { backgroundImage: `url(${th})` } : undefined}>
        <div className="play"><Icon d={IC.play} size={22} /></div><span className="tag">{r.width}×{r.height}</span><span className="tag r">{r.savedTo ? "📁 " : ""}{r.container.toUpperCase()}</span>
      </div>
      <div className="in"><div className="nm">{r.name}</div>
        <div className="mt">{showProject && <b>{r.projectName} · </b>}{fmtB(r.size)} · {fmtD(r.createdAt)}</div></div>
    </div>
  );
};
const Viewer = ({ r, onDelete }: { r: RenderRec; onDelete: () => void }) => {
  const url = useObjectUrl(r.blob), th = useObjectUrl(r.thumb, "r_" + r.id);
  return (
    <div>
      {!r.blob && <div className="saved">{th && <img src={th} style={{ width: "100%", borderRadius: 14 }} />}<p>This file was saved to <b>{r.savedTo}</b> and isn’t stored in the browser library.</p></div>}
      {url && <video src={url} controls autoPlay loop style={{ width: "100%", borderRadius: 14, background: "#000", maxHeight: "62vh" }} />}
      <div className="vmeta"><div><b>{r.name}</b><div className="mt">{r.projectName} · {r.comp}</div></div>
        <div className="vst">{[["Size", fmtB(r.size)], ["Resolution", `${r.width}×${r.height}`], ["Codec", `${r.codec} · ${r.container}`], ["Frames", `${r.frames} @ ${r.fps}fps`], ["Rendered in", fmtT(r.renderMs)], ["Date", fmtD(r.createdAt)]].map(([k, v]) => <div key={k} className="stat"><small>{k}</small><b>{v}</b></div>)}</div>
        <div className="acts">{url && <a className="btn primary" href={url} download={r.name}><Icon d={IC.dl} /> Download</a>}<button className="btn danger" onClick={onDelete}><Icon d={IC.trash} /> Delete</button></div></div>
    </div>
  );
};
export const Gallery = ({ renders, showProject = false, onDelete, empty }: { renders: RenderRec[]; showProject?: boolean; onDelete: (id: string) => void; empty?: string }) => {
  const [open, setOpen] = useState<RenderRec | null>(null);
  if (!renders.length) return <div className="empty">{empty || "No renders yet — your finished videos will show up here."}</div>;
  return (<>
    <div className="gal">{renders.map((r) => <Card key={r.id} r={r} showProject={showProject} onOpen={() => setOpen(r)} />)}</div>
    {open && <Modal onClose={() => setOpen(null)}><Viewer r={open} onDelete={() => { void askConfirm({ title: "Delete this render?", message: "This finished video will be removed from your library. This cannot be undone.", confirmLabel: "Delete render", danger: true }).then((ok) => { if (ok) { onDelete(open.id); setOpen(null); } }); }} /></Modal>}
  </>);
};
