import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/* Ctrl+K command palette — the professional apps' quick-jump overlay.
   Items are plain actions built by App (views, projects, and — while a
   project is open — render commands, which App forwards to the project
   view as window events). Filtering is a light fuzzy match: every typed
   character must appear in order in the title, consecutive hits score
   higher. Arrow keys + Enter drive it; Esc closes. */

export type PalItem = { id: string; title: string; hint?: string; run: () => void };

const score = (q: string, t: string): number => {
  const s = t.toLowerCase();
  let qi = 0, sc = 0, last = -2;
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] === q[qi]) { sc += last === i - 1 ? 2 : 1; last = i; qi++; }
  }
  return qi === q.length ? sc : -1;
};

export function Palette({ items, onClose }: { items: PalItem[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return items;
    return items
      .map((it) => ({ it, sc: score(query, it.title) }))
      .filter((x) => x.sc >= 0)
      .sort((a, b) => b.sc - a.sc)
      .map((x) => x.it);
  }, [q, items]);
  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => {
    const el = listRef.current?.children[sel] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [sel]);
  const runItem = (it?: PalItem) => { if (!it) return; onClose(); it.run(); };
  /* Portalled to <body> for the same reason as the Publish kit drawer:
     a leftover transform on an ancestor would misplace the fixed overlay. */
  return createPortal(
    <div className="pkbackdrop palwrap" onClick={onClose}>
      <div className="pal" role="dialog" aria-label="Quick actions" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Type a command or a project name…"
          aria-label="Search commands"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(Math.max(0, list.length - 1), s + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            else if (e.key === "Enter") { e.preventDefault(); runItem(list[sel]); }
            else if (e.key === "Escape") { e.preventDefault(); onClose(); }
          }}
        />
        <div className="pallist" ref={listRef}>
          {list.map((it, i) => (
            <button key={it.id} className={"palitem" + (i === sel ? " on" : "")} onMouseEnter={() => setSel(i)} onClick={() => runItem(it)}>
              <span>{it.title}</span>{it.hint && <small>{it.hint}</small>}
            </button>
          ))}
          {!list.length && <div className="palempty">Nothing matches “{q}”.</div>}
        </div>
        <div className="palfoot"><span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span><span><kbd>Enter</kbd> run</span><span><kbd>Esc</kbd> close</span></div>
      </div>
    </div>,
    document.body
  );
}
