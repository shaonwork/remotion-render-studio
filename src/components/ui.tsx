import { ReactNode, useEffect } from "react";
export const Seg = <T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) => (
  <div className="seg">{options.map(([v, l]) => <button key={String(v)} className={v === value ? "on" : ""} onClick={() => onChange(v)}>{l}</button>)}</div>
);
export const Switch = ({ on, onChange, title, sub }: { on: boolean; onChange: (v: boolean) => void; title: string; sub?: string }) => (
  <div className={"sw" + (on ? " on" : "")} onClick={() => onChange(!on)}><div className="t"><b>{title}</b>{sub && <small>{sub}</small>}</div><div className="tg" /></div>
);
export const Field = ({ label, right, children }: { label: string; right?: ReactNode; children: ReactNode }) => (
  <div className="f"><label className="l">{label}{right != null && <span>{right}</span>}</label>{children}</div>
);
export const Ring = ({ pct }: { pct: number }) => (
  <div className="ring"><svg width="96" height="96" viewBox="0 0 96 96"><circle cx="48" cy="48" r="42" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="8" />
    <circle cx="48" cy="48" r="42" fill="none" stroke="url(#rg)" strokeWidth="8" strokeLinecap="round" strokeDasharray="264" strokeDashoffset={264 - (264 * pct) / 100} style={{ transition: "stroke-dashoffset .25s" }} />
    <defs><linearGradient id="rg"><stop offset="0" stopColor="#6d7cff" /><stop offset="1" stopColor="#b36cff" /></linearGradient></defs></svg><div className="n">{Math.round(pct)}%</div></div>
);
export const Modal = ({ onClose, children }: { onClose: () => void; children: ReactNode }) => {
  useEffect(() => { const f = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, [onClose]);
  return <div className="modal" onClick={onClose}><div className="mbox" onClick={(e) => e.stopPropagation()}><button className="mx" onClick={onClose}>✕</button>{children}</div></div>;
};
export const Icon = ({ d, size = 18 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
export const IC = { upload: "M12 16V4M7 9l5-5 5 5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3", play: "M8 5.5v13l11-6.5z", trash: "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3",
  film: "M4 4h16v16H4zM4 9h16M4 15h16M9 4v16M15 4v16", folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", dl: "M12 4v12M7 11l5 5 5-5M5 20h14", grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z", box: "M12 3l9 5v8l-9 5-9-5V8zM12 12l9-4M12 12v9M12 12L3 8" };
