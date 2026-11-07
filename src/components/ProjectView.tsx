import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Player } from "@remotion/player";
import { getProject, listRenders, putProject, putRender, deleteRender, uid, type ProjectRec, type RenderRec } from "../lib/db";
import { clearOutDir, ensureWrite, folderErrorText, fsaSupported, isStaleDirError, loadOutDir, pickDir, queryWrite, saveOutDir, writeToDir, type Dir, type WritePerm } from "../lib/fsa";
import { detectMachine, detectMachineCached, loadPref, mediaCacheCapMb, mediaCacheLabel, mediaCacheOptions, recommend } from "../lib/hw";
import { openZip, type Files } from "../lib/zip";
import { loadProject, type Loaded } from "../lib/compile";
import type { CompMeta } from "../lib/host";
import { defaultSettings, encodable, encodableAudio, makeProjectThumb, makeThumb, outputDims, outputHasAudio, probeEncoderMode, renderComposition, type Settings } from "../lib/render";
import { loadFinishSignal, notifyPermission, requestNotifyPermission, saveFinishSignal, signalRenderFinished } from "../lib/notify";
import { findPublishKit } from "../lib/publishkit";
import { PublishKitDrawer } from "./PublishKit";
import { fmtB, fmtT } from "../lib/util";
import { Field, Ring, Seg, Switch, Icon, IC } from "./ui";
import { Gallery } from "./Gallery";

type St = { status: "loading"; msg: string } | { status: "error"; err: string } | { status: "ready"; loaded: Loaded; files: Files; rec: ProjectRec };
type Job = { status: "idle" } | { status: "running" } | { status: "done"; ms: number; size: number; where: string; warn?: string; folderMsg?: string } | { status: "error"; err: string } | { status: "cancelled" };
/* A render whose folder copy is still owed: the blob + its library record,
   kept so the "Save to folder" button (a fresh user gesture, which is what
   the browser's permission prompt needs) can finish the job later. */
type PendingSave = { blob: Blob; fileName: string; rec: RenderRec };
/* "Render both platforms" queue: the publish kit's per-platform
   compositions, rendered one after another with the current settings. */
type QueueItem = { platform: string; label: string; compId: string };
type QueueResult = { label: string; ok: boolean; info: string };
type Queue = { items: QueueItem[]; idx: number; phase: "running" | "done" | "cancelled" | "partial"; results: QueueResult[] };

const downloadBlob = (blob: Blob, name: string) => {
  const u = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 4000);
};
type Prog = { p: number; rendered: number; encoded: number; eta: number; t0: number; fps: number; cores: number; mode: string };

/* The preview is sized from the STAGE BOX, not from width alone: a 9:16
   composition gets min(boxW, boxH*W/H) so the whole player — controls
   included — is always visible without scrolling the page. Measured with
   useLayoutEffect + ResizeObserver so the first paint is already correct. */
const FitPlayer = memo(function FitPlayer({ c, inputProps }: { c: CompMeta; inputProps: Record<string, unknown> }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = stageRef.current; if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 10 || !c.width || !c.height) return;
      const w = Math.max(2, Math.floor(Math.min(r.width, (r.height * c.width) / c.height)));
      const h = Math.max(2, Math.floor((w * c.height) / c.width));
      setSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
    };
    update();
    const ro = new ResizeObserver(update); ro.observe(el);
    return () => ro.disconnect();
  }, [c.id, c.width, c.height]);
  return (
    <div className="fitstage" ref={stageRef}>
      {size && (
        <div className="fitbox" style={{ width: size.w, height: size.h }}>
          <Player key={c.id} component={c.component} durationInFrames={c.durationInFrames!} compositionWidth={c.width!} compositionHeight={c.height!} fps={c.fps!} inputProps={inputProps} initialFrame={Math.min(c.durationInFrames! - 1, Math.round(c.durationInFrames! * 0.1))} controls loop acknowledgeRemotionLicense style={{ width: "100%", height: "100%" }} />
        </div>
      )}
    </div>
  );
});

/* Live render progress lives HERE, not in the page: it polls a mutable ref
   four times a second and re-renders only this small subtree. The page (and
   the Player) never re-render on progress ticks — that was the flicker. */
function ProgressPanel({ pref, frames }: { pref: { current: Prog }; frames: number }) {
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 250); return () => clearInterval(t); }, []);
  const p = pref.current;
  /* Chrome-only API; the row is simply absent where it doesn't exist.
     There is deliberately NO "CPU %" row: browsers do not expose real
     CPU usage to pages, so any such number would be invented. Speed,
     cores and the encoding path are the honest equivalents. */
  const memMB = (performance as any).memory?.usedJSHeapSize ? Math.round((performance as any).memory.usedJSHeapSize / 1048576) : 0;
  return (
    <div className="prog"><div className="ringrow"><Ring pct={p.p} />
      <div className="stats"><div className="stat"><small>Rendered</small><b>{p.rendered}/{frames}</b></div><div className="stat"><small>Encoded</small><b>{p.encoded}/{frames}</b></div>
        <div className="stat"><small>Speed</small><b>{p.fps > 0.05 ? p.fps.toFixed(1) + " fps" : "…"}</b></div><div className="stat"><small>Elapsed</small><b>{fmtT(Date.now() - p.t0)}</b></div>
        <div className="stat"><small>Remaining</small><b>{p.eta > 0 ? fmtT(p.eta) : "…"}</b></div><div className="stat"><small>Processor</small><b>{p.cores ? `${p.cores} cores` : "Not reported"}</b></div>
        {memMB > 0 && <div className="stat"><small>Memory (this tab)</small><b>{memMB} MB</b></div>}
        {p.mode && <div className="stat" style={{ gridColumn: "1 / -1" }}><small>Encoding</small><b>{p.mode}</b></div>}</div></div>
      <div className="pbar"><div style={{ width: p.p + "%" }} /></div>
      <div className="hint"><span className="pulse" />Rendering on this computer — keep this tab open and visible. Drawing the frames runs on your processor; the encoding row shows how the video itself is compressed.</div></div>
  );
}

export function ProjectView({ id, tab, setTab, onChanged, toast }: { id: string; tab: string; setTab: (t: string) => void; onChanged: () => void; toast: (m: string) => void }) {
  const [st, setSt] = useState<St>({ status: "loading", msg: "Unpacking ZIP…" });
  const [renders, setRenders] = useState<RenderRec[]>([]);
  const [comp, setComp] = useState(0);
  const [s, setS] = useState<Settings>(() => { try { const saved = localStorage.getItem("rs_set_" + id); const base = { ...defaultSettings(), ...(saved ? {} : loadPref() || {}), ...JSON.parse(saved || "{}") }; if (!saved) { const g = +(localStorage.getItem("rs_cache_mb") || 0); if (g > 0) base.mediaCacheMb = g; } return base; } catch { return defaultSettings(); } });
  const [outDir, setOutDir] = useState<Dir | null>(null);
  const [outPerm, setOutPerm] = useState<WritePerm | null>(null);
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const [kitOpen, setKitOpen] = useState(false);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [jobFrames, setJobFrames] = useState(0);   // frame count of the render actually running (the queue may render a different comp than the selected one)
  useEffect(() => { loadOutDir().then((h) => { setOutDir(h || null); if (h) queryWrite(h).then(setOutPerm); }); }, []);
  const chooseOut = async () => {
    try { const h = await pickDir("render-out", "readwrite"); await saveOutDir(h); setOutDir(h); setOutPerm("granted"); toast("Output folder: " + h.name); }
    catch (e: any) { if (e?.name !== "AbortError") toast("Couldn't use that folder: " + (e?.message || e)); }
  };
  const auto = async () => { const m = await detectMachine(); const r = recommend(m, (() => { try { return JSON.parse(localStorage.getItem("rs_bench") || "null"); } catch { return null; } })() || undefined); up(r.pref); toast("Optimized for this computer"); };
  /* RAM for the media-cache ladder: the same browser-reported figure the
     System card shows ("≥ N GB" — a lower bound, browsers round it down).
     Once detection lands, a stored cache choice above this machine's cap
     is clamped down to the cap. */
  const [ram, setRam] = useState<{ done: boolean; memGB: number | null }>({ done: false, memGB: null });
  useEffect(() => { let on = true; detectMachineCached().then((m) => { if (on) setRam({ done: true, memGB: m.memGB }); }).catch(() => { if (on) setRam({ done: true, memGB: null }); }); return () => { on = false; }; }, []);
  const capMb = mediaCacheCapMb(ram.memGB);
  useEffect(() => { if (ram.done && s.mediaCacheMb > capMb) up({ mediaCacheMb: capMb }); }, [ram.done, capMb]);
  const cacheOpts = mediaCacheOptions(ram.memGB);
  if (!cacheOpts.some((o) => o.mb === s.mediaCacheMb)) cacheOpts.push({ mb: s.mediaCacheMb, label: mediaCacheLabel(s.mediaCacheMb) });
  cacheOpts.sort((a, b) => a.mb - b.mb);
  const [codecs, setCodecs] = useState<string[]>([]);
  const [acodecs, setAcodecs] = useState<string[]>([]);
  const [job, setJob] = useState<Job>({ status: "idle" });
  const progressRef = useRef<Prog>({ p: 0, rendered: 0, encoded: 0, eta: 0, t0: 0, fps: 0, cores: 0, mode: "" });
  const [finishSig, setFinishSigState] = useState<boolean>(() => loadFinishSignal());
  const [, setPermTick] = useState(0);
  const setFinishSig = (v: boolean) => { saveFinishSignal(v); setFinishSigState(v); if (v) void requestNotifyPermission().then(() => setPermTick((x) => x + 1)); };
  const ac = useRef<AbortController | null>(null);

  const refresh = async () => setRenders(await listRenders(id));
  useEffect(() => {
    let dead = false, loaded: Loaded | undefined;
    setSt({ status: "loading", msg: "Unpacking ZIP…" }); setJob({ status: "idle" }); setComp(0); setKitOpen(false); setQueue(null); refresh();
    (async () => {
      try {
        const rec = await getProject(id); if (!rec) throw new Error("Project not found.");
        const o = await openZip(rec.zip); if (dead) return;
        setSt({ status: "loading", msg: "Compiling project in your browser…" });
        loaded = await loadProject(o.files, o.entry); if (dead) { loaded.revoke(); return; }
        /* hasKit is persisted on the record so the sidebar can offer its
           Publish item while this project is open (the sidebar never sees
           the project's files — only this view loads them). */
        const upd = { ...rec, opened: Date.now(), entry: o.entry, comps: loaded.comps.map((c) => c.id), hasKit: !!findPublishKit(o.files) || undefined }; await putProject(upd);
        setSt({ status: "ready", loaded, files: o.files, rec: upd }); onChanged();
        if (!upd.thumb) {   // capture a library thumbnail from the first composition, quietly in the background
          const first = loaded.comps[0];
          setTimeout(async () => { if (dead) return; const th = await makeProjectThumb(first, s.delayRenderMs); if (!th || dead) return;
            const u2 = { ...upd, thumb: th }; await putProject(u2);
            setSt((cur) => (cur.status === "ready" ? { ...cur, rec: u2 } : cur)); onChanged(); }, 1500);
        }
      } catch (e: any) { if (!dead) setSt({ status: "error", err: String(e.message || e) }); }
    })();
    return () => { dead = true; loaded?.revoke(); };
  }, [id]);
  useEffect(() => { localStorage.setItem("rs_set_" + id, JSON.stringify(s)); }, [s, id]);
  useEffect(() => { encodable(s.container, s.quality).then((c) => { setCodecs(c); if (c.length && !c.includes(s.codec)) setS((x) => ({ ...x, codec: (["h264", "h265", "vp9", "av1", "vp8"].find((k) => (c as string[]).includes(k)) || c[0]) as any })); }); }, [s.container, s.quality]);
  useEffect(() => { encodableAudio(s.container).then((c) => { setAcodecs(c); if (s.audioCodec !== "auto" && !(c as string[]).includes(s.audioCodec)) setS((x) => ({ ...x, audioCodec: "auto" })); }); }, [s.container]);

  const loaded = st.status === "ready" ? st.loaded : null, c = loaded?.comps[comp];
  /* Publish kit: detected from the project's own files (upload-kit/ folder).
     Null for projects without one — then no button appears at all. */
  const kit = useMemo(() => (st.status === "ready" ? findPublishKit(st.files) : null), [st]);
  const props = useMemo(() => { try { return { ...(c?.defaultProps || {}), ...JSON.parse(s.props || "{}") }; } catch { return c?.defaultProps || {}; } }, [c, s.props]);
  const frames = !c ? 0 : s.range === "test" ? Math.min(s.testFrames, c.durationInFrames!) : s.range === "custom" ? Math.max(1, Math.min(c.durationInFrames! - 1, s.to) - s.from + 1) : c.durationInFrames!;
  const up = (k: Partial<Settings>) => setS((x) => ({ ...x, ...k }));

  /* Render ONE composition with the current settings and save it exactly
     like a normal render (library record, folder copy, thumbnail). Shared
     by the single Start button and the platform queue; it throws on
     failure/abort so the caller decides the UI state. The finish signal
     is the caller's choice — the queue fires it once, at the very end. */
  const renderOne = async (cc: CompMeta, signalFinish: boolean): Promise<{ ms: number; size: number; where: string; warn?: string; folderMsg?: string; fileName: string }> => {
    const ctl = new AbortController(); ac.current = ctl; const t0 = Date.now();
    const cores = navigator.hardwareConcurrency || 0;
    const od = outputDims(cc.width!, cc.height!, s.scale, s.codec);
    const encMode = await probeEncoderMode(s.codec, od.width, od.height, s.hw, cc.fps || 30, s.quality);
    progressRef.current = { p: 0, rendered: 0, encoded: 0, eta: 0, t0, fps: 0, cores, mode: encMode };
    const itemFrames = s.range === "test" ? Math.min(s.testFrames, cc.durationInFrames!) : s.range === "custom" ? Math.max(1, Math.min(cc.durationInFrames! - 1, s.to) - s.from + 1) : cc.durationInFrames!;
    setJobFrames(itemFrames);
    const expectAudio = !s.muted && st.status === "ready" && Array.from(st.files.keys()).some((k) => /\.(mp3|wav|m4a|aac|ogg)$/i.test(k));
    /* Render speed + ETA are MEASURED, not taken on faith: a rolling
       ~2.5 s window over the renderer's own progress callbacks gives
       frames-per-second, and the ETA is the frames left ÷ that speed
       (falling back to the renderer's estimate until the window fills). */
    const samples: { t: number; r: number }[] = [];
    const res = await renderComposition(cc, s, ctl.signal, (p) => {
      const now = performance.now();
      samples.push({ t: now, r: p.rendered });
      while (samples.length > 2 && now - samples[0].t > 2500) samples.shift();
      const first = samples[0];
      const fpsNow = samples.length > 1 && now > first.t ? (p.rendered - first.r) / ((now - first.t) / 1000) : 0;
      const eta = fpsNow > 0.05 ? ((itemFrames - p.rendered) / fpsNow) * 1000 : p.etaMs;
      progressRef.current = { p: p.progress * 100, rendered: p.rendered, encoded: p.encoded, eta, t0, fps: fpsNow, cores, mode: encMode };
    }, expectAudio);
    let warn = res.warnings.join(" ");
    if (expectAudio && !(await outputHasAudio(res.blob))) warn = ("⚠ The finished file has NO audio track, although this project has sound. The browser media engine could not extract the audio — try the WebM format, or render with the downloadable kit / CLI, which handles audio natively. " + warn).trim();
    const thumb = await makeThumb(res.blob), base = (s.filename || cc.id).replace(/[^\w.\- ]+/g, "_"), stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
    const fileName = `${base}-${stamp}.${s.container}`;
    /* Folder save, told straight. Permission is re-checked NOW, at save
       time (it can lapse between choosing the folder and a long render
       finishing). Three honest outcomes: written to the folder; blocked —
       in which case the file is downloaded instead, the reason stays in
       the result area, and a button below can retry with a fresh click
       (the gesture the permission prompt needs); or no folder chosen. */
    let savedTo: string | undefined; let folderMsg: string | undefined; let folderBlocked = false;
    if (outDir) {
      const perm = await queryWrite(outDir); setOutPerm(perm);
      if (perm === "granted") {
        try { await writeToDir(outDir, fileName, res.blob); savedTo = `${outDir.name}/${fileName}`; }
        catch (e: any) { folderBlocked = true; folderMsg = folderErrorText(e, outDir.name); if (isStaleDirError(e)) { await clearOutDir(); setOutDir(null); setOutPerm(null); } }
      } else {
        folderBlocked = true;
        folderMsg = `The folder copy didn't happen — the browser hasn't given permission to write to “${outDir.name}”. Press “Save to folder” below to allow it and put the file there.`;
      }
    }
    const rec: RenderRec = { id: uid(), projectId: id, projectName: st.status === "ready" ? st.rec.name : "", comp: cc.id, name: fileName, createdAt: Date.now(), renderMs: res.renderMs, size: res.blob.size, mime: res.blob.type,
      container: s.container, codec: s.codec, width: od.width, height: od.height, fps: cc.fps!, frames: res.frames, settings: { ...s }, blob: s.keepCopy || !savedTo ? res.blob : undefined, thumb, savedTo };
    await putRender(rec); await refresh(); onChanged();
    if (folderBlocked) {
      downloadBlob(res.blob, fileName);   // the file still reaches the user, via Downloads
      if (outDir) setPendingSave({ blob: res.blob, fileName, rec });
      folderMsg = (folderMsg || "The folder copy didn't happen.") + " A copy was downloaded instead, so you still have the file.";
    }
    if (signalFinish) signalRenderFinished(fileName);
    return { ms: res.renderMs, size: res.blob.size, where: savedTo || "this browser", warn: warn || undefined, folderMsg, fileName };
  };

  const start = async () => {
    if (!c || st.status !== "ready") return;
    if (outDir) { const ok = await ensureWrite(outDir); setOutPerm(ok ? "granted" : "denied"); }   // permission prompt must run inside the click gesture
    setPendingSave(null); setQueue(null); setJob({ status: "running" });
    try {
      const r = await renderOne(c, true);
      setJob({ status: "done", ms: r.ms, size: r.size, where: r.where, warn: r.warn, folderMsg: r.folderMsg });
      toast(r.folderMsg ? "Render finished — the folder copy needs attention, see below" : r.warn ? "Render finished — with a warning, see below" : r.where !== "this browser" ? "Saved to " + r.where : "Render saved to your library");
    } catch (e: any) {
      if (ac.current?.signal.aborted) setJob({ status: "cancelled" }); else setJob({ status: "error", err: String(e.message || e) });
    }
  };

  /* The queue's targets: the kit's platforms whose named composition is
     actually in this project — Facebook first, then YouTube. Needs at
     least two DISTINCT compositions, so a v1 kit (one shared render for
     both platforms) never shows the button. */
  const bothTargets: QueueItem[] = useMemo(() => {
    if (!kit || !loaded) return [];
    const items = kit.platforms
      .filter((p) => p.composition && loaded.comps.some((x) => x.id === p.composition))
      .map((p) => ({ platform: p.id, label: p.label, compId: p.composition! }));
    if (new Set(items.map((i) => i.compId)).size < 2) return [];
    const order = ["facebook", "youtube"];
    return items.sort((a, b) => order.indexOf(a.platform) - order.indexOf(b.platform));
  }, [kit, loaded]);

  /* Render both platform versions back to back with the current settings.
     Strictly sequential — the same pipeline (encode plan, fallback chain,
     audio checks) one composition at a time. A failure is recorded and
     the queue moves on; a cancel aborts the current render and stops the
     queue. The finish chime/notification fires ONCE, at the very end. */
  const startBoth = async () => {
    if (!loaded || st.status !== "ready" || !bothTargets.length) return;
    if (outDir) { const ok = await ensureWrite(outDir); setOutPerm(ok ? "granted" : "denied"); }   // same click-gesture rule as Start
    setPendingSave(null);
    const items = bothTargets;
    setQueue({ items, idx: 0, phase: "running", results: [] });
    setJob({ status: "running" });
    const results: QueueResult[] = [];
    let cancelled = false, folderNote = "";
    for (let i = 0; i < items.length; i++) {
      setQueue({ items, idx: i, phase: "running", results: [...results] });
      const cc = loaded.comps.find((x) => x.id === items[i].compId);
      if (!cc) { results.push({ label: items[i].label, ok: false, info: "Composition not found in this project" }); continue; }
      setComp(loaded.comps.indexOf(cc));   // the preview follows the version being rendered
      try {
        const r = await renderOne(cc, false);
        if (r.folderMsg) folderNote = r.folderMsg;
        results.push({ label: items[i].label, ok: true, info: r.fileName });
      } catch (e: any) {
        if (ac.current?.signal.aborted) { cancelled = true; results.push({ label: items[i].label, ok: false, info: "Cancelled" }); break; }
        results.push({ label: items[i].label, ok: false, info: String(e.message || e) });
      }
    }
    const okCount = results.filter((r) => r.ok).length;
    setJob({ status: "idle" });
    if (cancelled) { setQueue({ items, idx: Math.max(0, results.length - 1), phase: "cancelled", results }); toast("Platform queue cancelled"); }
    else if (okCount === items.length) {
      signalRenderFinished(`${okCount} platform versions`);
      setQueue({ items, idx: items.length - 1, phase: "done", results });
      toast(folderNote ? "Both versions rendered — a folder copy needs attention, see the panel" : "Both platform versions rendered");
    } else if (okCount > 0) {
      signalRenderFinished(`${okCount} of ${items.length} platform versions`);
      setQueue({ items, idx: items.length - 1, phase: "partial", results });
      toast(`${okCount} of ${items.length} platform versions rendered — see the list in the panel`);
    } else {
      setQueue({ items, idx: items.length - 1, phase: "partial", results });
      toast("Both platform renders failed — see the list in the panel");
    }
  };

  /* Window-event commands from the sidebar and the Ctrl+K palette: open
     the kit drawer, start a render, start the platform queue. The refs
     always point at the latest closures, so one stable listener suffices,
     and the guards make inapplicable commands harmless no-ops. */
  const cmdRef = useRef({ start: () => {}, both: () => {}, canBoth: false, hasKit: false });
  cmdRef.current = {
    start: () => { if (job.status !== "running") void start(); },
    both: () => { if (job.status !== "running") void startBoth(); },
    canBoth: bothTargets.length > 0,
    hasKit: !!kit,
  };
  useEffect(() => {
    const openKit = () => setKitOpen(true);
    const cmd = (e: Event) => {
      const a = (e as CustomEvent).detail;
      if (a === "start") cmdRef.current.start();
      else if (a === "both" && cmdRef.current.canBoth) cmdRef.current.both();
      else if (a === "kit" && cmdRef.current.hasKit) setKitOpen(true);
    };
    window.addEventListener("rs-open-kit", openKit);
    window.addEventListener("rs-cmd", cmd);
    return () => { window.removeEventListener("rs-open-kit", openKit); window.removeEventListener("rs-cmd", cmd); };
  }, []);

  /* Retry the owed folder copy. This click IS the user gesture the
     browser's permission prompt requires, so it can succeed where the
     automatic post-render attempt (minutes after the last click) could not. */
  const savePendingToFolder = async () => {
    if (!pendingSave || !outDir) return;
    if (!(await ensureWrite(outDir))) { setOutPerm("denied"); toast(`The browser still hasn't given permission to write to “${outDir.name}”. The downloaded copy is yours to keep.`); return; }
    setOutPerm("granted");
    try {
      await writeToDir(outDir, pendingSave.fileName, pendingSave.blob);
      const savedTo = `${outDir.name}/${pendingSave.fileName}`;
      await putRender({ ...pendingSave.rec, savedTo }); await refresh(); onChanged();
      setPendingSave(null);
      setJob((j) => (j.status === "done" ? { ...j, where: savedTo, folderMsg: undefined } : j));
      toast("Saved to " + savedTo);
    } catch (e: any) {
      if (isStaleDirError(e)) { await clearOutDir(); setOutDir(null); setOutPerm(null); setPendingSave(null); }
      toast(folderErrorText(e, outDir.name));
    }
  };
  const running = job.status === "running";

  if (st.status === "loading") return <div className="center" style={{ flex: 1 }}><div className="spin lg" /><p>{st.msg}</p></div>;
  if (st.status === "error") return <div className="card errcard"><h3>Couldn’t open this project</h3><pre>{st.err}</pre><button className="btn" onClick={() => location.reload()}>Retry</button></div>;
  const hasAudio = c && Array.from(st.files.keys()).some((k) => /\.(mp3|wav|m4a|aac|ogg)$/i.test(k));
  const bytes = Array.from(st.files.values()).reduce((a, b) => a + b.length, 0);

  return (
    <div className="workview enter">
      <div className="phead"><div><h1 title={st.rec.name}>{st.rec.name}</h1><p className="mt">{st.rec.entry} · {st.files.size} files · {fmtB(bytes)} unpacked</p></div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {kit && <button className="btn" onClick={() => setKitOpen(true)}><Icon d={IC.upload} size={16} /> Publish kit</button>}
          <div className="tabs" style={{ marginLeft: 0 }}>{[["studio", "Studio"], ["renders", `Renders (${renders.length})`], ["files", "Files"]].map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
        </div></div>
      {kit && kitOpen && <PublishKitDrawer kit={kit} onClose={() => setKitOpen(false)} compIds={loaded?.comps.map((x) => x.id)} onRenderVersion={(cid) => { const i = loaded?.comps.findIndex((x) => x.id === cid) ?? -1; if (i >= 0) { setComp(i); setTab("studio"); } setKitOpen(false); }} />}

      {tab === "renders" && <div className="workscroll"><Gallery renders={renders} onDelete={async (rid) => { await deleteRender(rid); await refresh(); onChanged(); }} empty="Nothing rendered from this project yet. Head to the Studio tab and press Start render." /></div>}

      {tab === "files" && <div className="workscroll"><div className="card"><div className="flist" style={{ maxHeight: "none" }}>{Array.from(st.files.entries()).sort().map(([k, v]) => <div key={k}><span>{k}</span><small>{fmtB(v.length)}</small></div>)}</div></div></div>}

      {tab === "studio" && c && (
        <div className="workgrid">
          <div className="stagecol">
            <div className="card pvcard">
              <FitPlayer c={c} inputProps={props} />
              <p className="hint" style={{ padding: "0 6px" }}>Live preview — it plays right here in your browser. The finished render is frame-exact.</p>
            </div>
            {loaded!.comps.length > 1 && <div className="card compscard"><h3>Compositions</h3><p className="sub" style={{ marginBottom: 0 }}>Pick the scene you want to preview and render.</p><div className="comps">{loaded!.comps.map((x, i) => <div key={x.id} className={"comp" + (i === comp ? " on" : "")} onClick={() => setComp(i)}><b title={x.id}>{x.id}</b><small>{x.width}×{x.height} · {x.fps}fps · {((x.durationInFrames || 0) / (x.fps || 30)).toFixed(1)}s</small></div>)}</div></div>}
            {loaded!.warnings.length > 0 && <div className="card warn warncard">{loaded!.warnings.join("\n")}</div>}
          </div>

          <aside className="panelcol"><div className="card panelcard">
            <div className="panelhead">
              <h3><i>▶</i>Render this video <button className="btn sm" style={{ marginLeft: "auto" }} onClick={auto}>⚡ Auto-optimize</button></h3>
              <p className="sub">{c.id} · {c.width}×{c.height} · {c.fps}fps · {frames} frames ({(frames / c.fps!).toFixed(1)}s)<br />The standard choices below are right for most videos — you can simply press <b>Start render</b>.</p>
            </div>
            <div className="panelbody">
              <div className="row"><Field label="Video format"><Seg value={s.container} onChange={(v) => up({ container: v as any })} options={[["mp4", "MP4"], ["webm", "WebM"], ["mkv", "MKV"], ["mov", "MOV"]]} /></Field></div>
              <p className="hint" style={{ margin: "-6px 0 12px" }}>MP4 plays almost everywhere. WebM is smaller; MOV and MKV suit editing tools.</p>
              <div className="row"><Field label="Quality"><Seg value={s.quality} onChange={(v) => up({ quality: v })} options={[["low", "Draft"], ["medium", "Good"], ["high", "High"], ["very-high", "Max"]]} /></Field></div>
              <p className="hint" style={{ margin: "-6px 0 12px" }}>Higher quality looks sharper, but the file gets bigger and the render slower.</p>
              <div className="row"><Field label="Video size"><Seg value={s.scale} onChange={(v) => up({ scale: v })} options={[[0.5, "Half"], [1, "Full"], [1.5, "1.5×"], [2, "2×"]]} /></Field></div>
              <p className="hint" style={{ margin: "-6px 0 12px" }}>Full size is {c.width}×{c.height} — the size this video was made at. Half size renders much faster, handy for a quick check.</p>
              <div className="row"><Field label="How much to render"><Seg value={s.range} onChange={(v) => up({ range: v })} options={[["full", "Full video"], ["test", "Quick test"], ["custom", "Part only"]]} /></Field></div>
              {s.range === "test" && <><div className="row"><Field label="Frames to test"><input type="number" min={1} value={s.testFrames} onChange={(e) => up({ testFrames: +e.target.value })} /></Field></div>
                <p className="hint" style={{ margin: "-6px 0 12px" }}>Renders only the first frames, so you can check the look before committing to the full video.</p></>}
              {s.range === "custom" && <><div className="row"><Field label="From frame"><input type="number" min={0} value={s.from} onChange={(e) => up({ from: +e.target.value })} /></Field><Field label="To frame"><input type="number" min={0} value={s.to} onChange={(e) => up({ to: +e.target.value })} /></Field></div>
                <p className="hint" style={{ margin: "-6px 0 12px" }}>Frame numbers — this video has {c.durationInFrames} frames at {c.fps}fps.</p></>}
              {hasAudio && <Switch on={!s.muted} onChange={(v) => up({ muted: !v })} title="Sound" sub="Keep the voice, music and effects in the finished video. Turn off for a silent video." />}
              <div className="row"><Field label="Save finished videos to">{fsaSupported() ? <div className="folder"><span className={outDir ? "" : "dim"} title={outDir ? outDir.name : undefined}>{outDir ? outDir.name : "Not set — kept in your library"}</span><button className="btn sm" onClick={chooseOut}>Choose…</button>{outDir && <button className="btn sm" title="Forget folder" onClick={async () => { await clearOutDir(); setOutDir(null); setOutPerm(null); }}>✕</button>}</div> : <p className="hint">Folder saving needs Chrome or Edge.</p>}</Field></div>
              {outDir && outPerm && outPerm !== "granted" && <p className="hint" style={{ margin: "-6px 0 12px" }}>The browser still needs your OK to write to “{outDir.name}” — it will ask when you press Start render, and finished videos go there automatically once allowed.</p>}
              {outDir && <Switch on={s.keepCopy} onChange={(v) => up({ keepCopy: v })} title="Also keep a copy in the library" sub="Turn off to save browser storage" />}
              <div className="row"><Field label="File name"><input type="text" placeholder={c.id} value={s.filename} onChange={(e) => up({ filename: e.target.value })} /></Field></div>
              <Switch on={finishSig} onChange={setFinishSig} title="Sound + notification when a render finishes" sub="Plays a short chime in this tab when a render completes. A system notification appears too, once you allow it below." />
              {finishSig && notifyPermission() === "default" && <div style={{ margin: "2px 0 10px" }}><button className="btn sm" onClick={() => void requestNotifyPermission().then(() => setPermTick((x) => x + 1))}>Allow notifications</button></div>}
              {finishSig && notifyPermission() === "denied" && <p className="hint" style={{ margin: "-2px 0 12px" }}>Notifications are blocked for this site in the browser settings — the chime will still play.</p>}
              {finishSig && notifyPermission() === "unsupported" && <p className="hint" style={{ margin: "-2px 0 12px" }}>This browser has no system notifications — the chime will still play.</p>}

              <details className="adv"><summary>Advanced settings</summary>
                <div className="row"><Field label="Video codec"><select value={s.codec} onChange={(e) => up({ codec: e.target.value as any })}>{codecs.length ? codecs.map((x) => <option key={x} value={x}>{x.toUpperCase()}</option>) : <option>—</option>}</select></Field></div>
                <p className="hint" style={{ margin: "-6px 0 12px" }}>The compression flavour inside the file. The studio picks a good one for your format — change it only if a player refuses the result.</p>
                <div className="row"><Field label="Encoder — graphics card or processor"><Seg value={s.hw} onChange={(v) => up({ hw: v })} options={[["no-preference", "Auto"], ["prefer-hardware", "GPU"], ["prefer-software", "CPU"]]} /></Field></div>
                <p className="hint" style={{ margin: "-6px 0 12px" }}>GPU encoding is faster when your computer supports it. Auto lets the browser decide.</p>
                <Switch on={s.hw === "prefer-hardware" && s.mediaCacheMb >= capMb} onChange={(v) => up(v ? { hw: "prefer-hardware", mediaCacheMb: capMb } : { hw: "no-preference", mediaCacheMb: 0 })} title="Turbo mode — full power" sub={`GPU-preferred encoding + the largest media cache for this computer's RAM (${mediaCacheLabel(capMb)} here). Drawing the frames themselves is single-threaded in the browser renderer; the core-count choice on the Settings page applies to HyperFrames kits.`} />
                {hasAudio && !s.muted && <><div className="row"><Field label="Sound format"><select value={s.audioCodec} onChange={(e) => up({ audioCodec: e.target.value as any })}><option value="auto">Auto (recommended)</option>{acodecs.map((x) => <option key={x} value={x}>{x.toUpperCase()}</option>)}</select></Field></div>
                  <div className="row"><Field label="Sound quality"><Seg value={s.audioBitrate} onChange={(v) => up({ audioBitrate: v })} options={[["auto", "Auto"], ["low", "Low"], ["medium", "Med"], ["high", "High"], ["very-high", "Max"]]} /></Field></div></>}
                {(s.container === "webm" || s.container === "mkv") && <Switch on={s.transparent} onChange={(v) => up({ transparent: v })} title="Transparent background" sub="Keep the see-through (alpha) parts of the video — the web renderer supports this only for WebM / MKV with VP8 or VP9." />}
                <div className="row"><Field label="Patience for slow frames"><Seg value={s.delayRenderMs} onChange={(v) => up({ delayRenderMs: v })} options={[[0, "Normal"], [60000, "1 min"], [120000, "2 min"], [300000, "5 min"], [600000, "10 min"]]} /></Field></div>
                <p className="hint" style={{ margin: "-6px 0 12px" }}>How long a single frame may wait for videos, fonts and images to load before the render gives up. Heavy projects with lots of stock video sometimes need more time — if a render ever fails with a “delayRender” timeout, raise this.</p>
                <div className="row"><Field label="Keyframe every (seconds)"><input type="number" min={0} step={0.5} placeholder="Encoder default" value={s.keyframeSec || ""} onChange={(e) => up({ keyframeSec: +e.target.value })} /></Field>
                  <Field label="Memory kept for videos"><select value={s.mediaCacheMb} onChange={(e) => up({ mediaCacheMb: +e.target.value })}>{cacheOpts.map((o) => <option key={o.mb} value={o.mb}>{o.label}</option>)}</select></Field></div>
                <p className="hint" style={{ margin: "-4px 0 10px" }}>{ram.memGB ? <>Highest here is ~70% of the RAM this browser reports (≥ {ram.memGB} GB → {mediaCacheLabel(capMb)}). </> : <>This browser doesn't report how much RAM this computer has, so the choices stop at 2 GB. </>}It's a ceiling, not a reservation — the cache only uses what your project's media actually needs, keeping large videos ready instead of re-reading them for every frame.</p>
                <Field label="Input props (JSON)"><textarea spellCheck={false} value={s.props} onChange={(e) => up({ props: e.target.value })} /></Field>
                <p className="hint">Data handed to your composition — only needed if the project was built to accept it.</p>
                <Field label="Remotion license key"><input type="text" defaultValue={localStorage.getItem("rs_license") || "free-license"} onChange={(e) => localStorage.setItem("rs_license", e.target.value.trim() || "free-license")} /></Field>
                <p className="hint">“free-license” is for individuals &amp; teams that qualify for Remotion’s <a href="https://remotion.dev/license" target="_blank" rel="noreferrer">Free License</a>. Otherwise enter your company license key.</p>
              </details>
            </div>
            <div className="panelfoot">
              <button className={"btn big " + (running ? "stop" : "primary")} onClick={running ? () => ac.current?.abort() : start}>{running ? "Cancel render" : "Start render"}</button>
              {!running && bothTargets.length > 0 && (
                <button className="btn big queuebtn" onClick={startBoth} title="Render the Facebook version, then the YouTube version, one after the other with these settings">
                  Render both platforms — {bothTargets.map((t) => t.label).join(" + ")}
                </button>
              )}
              {job.status === "running" && queue?.phase === "running" ? (
                <div className="qbox">
                  <div className="qhead"><span className="pulse" /><b>Rendering {queue.items[queue.idx].label} version · {queue.idx + 1} of {queue.items.length}</b></div>
                  <ProgressPanel pref={progressRef} frames={jobFrames || frames} />
                  {queue.results.length > 0 && <div className="qlist">{queue.results.map((r, i) => <div key={i} className="qitem">{r.ok ? "✓" : "✗"} {r.label} — <span>{r.info}</span></div>)}</div>}
                </div>
              ) : job.status === "running" && <ProgressPanel pref={progressRef} frames={jobFrames || frames} />}
              {queue && queue.phase !== "running" && job.status !== "running" && (
                <div className={"result" + (queue.phase === "partial" ? " err" : "")}>
                  <b>{queue.phase === "done" ? "✓ Both platform versions rendered" : queue.phase === "cancelled" ? "Platform queue cancelled" : "Platform queue finished — with problems"}</b>
                  <div className="qlist">{queue.results.map((r, i) => <div key={i} className="qitem">{r.ok ? "✓" : "✗"} {r.label} — <span>{r.info}</span></div>)}</div>
                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="btn sm" onClick={() => setTab("renders")}>Open renders</button>
                    {kit && <button className="btn sm" onClick={() => setKitOpen(true)}>Open Publish kit</button>}
                    {pendingSave && outDir && <button className="btn sm" onClick={savePendingToFolder}>Save to “{outDir.name}”</button>}
                  </div>
                </div>
              )}
              {job.status === "done" && <div className="result"><b>✓ Done in {fmtT(job.ms)}</b><div className="hint" style={{ color: "var(--text)" }}>{fmtB(job.size)} · saved in {job.where}</div>{job.warn && <div className="hint" style={{ color: "var(--warn)", fontWeight: 600 }}>{job.warn}</div>}{job.folderMsg && <div className="hint" style={{ color: "var(--warn)", fontWeight: 600 }}>{job.folderMsg}</div>}<button className="btn sm" style={{ marginTop: 10 }} onClick={() => setTab("renders")}>Open renders</button>{kit && <button className="btn sm" style={{ marginTop: 10, marginLeft: 8 }} onClick={() => setKitOpen(true)}>Open Publish kit</button>}{pendingSave && outDir && <button className="btn sm" style={{ marginTop: 10, marginLeft: 8 }} onClick={savePendingToFolder}>Save to “{outDir.name}”</button>}</div>}
              {job.status === "cancelled" && <div className="result err"><b>Render cancelled</b></div>}
              {job.status === "error" && <div className="result err"><b>Render failed</b><pre>{job.err}</pre></div>}
            </div>
          </div></aside>
        </div>
      )}
    </div>
  );
}
