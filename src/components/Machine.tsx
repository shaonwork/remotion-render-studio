import { useEffect, useState } from "react";
import { benchmark, detectMachineCached, loadPower, loadPref, powerWorkers, recommend, savePower, savePref, type BenchRow, type Machine, type PowerPref } from "../lib/hw";
import { Icon, IC, Seg } from "./ui";

export function MachinePage({ toast }: { toast: (m: string) => void }) {
  const [m, setM] = useState<Machine | null>(null);
  const [bench, setBench] = useState<BenchRow[] | null>(() => { try { return JSON.parse(localStorage.getItem("rs_bench") || "null"); } catch { return null; } });
  const [step, setStep] = useState("");
  const [power, setPowerState] = useState<PowerPref>(() => loadPower());
  const setPower = (p: PowerPref) => { setPowerState(p); savePower(p); };
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
  return (
    <div>
      <div className="phead"><div><h1>This computer</h1><p className="mt">Detected automatically in your browser — works the same on Windows, macOS and Linux.</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button className="btn" onClick={() => detectMachineCached(true).then(setM)}>↻ Re-detect</button>
        <button className="btn primary" onClick={run} disabled={!!step}>{step ? <><span className="spin" /> {step}</> : <><Icon d={IC.play} /> Run benchmark</>}</button></div></div>
      <div className="mgrid">{cards.map(([k, v, s]) => <div key={k} className="card mc"><small>{k}</small><b>{v}</b>{s && <span className="mt">WebGPU: {s}</span>}</div>)}</div>

      <div className="sechead"><h2>Render power</h2></div>
      <div className="card"><p className="sub" style={{ marginBottom: 12 }}>How much of this machine renders may use. The choice is shared with the sidebar panel and applies as the default for new projects.</p>
        <div className="row"><div className="f"><label className="l">Power mode</label><Seg value={power.mode} onChange={(mode) => setPower({ mode, cores: power.cores || m.threads || 0 })} options={[["auto", "Auto"], ["custom", "Choose cores"], ["full", "Full power"]]} /></div>
          {power.mode === "custom" && <div className="f"><label className="l">Cores for rendering</label><select value={power.cores || m.threads || 1} onChange={(e) => setPower({ mode: "custom", cores: +e.target.value })}>{Array.from({ length: m.threads || 1 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} core{n > 1 ? "s" : ""}</option>)}</select></div>}</div>
        <ul className="plain">
          <li><b>HyperFrames kits:</b> the core choice becomes <b>--workers {powerWorkers(power, m.threads)}</b> — parallel Chrome processes, never more than your {m.threads || "?"} detected cores. You can still override it per project.</li>
          <li><b>Remotion (in-browser):</b> the bundled web renderer has no core/concurrency setting — it draws frames on one thread. Full power there switches on its strongest real settings instead: GPU-preferred encoding and a 2 GB media cache (the “Full power” switch in the render panel).</li>
          <li><b>GPU:</b> shown for information only. Browsers expose no GPU quota or throttle API, so there is deliberately no GPU slider — encoders use GPU acceleration automatically where the platform supports it.</li>
          <li><b>RAM:</b> {m.memGB ? `this browser reports ≥ ${m.memGB} GB — Chrome-family browsers cap and round this number by design, so treat it as approximate.` : "this browser does not report RAM (navigator.deviceMemory is unavailable), so no number is shown rather than a guessed one."}</li>
        </ul></div>

      <div className="sechead"><h2>Video encoders</h2></div>
      <div className="card"><table className="tbl"><thead><tr><th>Codec</th><th>Supported</th><th>Hardware (GPU / media engine)</th><th>Software (CPU)</th></tr></thead><tbody>
        {["h264", "h265", "vp9", "av1", "vp8"].map((c) => { const h = bench?.find((r) => r.codec === c && r.mode === "hardware"), s = bench?.find((r) => r.codec === c && r.mode === "software");
          const cell = (r?: BenchRow) => !bench ? <span className="mt">run benchmark</span> : r?.fps ? <div className="bar2"><div style={{ width: (100 * r.fps) / max + "%" }} /><span>{r.fps} fps</span></div> : <span className="mt">not available</span>;
          return <tr key={c}><td><b>{c.toUpperCase()}</b></td><td>{m.codecs[c] ? <span className="badge ok">yes</span> : <span className="badge">no</span>}</td><td>{m.codecs[c] ? cell(h) : "—"}</td><td>{m.codecs[c] ? cell(s) : "—"}</td></tr>; })}
      </tbody></table><p className="hint">The test encodes 45 synthetic 720p frames per option, so the numbers reflect <b>your</b> machine right now. Higher = faster.</p></div>

      <div className="sechead"><h2>Recommended settings</h2></div>
      <div className="card"><p>{rec.why}</p>
        <div className="pb" style={{ marginTop: 12 }}><span className="badge">{(rec.pref.container || "").toUpperCase()}</span><span className="badge">{(rec.pref.codec || "").toUpperCase()}</span><span className="badge">{rec.pref.hw === "prefer-hardware" ? "GPU encoder" : rec.pref.hw === "prefer-software" ? "CPU encoder" : "Auto encoder"}</span><span className="badge">High quality</span></div>
        <button className="btn" style={{ marginTop: 14 }} onClick={() => { savePref(rec.pref); toast("Saved as your default"); }}>{applied ? "Update my defaults" : "Use as my defaults"}</button></div>
      <div className="card" style={{ marginTop: 18 }}><h3>What runs where</h3><p className="sub">An honest picture of browser rendering.</p>
        <ul className="plain"><li><b>CPU:</b> drawing each frame (layout, text, effects) runs on one main thread — a fast single-core CPU matters most.</li><li><b>GPU / media engine:</b> video encoding (and any WebGL/3D in your project) can use it when the encoder is set to GPU.</li><li><b>Not possible in a browser:</b> forcing all cores or the GPU for everything. For maximum speed you can add the optional local agent later.</li></ul></div>
    </div>
  );
}
