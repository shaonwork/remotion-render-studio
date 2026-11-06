import { useEffect, useRef, useState } from "react";

/* Custom in-app confirmation dialogs — the studio never uses the browser's
   native window.confirm / window.alert. One promise-based helper for every
   call site; dialogs queue if several are requested at once.

   Keyboard: Esc always cancels. Enter confirms only for non-destructive
   dialogs; for destructive ones focus starts on Cancel, so Enter is safe
   (it activates the focused button) and the red action needs a deliberate
   click or tab. Clicking the backdrop cancels. */

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};
type Req = ConfirmOptions & { resolve: (ok: boolean) => void };

let hostPush: ((r: Req) => void) | null = null;

/** Ask a yes/no question in the studio's own dialog. Resolves false when no
    dialog host is mounted, so a caller can never be trapped waiting. */
export const askConfirm = (opts: ConfirmOptions): Promise<boolean> =>
  new Promise((resolve) => { if (hostPush) hostPush({ ...opts, resolve }); else resolve(false); });

export function ConfirmHost() {
  const [queue, setQueue] = useState<Req[]>([]);
  const cur = queue[0];
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const lastFocus = useRef<Element | null>(null);

  useEffect(() => {
    hostPush = (r) => setQueue((q) => [...q, r]);
    return () => { hostPush = null; };
  }, []);

  useEffect(() => {
    if (!cur) return;
    lastFocus.current = document.activeElement;
    const t = setTimeout(() => (cur.danger ? cancelRef : confirmRef).current?.focus(), 30);
    return () => clearTimeout(t);
  }, [cur]);

  useEffect(() => {
    if (!cur) return;
    const f = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); settle(false); }
      else if (e.key === "Enter" && !cur.danger && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLSelectElement)) {
        e.preventDefault(); settle(true);
      }
    };
    window.addEventListener("keydown", f, true);   // capture: an underlying modal must not also react
    return () => window.removeEventListener("keydown", f, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur]);

  if (!cur) return null;
  const settle = (ok: boolean) => {
    cur.resolve(ok);
    setQueue((q) => q.slice(1));
    const el = lastFocus.current as HTMLElement | null;
    if (el && document.contains(el)) el.focus?.();
  };

  return (
    <div className="cmodal" onClick={() => settle(false)}>
      <div className="cbox enter" role="alertdialog" aria-modal="true" aria-label={cur.title} onClick={(e) => e.stopPropagation()}>
        <h3>{cur.title}</h3>
        <p>{cur.message}</p>
        <div className="cacts">
          <button ref={cancelRef} className="btn" onClick={() => settle(false)}>{cur.cancelLabel || "Cancel"}</button>
          <button ref={confirmRef} className={"btn " + (cur.danger ? "danger-solid" : "primary")} onClick={() => settle(true)}>{cur.confirmLabel || "OK"}</button>
        </div>
      </div>
    </div>
  );
}
