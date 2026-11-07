import { useEffect, useRef, useState } from "react";
import { zipSync, strToU8, type Zippable } from "fflate";
import { getProject, putProject, type ProjectRec } from "../lib/db";
import { openAny, type Files } from "../lib/zip";
import { buildPlayer, type BuiltPlayer } from "../lib/hfplayer";
import { shrinkImage } from "../lib/render";
import { fmtB } from "../lib/util";
import { Field, Icon, IC, Seg, Switch } from "./ui";
import { loadPower, powerWorkers } from "../lib/hw";

type St =
  | { status: "loading"; msg: string }
  | { status: "error"; err: string }
  | { status: "ready"; built: BuiltPlayer; files: Files; rec: ProjectRec };

const fmtS = (s: number) => {
  const m = Math.floor(s / 60), ss = Math.floor(s % 60), d = Math.floor((s * 10) % 10);
  return `${m}:${String(ss).padStart(2, "0")}.${d}`;
};

/* The transport bar owns the fast-moving playhead state. The player posts
   its time many times a second; keeping that in the page component made the
   whole view (settings panel included) re-render constantly — the flicker.
   Here the time is polled from a ref at 4Hz into this small subtree only. */
function HFTransport({ duration, playing, ready, muted, timeRef, onToggle, onMute, onSeek, onFullscreen }: {
  duration: number; playing: boolean; ready: boolean; muted: boolean;
  timeRef: { current: number };
  onToggle: () => void; onMute: () => void; onSeek: (v: number) => void; onFullscreen: () => void;
}) {
  const [t, setT] = useState(0);
  const drag = useRef(false);
  useEffect(() => { const iv = setInterval(() => { if (!drag.current) setT(timeRef.current); }, 250); return () => clearInterval(iv); }, [timeRef]);
  return (
    <div className="hfbar">
      <button className="btn primary" onClick={onToggle} disabled={!ready}>{playing ? "❚❚ Pause" : "▶ Play"}</button>
      <input type="range" min={0} max={duration} step={0.01} value={Math.min(t, duration)}
        onPointerDown={() => (drag.current = true)} onPointerUp={() => (drag.current = false)}
        onChange={(e) => { const v = +e.target.value; setT(v); onSeek(v); }} />
      <span className="hftime">{fmtS(t)} / {fmtS(duration)}</span>
      <button className={"btn sm" + (muted ? " on" : "")} onClick={onMute}>{muted ? "Unmute" : "Mute"}</button>
      <button className="btn sm" onClick={onFullscreen}>Fullscreen</button>
    </div>
  );
}

/* ---- HyperFrames render settings → real `hyperframes render` CLI flags (v0.9.12) ---- */
type HFSettings = {
  format: "mp4" | "webm" | "mov" | "gif" | "hls"; quality: "draft" | "standard" | "looks" | "delivery"; fps: string; res: string; workers: string; name: string;
  composition: string; rateMode: "quality" | "crf" | "bitrate"; crf: string; bitrate: string; maxBitrate: string; keyframe: string;
  start: string; end: string; prores: "4444" | "hq" | "422" | "lt" | "proxy"; gifLoop: string; hlsSeg: string;
  frameFormat: "auto" | "jpg" | "png"; motionBlurOff: boolean; gpu: boolean; browserGpu: "auto" | "gpu" | "software";
  color: "auto" | "hdr" | "sdr"; lowMem: "auto" | "on" | "off"; docker: boolean; strict: boolean; variables: string; strictVars: boolean;
};
const defaultHF = (): HFSettings => ({ format: "mp4", quality: "looks", fps: "default", res: "orig", workers: "auto", name: "", composition: "", rateMode: "quality", crf: "", bitrate: "", maxBitrate: "", keyframe: "", start: "", end: "", prores: "4444", gifLoop: "", hlsSeg: "", frameFormat: "auto", motionBlurOff: false, gpu: false, browserGpu: "auto", color: "auto", lowMem: "auto", docker: false, strict: false, variables: "", strictVars: false });
/** Variables only count when the field holds a non-empty JSON object — then the kit ships it as variables.json and the CLI reads it via --variables-file. */
const varsObj = (s: HFSettings): Record<string, unknown> | null => {
  try { const v = JSON.parse(s.variables || ""); return v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length ? v : null; } catch { return null; }
};

const RES_PRESETS: { key: string; w: number; h: number; label: string }[] = [
  { key: "landscape", w: 1920, h: 1080, label: "1920×1080" },
  { key: "landscape-4k", w: 3840, h: 2160, label: "3840×2160 (4K)" },
  { key: "portrait", w: 1080, h: 1920, label: "1080×1920" },
  { key: "portrait-4k", w: 2160, h: 3840, label: "2160×3840 (4K)" },
  { key: "square", w: 1080, h: 1080, label: "1080×1080" },
  { key: "square-4k", w: 2160, h: 2160, label: "2160×2160 (4K)" },
];
const resOptions = (w: number, h: number): [string, string][] => {
  const opts: [string, string][] = [["orig", `Original (${w}×${h})`]];
  for (const p of RES_PRESETS) {
    const sx = p.w / w, sy = p.h / h;
    if (Number.isInteger(sx) && sx === sy && sx >= 1) opts.push([p.key, p.label]);
  }
  return opts;
};
/** Worker counts offered in the panel: sensible steps up to the detected core count (navigator.hardwareConcurrency), plus the current value if it falls outside the steps. */
const workerOptions = (current: string): number[] => {
  const max = navigator.hardwareConcurrency || 0;
  const base = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32].filter((n) => (max === 0 ? n <= 4 : n <= max));
  if (max > 0 && !base.includes(max)) base.push(max);
  const cur = parseInt(current, 10);
  if (Number.isFinite(cur) && cur > 0 && !base.includes(cur)) base.push(cur);
  return base.sort((a, b) => a - b);
};
const outName = (s: HFSettings, recName: string) => (s.name.trim() || recName).replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "-");
const cmdFlags = (s: HFSettings, recName: string) => {
  const parts = [`--format ${s.format}`];
  /* --quality, --crf and --video-bitrate are mutually exclusive rate controls */
  if (s.rateMode === "crf" && s.crf.trim() !== "") parts.push(`--crf ${s.crf.trim()}`);
  else if (s.rateMode === "bitrate" && s.bitrate.trim() !== "") parts.push(`--video-bitrate ${s.bitrate.trim()}`);
  else parts.push(`--quality ${s.quality}`);
  parts.push(`--output "renders/${outName(s, recName)}.${s.format}"`);
  if (s.composition) parts.push(`--composition ${s.composition}`);
  if (s.fps !== "default") parts.push(`--fps ${s.fps}`);
  if (s.res !== "orig") parts.push(`--resolution ${s.res}`);
  if (s.workers !== "auto") parts.push(`--workers ${s.workers}`);
  if ((s.format === "mp4" || s.format === "webm") && s.rateMode !== "bitrate" && s.maxBitrate.trim() !== "") parts.push(`--max-bitrate ${s.maxBitrate.trim()}`);
  if (s.format === "mp4" && s.keyframe.trim() !== "") parts.push(`--keyframe-interval ${s.keyframe.trim()}`);
  if (s.format === "mp4") {
    if (s.start.trim() !== "" && +s.start > 0) parts.push(`--start ${s.start.trim()}`);
    if (s.end.trim() !== "" && +s.end > 0) parts.push(`--end ${s.end.trim()}`);
  }
  if (s.format === "mov" && s.prores !== "4444") parts.push(`--prores-profile ${s.prores}`);
  if (s.format === "gif" && s.gifLoop.trim() !== "") parts.push(`--gif-loop ${s.gifLoop.trim()}`);
  if (s.format === "hls" && s.hlsSeg.trim() !== "" && s.hlsSeg.trim() !== "4") parts.push(`--hls-segment-seconds ${s.hlsSeg.trim()}`);
  if (s.frameFormat !== "auto") parts.push(`--video-frame-format ${s.frameFormat}`);
  if (s.motionBlurOff) parts.push(`--page-motion-blur off`);
  if (s.gpu) parts.push(`--gpu`);
  if (s.browserGpu === "gpu") parts.push(`--browser-gpu`); else if (s.browserGpu === "software") parts.push(`--no-browser-gpu`);
  if (s.color === "hdr") parts.push(`--hdr`); else if (s.color === "sdr") parts.push(`--sdr`);
  if (s.lowMem === "on") parts.push(`--low-memory-mode`); else if (s.lowMem === "off") parts.push(`--no-low-memory-mode`);
  if (s.docker) parts.push(`--docker`);
  if (s.strict) parts.push(`--strict`);
  if (varsObj(s)) { parts.push(`--variables-file variables.json`); if (s.strictVars) parts.push(`--strict-variables`); }
  return parts.join(" ");
};
const cliLine = (s: HFSettings, recName: string) => `npx hyperframes render ${cmdFlags(s, recName)}`;

const kitStudioMac = `#!/bin/bash
cd "$(dirname "$0")"
echo "Starting the official HyperFrames Studio..."
echo "Your browser will open in a few seconds."
echo "Keep this window open while you work - close it (or press Control+C) to stop."
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install it from https://nodejs.org and run this file again."
  read -p "Press Enter to close"
  exit 1
fi
npx --yes hyperframes preview
`;
const kitStudioWin = `@echo off
cd /d "%~dp0"
echo Starting the official HyperFrames Studio...
echo Your browser will open in a few seconds. Keep this window open while you work.
where node >nul 2>nul || (echo Node.js is required. Install it from https://nodejs.org and run this file again. & pause & exit /b 1)
call npx --yes hyperframes preview
pause
`;
const kitMac = (s: HFSettings, recName: string) => `#!/bin/bash
cd "$(dirname "$0")"
echo "Rendering your HyperFrames video..."
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install it from https://nodejs.org and run this file again."
  read -p "Press Enter to close"
  exit 1
fi
npx --yes hyperframes render ${cmdFlags(s, recName)}
echo ""
echo "Done! Your video is in the renders folder."
read -p "Press Enter to close"
`;
const kitWin = (s: HFSettings, recName: string) => `@echo off
cd /d "%~dp0"
echo Rendering your HyperFrames video...
where node >nul 2>nul || (echo Node.js is required. Install it from https://nodejs.org and run this file again. & pause & exit /b 1)
call npx --yes hyperframes render ${cmdFlags(s, recName)}
echo.
echo Done! Your video is in the renders folder.
pause
`;
const kitHowTo = (s: HFSettings, recName: string) => `HOW TO USE THIS HYPERFRAMES PROJECT
===================================

FASTEST: THE OFFICIAL HYPERFRAMES STUDIO (preview + edit)
  Mac:      double-click  1-open-studio.command
  Windows:  double-click  1-open-studio.bat
  A local server starts and the official HyperFrames Studio opens in
  your browser - preview the video, tweak it, and work there.
  Keep the black window open while you work; close it to stop.
  (First time only: if macOS blocks the file, right-click -> Open -> Open.)

OR RENDER THE VIDEO FILE DIRECTLY
  Mac:      double-click  2-render-video.command
  Windows:  double-click  2-render-video.bat
  The video is created with these settings from Render Studio:
  format ${s.format} · ${s.rateMode === "crf" && s.crf.trim() ? `CRF ${s.crf.trim()}` : s.rateMode === "bitrate" && s.bitrate.trim() ? `bitrate ${s.bitrate.trim()}` : `quality ${s.quality}`}${s.fps !== "default" ? ` · ${s.fps} fps` : ""}${s.res !== "orig" ? ` · ${s.res}` : ""}${s.composition ? ` · composition ${s.composition}` : ""}
  output: renders/${outName(s, recName)}.${s.format}${varsObj(s) ? `
  variables.json holds the composition variables chosen in Render Studio.` : ""}

ANY COMPUTER (terminal)
  Preview:  npx hyperframes preview
  Render:   ${cliLine(s, recName)}

Requirements: Node.js 22+ (https://nodejs.org). FFmpeg is downloaded
automatically by the tool if it is missing.
`;

/* fflate stamps zips as DOS-made, so macOS/unzip ignore the unix modes in them
   and .command files lose their executable bit. Rewrite the central directory:
   mark the creator as Unix and give every entry a real mode (launchers 755). */
const EXEC_NAMES = new Set(["1-open-studio.command", "2-render-video.command"]);
const makeZipsExecutable = (bytes: Uint8Array): Uint8Array => {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) return bytes;
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    dv.setUint16(off + 4, (3 << 8) | 30, true);
    const nameLen = dv.getUint16(off + 28, true), extraLen = dv.getUint16(off + 30, true), comLen = dv.getUint16(off + 32, true);
    const name = dec.decode(bytes.subarray(off + 46, off + 46 + nameLen));
    const mode = name.endsWith("/") ? 0o40755 : EXEC_NAMES.has(name) ? 0o100755 : 0o100644;
    dv.setUint32(off + 38, mode * 65536, true);
    off += 46 + nameLen + extraLen + comLen;
  }
  return bytes;
};

export function HFView({ id, tab, setTab, onChanged, toast }: { id: string; tab: string; setTab: (t: string) => void; onChanged: () => void; toast: (m: string) => void }) {
  const [st, setSt] = useState<St>({ status: "loading", msg: "Unpacking ZIP…" });
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [muted, setMuted] = useState(false);
  const [scale, setScale] = useState(0.2);
  const timeRef = useRef(0);
  const [hs, setHs] = useState<HFSettings>(() => { try { const raw = localStorage.getItem("rs_hfset_" + id); return { ...defaultHF(), ...(raw ? {} : { workers: powerWorkers(loadPower(), navigator.hardwareConcurrency || 0) }), ...JSON.parse(raw || "{}") }; } catch { return defaultHF(); } });
  const frameRef = useRef<HTMLIFrameElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const builtRef = useRef<BuiltPlayer | null>(null);
  const capRef = useRef(false);

  useEffect(() => { try { localStorage.setItem("rs_hfset_" + id, JSON.stringify(hs)); } catch {} }, [hs, id]);
  const up = (k: Partial<HFSettings>) => setHs((x) => ({ ...x, ...k }));

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const rec = await getProject(id);
        if (!rec) throw new Error("Project not found.");
        const o = await openAny(rec.zip);
        if (o.det.kind !== "hyperframes" || !o.det.indexPath) throw new Error("This project is not a HyperFrames project.");
        const built = buildPlayer(o.files, o.det.indexPath);
        if (dead) { built.revoke(); return; }
        builtRef.current = built;
        setSt({ status: "ready", built, files: o.files, rec });
      } catch (e: any) {
        if (!dead) setSt({ status: "error", err: String(e.message || e) });
      }
    })();
    return () => { dead = true; builtRef.current?.revoke(); builtRef.current = null; };
  }, [id]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data || {};
      if (m.type === "hf-ready") setReady(true);
      else if (m.type === "hf-time") timeRef.current = m.t || 0;
      else if (m.type === "hf-state") setPlaying(!!m.playing);
      else if (m.type === "hf-ended") setPlaying(false);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const meta = st.status === "ready" ? st.built.meta : null;
  useEffect(() => {
    if (!meta || !boxRef.current) return;
    const el = boxRef.current;
    const upd = () => setScale(Math.min(el.clientWidth / meta.width, el.clientHeight / meta.height));
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    upd();
    return () => ro.disconnect();
  }, [meta, tab]);

  const send = (m: Record<string, unknown>) => frameRef.current?.contentWindow?.postMessage(m, "*");
  const toggle = () => (playing ? send({ type: "hf-pause" }) : send({ type: "hf-play" }));
  const seek = (v: number) => { timeRef.current = v; send({ type: "hf-seek", t: v }); };

  /* one-time library thumbnail: jump to a lively frame, snapshot the stage, jump back */
  useEffect(() => {
    if (st.status !== "ready" || !ready || st.rec.thumb || capRef.current) return;
    capRef.current = true;
    const m = st.built.meta, rec = st.rec;
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => {
      send({ type: "hf-seek", t: Math.min(12, m.duration * 0.15) });
      timers.push(setTimeout(async () => {
        try {
          const doc = frameRef.current?.contentDocument;
          const el = doc?.querySelector("[data-composition-id]") as HTMLElement | null;
          if (!el) return;
          const { toBlob } = await import("html-to-image");
          const blob = await toBlob(el, { pixelRatio: Math.min(1, 540 / m.width), backgroundColor: "#020309", skipFonts: true });
          if (!blob) return;
          const u2 = { ...rec, thumb: await shrinkImage(blob, 540) };
          await putProject(u2);
          setSt((cur) => (cur.status === "ready" ? { ...cur, rec: u2 } : cur));
          onChanged();
        } catch { /* thumbnail is a nice-to-have — the icon stays if capture fails */ }
        send({ type: "hf-seek", t: 0 });
      }, 900));
    }, 600));
    return () => timers.forEach(clearTimeout);
  }, [st, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const downloadKit = () => {
    if (st.status !== "ready") return;
    const out: Zippable = {};
    for (const [k, v] of st.files) out[k] = v;
    out["1-open-studio.command"] = strToU8(kitStudioMac);
    out["1-open-studio.bat"] = strToU8(kitStudioWin);
    out["2-render-video.command"] = strToU8(kitMac(hs, st.rec.name));
    out["2-render-video.bat"] = strToU8(kitWin(hs, st.rec.name));
    const vo = varsObj(hs);
    if (vo) out["variables.json"] = strToU8(JSON.stringify(vo, null, 2));
    out["HOW-TO-RENDER.txt"] = strToU8(kitHowTo(hs, st.rec.name));
    const blob = new Blob([makeZipsExecutable(zipSync(out)) as BlobPart], { type: "application/zip" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = st.rec.name + "-render-kit.zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("Render kit downloaded — settings included");
  };

  if (st.status === "loading") return <div className="center" style={{ flex: 1 }}><div className="spin lg" /><p>{st.msg}</p></div>;
  if (st.status === "error") return <div className="card errcard"><h3>Couldn’t open this project</h3><pre>{st.err}</pre><button className="btn" onClick={() => location.reload()}>Retry</button></div>;

  const m = st.built.meta;
  const bytes = Array.from(st.files.values()).reduce((a, b) => a + b.length, 0);
  const resOpts = resOptions(m.width, m.height);
  const htmlFiles = [...st.files.keys()].filter((k) => /\.html?$/i.test(k)).sort();

  return (
    <div className="workview enter">
      <div className="phead"><div><h1 title={st.rec.name}>{st.rec.name}</h1><p className="mt"><span className="badge kind">HyperFrames</span> · {m.width}×{m.height} · {m.duration.toFixed(1)}s · {st.files.size} files · {fmtB(bytes)} unpacked</p></div>
        <div className="tabs">{[["studio", "Player"], ["files", "Files"]].map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div></div>

      {tab === "files" && <div className="workscroll"><div className="card"><div className="flist" style={{ maxHeight: "none" }}>{Array.from(st.files.entries()).sort().map(([k, v]) => <div key={k}><span>{k}</span><small>{fmtB(v.length)}</small></div>)}</div></div></div>}

      {tab === "studio" && (
        <div className="workgrid">
          <div className="stagecol">
            <div className="card pvcard">
              <div className="fitstage" ref={boxRef}>
                <div className="fitbox" style={{ width: Math.max(2, Math.round(m.width * scale)), height: Math.max(2, Math.round(m.height * scale)) }}>
                  <iframe ref={frameRef} title="HyperFrames player" srcDoc={st.built.html} allow="autoplay"
                    style={{ width: m.width, height: m.height, transform: `scale(${scale})`, transformOrigin: "top left", border: 0, display: "block", background: "#000" }} />
                </div>
              </div>
              <HFTransport duration={m.duration} playing={playing} ready={ready} muted={muted} timeRef={timeRef} onToggle={toggle}
                onMute={() => { setMuted(!muted); send({ type: "hf-muted", muted: !muted }); }} onSeek={seek} onFullscreen={() => boxRef.current?.requestFullscreen?.()} />
              <p className="hint">Live preview plays the real project in your browser (timelines + audio in sync). If sound doesn’t start, click once inside the video area, then press Play again.</p>
            </div>
            {m.scenes.length > 0 && <div className="card compscard"><h3>Scenes</h3><div className="comps">{m.scenes.map((s) => <div key={s.id + s.src} className="comp"><b title={s.id}>{s.id}</b><small>{s.start.toFixed(1)}s – {(s.start + s.duration).toFixed(1)}s · {s.src}</small></div>)}</div></div>}
          </div>

          <aside className="panelcol"><div className="card panelcard">
            <div className="panelhead">
              <h3><i>▶</i>Render this video</h3>
              <p className="sub">HyperFrames videos are finished by the HyperFrames desktop tool — it drives a real browser + FFmpeg, which a web page can’t do. Choose your settings, then download the kit: it opens the <b>official HyperFrames Studio</b> on your computer (preview + edit), or renders the video directly with these settings.</p>
            </div>
            <div className="panelbody">
            <div className="row"><Field label="Format"><Seg value={hs.format} onChange={(v) => up({ format: v })} options={[["mp4", "MP4"], ["webm", "WebM"], ["mov", "MOV"], ["gif", "GIF"], ["hls", "HLS"]]} /></Field></div>
            <div className="row"><Field label="Rate control"><Seg value={hs.rateMode} onChange={(v) => up({ rateMode: v })} options={[["quality", "Quality"], ["crf", "CRF"], ["bitrate", "Bitrate"]]} /></Field></div>
            <p className="hint" style={{ margin: "-6px 0 12px" }}>Quality is the simple choice — pick a level and go. CRF and Bitrate are exact controls for experts.</p>
            {hs.rateMode === "quality" && <div className="row"><Field label="Quality"><Seg value={hs.quality} onChange={(v) => up({ quality: v })} options={[["draft", "Draft"], ["standard", "Standard"], ["looks", "Best"], ["delivery", "Delivery"]]} /></Field></div>}
            {hs.rateMode === "crf" && <div className="row"><Field label="CRF (0–51, lower = better)"><input type="number" min={0} max={51} placeholder="e.g. 18" value={hs.crf} onChange={(e) => up({ crf: e.target.value })} /></Field></div>}
            {hs.rateMode === "bitrate" && <div className="row"><Field label="Video bitrate"><input type="text" placeholder="e.g. 10M" value={hs.bitrate} onChange={(e) => up({ bitrate: e.target.value })} /></Field></div>}
            <div className="row"><Field label="Frame rate"><select value={hs.fps} onChange={(e) => up({ fps: e.target.value })}><option value="default">Project default</option><option value="24">24 fps</option><option value="25">25 fps</option><option value="30">30 fps</option><option value="50">50 fps</option><option value="60">60 fps</option><option value="120">120 fps</option><option value="240">240 fps</option></select></Field>
              <Field label="Workers"><select value={hs.workers} onChange={(e) => up({ workers: e.target.value })}><option value="auto">Auto</option>{workerOptions(hs.workers).map((n) => <option key={n} value={String(n)}>{n}{n === (navigator.hardwareConcurrency || 0) ? " · full power" : ""}</option>)}</select></Field></div>
            {(navigator.hardwareConcurrency || 0) > 0 && <p className="hint" style={{ margin: "-6px 0 12px" }}>This machine reports {navigator.hardwareConcurrency} cores — workers are parallel Chrome processes (~256 MB RAM each), capped at your core count. The Render power choice on the Settings page is the default for new projects.</p>}
            <div className="hfstats">
              <div className="stat"><small>Processor cores</small><b>{navigator.hardwareConcurrency || "Not reported"}</b></div>
              <div className="stat"><small>Kit workers</small><b>{hs.workers === "auto" ? `Auto (up to ${navigator.hardwareConcurrency || "?"})` : hs.workers}</b></div>
              <div className="stat"><small>GPU encoding</small><b>{hs.gpu ? "On (--gpu)" : "Off"}</b></div>
              <div className="stat"><small>Browser GPU</small><b>{{ auto: "Auto", gpu: "Forced on", software: "Software" }[hs.browserGpu]}</b></div>
            </div>
            <p className="hint" style={{ margin: "-4px 0 12px" }}>These are the live render details that honestly apply here: a HyperFrames render runs on your computer via the kit (a web page can’t render it in-browser), so there is no in-browser progress, speed or memory to report — the kit’s own window shows its progress.</p>
            <div className="row"><Field label="Resolution"><select value={resOpts.some(([v]) => v === hs.res) ? hs.res : "orig"} onChange={(e) => up({ res: e.target.value })}>{resOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field></div>
            {htmlFiles.length > 1 && <div className="row"><Field label="Composition file"><select value={hs.composition} onChange={(e) => up({ composition: e.target.value })}><option value="">Project default (index)</option>{htmlFiles.map((f) => <option key={f} value={f}>{f}</option>)}</select></Field></div>}
            {hs.format === "mov" && <div className="row"><Field label="ProRes profile"><Seg value={hs.prores} onChange={(v) => up({ prores: v })} options={[["4444", "4444 +α"], ["hq", "HQ"], ["422", "422"], ["lt", "LT"], ["proxy", "Proxy"]]} /></Field></div>}
            {hs.format === "gif" && <div className="row"><Field label="GIF loops (0 = forever)"><input type="number" min={0} max={65535} placeholder="0" value={hs.gifLoop} onChange={(e) => up({ gifLoop: e.target.value })} /></Field></div>}
            {hs.format === "hls" && <div className="row"><Field label="HLS segment (seconds)"><input type="number" min={1} max={60} placeholder="4" value={hs.hlsSeg} onChange={(e) => up({ hlsSeg: e.target.value })} /></Field></div>}
            {hs.format === "mp4" && <div className="row"><Field label="Start (sec)"><input type="number" min={0} step={0.1} placeholder="0" value={hs.start} onChange={(e) => up({ start: e.target.value })} /></Field><Field label="End (sec)"><input type="number" min={0} step={0.1} placeholder="End" value={hs.end} onChange={(e) => up({ end: e.target.value })} /></Field></div>}
            {hs.format === "mp4" && <p className="hint" style={{ margin: "-6px 0 12px" }}>Start/End render only that span of the film (needs a whole frame rate: 24, 25, 30 or 60 fps).</p>}
            <div className="row"><Field label="File name"><input type="text" placeholder={st.rec.name} value={hs.name} onChange={(e) => up({ name: e.target.value })} /></Field></div>
            <details className="adv"><summary>Advanced</summary>
              {(hs.format === "mp4" || hs.format === "webm") && hs.rateMode !== "bitrate" && <div className="row"><Field label="Max bitrate cap"><input type="text" placeholder="e.g. 8M — blank = uncapped" value={hs.maxBitrate} onChange={(e) => up({ maxBitrate: e.target.value })} /></Field></div>}
              {hs.format === "mp4" && <div className="row"><Field label="Keyframe interval (sec)"><input type="number" min={0} step={0.5} placeholder="Encoder default" value={hs.keyframe} onChange={(e) => up({ keyframe: e.target.value })} /></Field></div>}
              <div className="row"><Field label="Video frame extraction"><Seg value={hs.frameFormat} onChange={(v) => up({ frameFormat: v })} options={[["auto", "Auto"], ["jpg", "JPG"], ["png", "PNG"]]} /></Field></div>
              <p className="hint" style={{ margin: "-6px 0 12px" }}>PNG suits screen recordings and colour-sensitive source videos; alpha sources always extract as PNG.</p>
              <div className="row"><Field label="Colour"><Seg value={hs.color} onChange={(v) => up({ color: v })} options={[["auto", "Auto"], ["hdr", "Force HDR"], ["sdr", "Force SDR"]]} /></Field>
                <Field label="Browser GPU"><Seg value={hs.browserGpu} onChange={(v) => up({ browserGpu: v })} options={[["auto", "Auto"], ["gpu", "Force"], ["software", "Software"]]} /></Field></div>
              <div className="row"><Field label="Low-memory mode"><Seg value={hs.lowMem} onChange={(v) => up({ lowMem: v })} options={[["auto", "Auto"], ["on", "On"], ["off", "Off"]]} /></Field></div>
              <Switch on={hs.gpu} onChange={(v) => up({ gpu: v })} title="GPU encoding" sub="--gpu — use the graphics card for encoding where supported" />
              <Switch on={hs.motionBlurOff} onChange={(v) => up({ motionBlurOff: v })} title="Turn off page motion blur" sub="--page-motion-blur off — ignore motion blur authored in the page" />
              <Switch on={hs.docker} onChange={(v) => up({ docker: v })} title="Deterministic Docker render" sub="--docker — render inside Docker for identical results" />
              <Switch on={hs.strict} onChange={(v) => up({ strict: v })} title="Fail on lint errors" sub="--strict — stop the render if the project has lint errors" />
              <Field label="Composition variables (JSON)"><textarea spellCheck={false} placeholder='{"title": "Hello"}' value={hs.variables} onChange={(e) => up({ variables: e.target.value })} /></Field>
              {hs.variables.trim() !== "" && !varsObj(hs) && <p className="hint" style={{ color: "var(--warn)" }}>Not a valid JSON object yet — variables are only sent when the JSON is a non-empty object.</p>}
              {varsObj(hs) && <Switch on={hs.strictVars} onChange={(v) => up({ strictVars: v })} title="Strict variables" sub="--strict-variables — fail if a key is undeclared or mistyped" />}
              <p className="hint">Variables are saved into the kit as <b>variables.json</b> and passed with <b>--variables-file</b>.</p>
            </details>
            <p className="hint">The kit will run exactly this command:</p>
            <pre className="codebox">{cliLine(hs, st.rec.name)}</pre>
            <div className="sechead" style={{ margin: "18px 0 8px" }}><h2 style={{ fontSize: 14 }}>Inside the kit</h2></div>
            <ul className="plain">
              <li><b>1-open-studio.command / .bat</b> — double-click: the official HyperFrames Studio opens in your browser</li>
              <li><b>2-render-video.command / .bat</b> — double-click: renders the video with your settings</li>
              <li><b>HOW-TO-RENDER.txt</b> — the same steps in words</li>
              {varsObj(hs) && <li><b>variables.json</b> — the composition variables you set above</li>}
            </ul>
            <p className="hint" style={{ marginTop: 12 }}>Needs Node.js 22+. The finished {hs.format === "hls" ? "stream (a folder with the playlist)" : "video"} lands at <b>renders/{outName(hs, st.rec.name)}.{hs.format}</b>.</p>
            </div>
            <div className="panelfoot">
              <button className="btn big primary" onClick={downloadKit}><Icon d={IC.dl} /> Download render kit (.zip)</button>
            </div>
          </div></aside>
        </div>
      )}
    </div>
  );
}
