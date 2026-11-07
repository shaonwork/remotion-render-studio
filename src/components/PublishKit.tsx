import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { fmtKitDur, type KitBox, type PublishKit as Kit } from "../lib/publishkit";
import { fmtB, useObjectUrl } from "../lib/util";
import { Icon, IC } from "./ui";

/* The Publish kit drawer: a slide-over panel from the right (same overlay
   language as the studio's modals) listing the open project's upload
   material — one box per field, each with its own Copy button, plus the
   thumbnail image with an individual Download. Hidden until the "Publish
   kit" button in the project view is pressed. */

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { /* clipboard API can refuse (permissions / non-secure context) — fall back */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove(); return ok;
  } catch { return false; }
}

const downloadBlob = (blob: Blob, name: string) => {
  const u = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 4000);
};

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(false), 1600); return () => clearTimeout(t); }, [done]);
  return <button className={"btn sm pkcopy" + (done ? " ok" : "")} onClick={async () => { if (await copyText(text)) setDone(true); }}>{done ? "✓ Copied" : "Copy"}</button>;
}

function ThumbBox({ box }: { box: Extract<KitBox, { kind: "thumb" }> }) {
  const url = useObjectUrl(box.blob);
  return (
    <div className="pkbox">
      <div className="pkhead"><span>{box.label}</span><span className="pksize">{fmtB(box.blob.size)}</span></div>
      {url ? <img className="pkthumb" src={url} alt={box.fileName} /> : <div className="pkthumb pkthumbload" />}
      <div className="pkfoot"><span className="pkfname" title={box.fileName}>{box.fileName}</span>
        <button className="btn sm" onClick={() => downloadBlob(box.blob, box.fileName)}><Icon d={IC.dl} size={15} /> Download</button></div>
    </div>
  );
}

function Box({ box }: { box: KitBox }) {
  if (box.kind === "thumb") return <ThumbBox box={box} />;
  return (
    <div className="pkbox">
      <div className="pkhead"><span>{box.label}</span>{box.kind === "copy" && <CopyBtn text={box.text} />}</div>
      <div className="pktext">{box.text}</div>
    </div>
  );
}

export function PublishKitDrawer({ kit, onClose, compIds, onRenderVersion }: { kit: Kit; onClose: () => void; compIds?: string[]; onRenderVersion?: (compositionId: string) => void }) {
  const [plat, setPlat] = useState(kit.platforms[0]?.id || "");
  useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, [onClose]);
  const cur = kit.platforms.find((p) => p.id === plat) || kit.platforms[0];
  /* Kit v2 names one composition (and one duration) per platform — show
     them for the active tab, with a shortcut that jumps straight to that
     composition in the project view, ready to render. The shortcut hides
     itself when the named composition isn't part of this project. */
  const canRender = !!(cur?.composition && onRenderVersion && compIds?.includes(cur.composition));
  /* Portal to <body>: the project view's entrance animation leaves an
     identity transform on an ancestor, which would otherwise become the
     containing block for this fixed-position overlay and misplace it. */
  return createPortal(
    <div className="pkbackdrop" onClick={onClose}>
      <aside className="pkdrawer" role="dialog" aria-label="Publish kit" onClick={(e) => e.stopPropagation()}>
        <div className="pkdhead">
          <div className="pkdtitle"><small>Publish kit</small><b>{kit.header}</b>{kit.sub && <span>{kit.sub}</span>}</div>
          <button className="mx" style={{ position: "static" }} onClick={onClose} aria-label="Close">✕</button>
        </div>
        {kit.platforms.length > 1 && <div className="seg pktabs">{kit.platforms.map((p) => <button key={p.id} className={cur?.id === p.id ? "on" : ""} onClick={() => setPlat(p.id)}>{p.label}</button>)}</div>}
        {cur && (cur.composition || cur.durationSec) && (
          <div className="pkmeta">
            {cur.composition && <span className="pkcomp" title="The composition to render for this platform">{cur.composition}</span>}
            {cur.durationSec != null && <span className="pkdur">{fmtKitDur(cur.durationSec)}</span>}
            {canRender && <button className="btn sm primary pkgo" onClick={() => onRenderVersion!(cur.composition!)}><Icon d={IC.play} size={14} /> Render this version</button>}
          </div>
        )}
        <div className="pklist">{cur?.boxes.map((b, i) => <Box key={i} box={b} />)}</div>
        <p className="hint pkfoot-note">Everything here lives inside this project’s ZIP — copy each field as you upload, and download the thumbnail on its own.</p>
      </aside>
    </div>,
    document.body
  );
}
