/* Render-finished signal: a short synthesized chime (WebAudio — no audio
   file to ship) plus, when the user has allowed it, a browser Notification.
   One global preference (localStorage), default ON for sound. Browsers only
   grant notification permission from a user gesture, so permission is
   requested when the toggle is switched on / the Allow button is clicked —
   never at render time. */

const KEY = "rs_finish_signal";

export const loadFinishSignal = (): boolean => {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
};
export const saveFinishSignal = (on: boolean) => {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* private mode etc. */ }
};

export const notifyPermission = (): NotificationPermission | "unsupported" =>
  "Notification" in window ? Notification.permission : "unsupported";

export async function requestNotifyPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!("Notification" in window)) return "unsupported";
  try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}

let actx: AudioContext | null = null;
/** Two soft sine notes (E6 → A6) with a quick attack and a gentle decay. */
export function playChime(): void {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    actx ??= new AC();
    if (actx.state === "suspended") void actx.resume();
    const t0 = actx.currentTime;
    [[1318.51, 0], [1760.0, 0.13]].forEach(([freq, off]) => {
      const osc = actx!.createOscillator(), g = actx!.createGain();
      osc.type = "sine"; osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0 + off);
      g.gain.exponentialRampToValueAtTime(0.14, t0 + off + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + off + 0.85);
      osc.connect(g); g.connect(actx!.destination);
      osc.start(t0 + off); osc.stop(t0 + off + 0.9);
    });
  } catch { /* audio is a nicety — never let it break a finished render */ }
}

/** Fire the signal for a completed render. Respects the toggle; the
    notification only fires when permission was already granted. */
export function signalRenderFinished(name: string): void {
  if (!loadFinishSignal()) return;
  playChime();
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Render finished", { body: name });
    }
  } catch { /* notifications are best-effort */ }
}
