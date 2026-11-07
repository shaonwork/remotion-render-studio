import { useEffect, useState } from "react";
import { benchmark, detectMachineCached, loadPower, loadPref, mediaCacheCapMb, mediaCacheLabel, mediaCacheOptions, powerWorkers, recommend, savePower, savePref, type BenchRow, type Machine, type PowerPref } from "../lib/hw";
import { fmtB } from "../lib/util";
import type { ProjectRec, RenderRec } from "../lib/db";
import { Icon, IC, Seg } from "./ui";

/* The Settings page — everything that used to live in the sidebar's System
   card and the old "This computer" page, in one tidy place:
     · This computer — what the browser detects, plus the encoder table
     · Render        — render power, the media-cache default, recommendations
     · Data          — storage, backup / restore, clean everything
   Every control writes the same stores it always did (rs_power, rs_pref,
   rs_cache_mb, the library DB), so the render views keep honouring them. */

const CACHE_KEY = "rs_cache_mb";
export const loadCacheDefault = (): number => { try { return Math.max(0, Math.floor(+(localStorage.getItem(CACHE_KEY) || 0)) || 0); } catch { return 0; } };

export function SettingsPage({ toast, usage, projects, renders, backupBusy, onBackup, onRestore, onClean }: {
  toast: (m: string) => void;
  usage: { used: number; quota: number };
  projects: ProjectRec[]; renders: RenderRec[];
  backupBusy: string;
  onBackup: () => void; onRestore: () => void; onClean: () => void;
}) {
  const [m, setM] = useState<Machine | null>(null);
  const [bench, setBench] = useState<BenchRow[] | null>(() => { try { return JSON.parse(localStorage.getItem("rs_bench") || "null"); } catch { return null; } });
  const [step, setStep] = useState("");
  const [power, setPowerState] = useState<PowerPref>(() => loadPower());
  const setPower = (p: PowerPref) => { setPowerState(p); savePower(p); };
  const [cacheMb, setCacheMb] = useState<number>(() => loadCacheDefault());
  useEffect(() => { detectMachineCached().then(setM); }, []);
  const run = async () => {
    if (!m) return; const list = ["h264", "h265", "vp9", "av1"].filter((c) => m.codecs[c]);
    const rows = await benchmark(list, setStep); setStep(""); setBench(rows); localStorage.setItem("rs_bench", JSON.stringify(rows));
    const r = recommend(m, rows); savePref(r.pref); toast("Benchmark saved — new renders will use the fastest settings");
  };
  if (!m) return <div className="center"><div className="spin lg" /></div>;
  const rec = recommend(m, bench || undefined), applied = loadPref();
  const max = Math.max(1, ...(bench || []).map((r) => r.fps || 0));
  const cards: [string, string, string?][] = [
    ["Operating system", `${m.os}${m.arch ? " · " + m.arch : ""}`], ["CPU threads", m.threads ? `${m.threads} threads` : "Unknown"],
    ["Memory", m.memGB ? `≥ ${m.memGB} GB (browser reports max 8)` : "Hidden by browser"], ["Graphics (GPU)", m.gpu, m.webgpu || undefined], ["Browser", m.browser],
  ];
  /* The media-cache ladder is the same RAM-aware one the render panel
     uses: its top rung is ~70% of the RAM the browser reports. Here it
     sets the DEFAULT for projects that haven't saved their own choice —
     each project's render panel can still override it per project. */
  const capMb = mediaCacheCapMb(m.memGB);
  const cacheOpts = mediaCacheOptions(m.memGB);
  if (!cacheOpts.some((o) => o.mb === cacheMb)) cacheOpts.push({ mb: cacheMb, label: mediaCacheLabel(cacheMb) });
  cacheOpts.sort((a, b) => a.mb - b.mb);
  const setCache = (mb: number) => {
    setCacheMb(mb);
    try { localStorage.setItem(CACHE_KEY, String(mb)); } catch { /* private mode */ }
    toast(mb > 0 ? `Default media cache: ${mediaCacheLabel(mb)}` : "Default media cache: browser default");
  };
  const pct = usage.quota ? Math.min(100, Math.max(1, Math.round((100 * usage.used) / usage.quota))) : 0;

  return (
    <div>
      <div className="phead"><div><h1>Settings</h1><p className="mt">This computer, rendering and your data — everything the studio keeps, in one place.</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button className="btn" onClick={() => detectMachineCached(true).then(setM)}>↻ Re-detect</button>
        <button className="btn primary" onClick={run} disabled={!!step}>{step ? <><span className="spin" /> {step}</> : <><Icon d={IC.play} /> Run benchmark</>}</button></div></div>

      <div className="sechead" style={{ marginTop: 0 }}><h2>This computer</h2></div>
      <div className="mgrid">{cards.map(([k, v, s]) => <div key={k} className="card mc"><small>{k}</small><b>{v}</b>{s && <span className="mt">WebGPU: {s}</span>}</div>)}</div>
      <div className="card" style={{ marginTop: 14 }}><h3>Video encoders</h3><p className="sub">Which video codecs this browser can encode, and how fast each path measured in the benchmark.</p>
        <table className="tbl"><thead><tr><th>Codec</th><th>Supported</th><th>Hardware (GPU / media engine)</th><th>Software (CPU)</th></tr></thead><tbody>
          {["h264", "h265", "vp9", "av1", "vp8"].map((c) => { const h = bench?.find((r) => r.codec === c && r.mode === "hardware"), s = bench?.find((r) => r.codec === c && r.mode === "software");
            const cell = (r?: BenchRow) => !bench ? <span className="mt">run benchmark</span> : r?.fps ? <div className="bar2"><div style={{ width: (100 * r.fps) / max + "%" }} /><span>{r.fps} fps</span></div> : <span className="mt">not available</span>;
            return <tr key={c}><td><b>{c.toUpperCase()}</b></td><td>{m.codecs[c] ? <span className="badge ok">yes</span> : <span className="badge">no</span>}</td><td>{m.codecs[c] ? cell(h) : "—"}</td><td>{m.codecs[c] ? cell(s) : "—"}</td></tr>; })}
        </tbody></table><p className="hint">The test encodes 45 synthetic 720p frames per option, so the numbers reflect <b>your</b> machine right now. Higher = faster.</p></div>

      <div className="sechead"><h2>Render</h2></div>
      <div className="card"><h3>Render power</h3><p className="sub" style={{ marginBottom: 12 }}>How much of this machine renders may use. Applies as the default for new projects.</p>
        <div className="row"><div className="f"><label className="l">Power mode</label><Seg value={power.mode} onChange={(mode) => setPower({ mode, cores: power.cores || m.threads || 0 })} options={[["auto", "Auto"], ["custom", "Choose cores"], ["full", "Full power"]]} /></div>
          {power.mode === "custom" && <div className="f"><label className="l">Cores for rendering</label><select value={power.cores || m.threads || 1} onChange={(e) => setPower({ mode: "custom", cores: +e.target.value })}>{Array.from({ length: m.threads || 1 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} core{n > 1 ? "s" : ""}</option>)}</select></div>}</div>
        <ul className="plain">
          <li><b>HyperFrames kits:</b> the core choice becomes <b>--workers {powerWorkers(power, m.threads)}</b> — parallel Chrome processes, never more than your {m.threads || "?"} detected cores. You can still override it per project.</li>
          <li><b>Remotion (in-browser):</b> the bundled web renderer has no core/concurrency setting — it draws frames on one thread. Full power there switches on its strongest real settings instead: GPU-preferred encoding and the largest media cache your RAM allows — about 70% of the RAM figure above (the “Full power” switch in the render panel).</li>
          <li><b>GPU:</b> shown for information only. Browsers expose no GPU quota or throttle API, so there is deliberately no GPU slider — encoders use GPU acceleration automatically where the platform supports it.</li>
          <li><b>RAM:</b> {m.memGB ? `this browser reports ≥ ${m.memGB} GB — Chrome-family browsers cap and round this number by design, so treat it as approximate.` : "this browser does not report RAM (navigator.deviceMemory is unavailable), so no number is shown rather than a guessed one."}</li>
        </ul></div>

      <div className="card" style={{ marginTop: 14 }}><h3>Memory kept for videos</h3><p className="sub" style={{ marginBottom: 12 }}>The default media cache for projects that haven’t saved their own choice. Each project’s render panel (Advanced settings) can override it, and a saved choice is never overwritten from here.</p>
        <div className="row" style={{ marginBottom: 0 }}><div className="f"><label className="l">Default media cache</label>
          <select value={cacheMb} onChange={(e) => setCache(+e.target.value)}>{cacheOpts.map((o) => <option key={o.mb} value={o.mb}>{o.label}</option>)}</select></div></div>
        <p className="hint">{m.memGB ? <>Highest here is ~70% of the RAM this browser reports (≥ {m.memGB} GB → {mediaCacheLabel(capMb)}). </> : <>This browser doesn't report how much RAM this computer has, so the choices stop at 2 GB. </>}It's a ceiling, not a reservation — the cache only uses what your project's media actually needs, keeping large videos ready instead of re-reading them for every frame.</p></div>

      <div className="card" style={{ marginTop: 14 }}><h3>Recommended settings</h3><p>{rec.why}</p>
        <div className="pb" style={{ marginTop: 12 }}><span className="badge">{(rec.pref.container || "").toUpperCase()}</span><span className="badge">{(rec.pref.codec || "").toUpperCase()}</span><span className="badge">{rec.pref.hw === "prefer-hardware" ? "GPU encoder" : rec.pref.hw === "prefer-software" ? "CPU encoder" : "Auto encoder"}</span><span className="badge">High quality</span></div>
        <button className="btn" style={{ marginTop: 14 }} onClick={() => { savePref(rec.pref); toast("Saved as your default"); }}>{applied ? "Update my defaults" : "Use as my defaults"}</button></div>
      <div className="card" style={{ marginTop: 14 }}><h3>What runs where</h3><p className="sub">An honest picture of browser rendering.</p>
        <ul className="plain"><li><b>CPU:</b> drawing each frame (layout, text, effects) runs on one main thread — a fast single-core CPU matters most.</li><li><b>GPU / media engine:</b> video encoding (and any WebGL/3D in your project) can use it when the encoder is set to GPU.</li><li><b>Not possible in a browser:</b> forcing all cores or the GPU for everything. For maximum speed you can add the optional local agent later.</li></ul></div>

      <div className="sechead"><h2>Data</h2></div>
      <div className="card">
        <div className="librow">
          <div className="libinfo">
            <b>Library &amp; cache</b>
            <div className="meter" style={{ margin: "9px 0 7px" }}><div style={{ width: pct + "%" }} /></div>
            <small className="mt">{usage.quota ? <>{fmtB(usage.used)} of ~{fmtB(usage.quota)} used</> : <>{fmtB(usage.used)} stored in this browser</>} · {projects.length} project{projects.length === 1 ? "" : "s"} · {renders.length} render{renders.length === 1 ? "" : "s"}</small>
          </div>
          <div className="libacts">
            <button className="btn sm" onClick={onBackup} disabled={!!backupBusy}><Icon d={IC.dl} size={15} /> {backupBusy || "Download backup"}</button>
            <button className="btn sm" onClick={onRestore}><Icon d={IC.upload} size={15} /> Restore backup…</button>
            <button className="btn sm danger" onClick={onClean}><Icon d={IC.trash} size={15} /> Clean everything</button>
          </div>
        </div>
        <p className="hint">A backup is one ZIP with every project and render in this library. Restoring adds them back as new copies — nothing is overwritten. “Clean everything” wipes the whole library, settings and caches, so take a backup first if you want to keep anything.</p>
        <p className="hint" style={{ marginTop: 10 }}>Render Studio 1.1.0 · everything lives in your browser only — clearing site data deletes it all.</p>
      </div>
    </div>
  );
}
