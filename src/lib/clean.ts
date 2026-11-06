/* "Clean everything" — a true factory reset for this origin. clearAll()
   already wipes IndexedDB (projects, renders AND the meta store that holds
   the saved output-folder handle) plus localStorage/sessionStorage. This
   adds the remaining stores a page can hold: Cache Storage entries, any
   service-worker registrations, and OPFS contents — then the caller
   reloads into the fresh first-run state. Every step is best-effort: one
   store refusing must not stop the others from being cleaned. */
import { clearAll } from "./db";

export async function cleanEverything(): Promise<void> {
  await clearAll();
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch { /* Cache Storage unavailable (e.g. some file:// contexts) */ }
  try {
    const regs = await navigator.serviceWorker?.getRegistrations();
    if (regs) await Promise.all(regs.map((r) => r.unregister()));
  } catch { /* no service workers — nothing to do */ }
  try {
    const getDir = (navigator.storage as any)?.getDirectory;
    if (typeof getDir === "function") {
      const root = await getDir.call(navigator.storage);
      for await (const name of (root as any).keys()) await root.removeEntry(name, { recursive: true });
    }
  } catch { /* OPFS empty or unavailable */ }
}
