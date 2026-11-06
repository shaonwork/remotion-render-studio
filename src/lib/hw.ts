/* Detects this computer (Windows / macOS / Linux) from inside the browser and measures real encoder speed. */
import type { Settings } from "./render";
export type Machine = { os: string; arch: string; threads: number; memGB: number | null; gpu: string; gpuVendor: string; webgpu: string; browser: string; codecs: Record<string, boolean> };
export type BenchRow = { codec: string; mode: "hardware" | "software"; fps: number | null };

const CODEC_STR: Record<string, string> = { h264: "avc1.640028", h265: "hvc1.1.6.L93.B0", vp9: "vp09.00.10.08", av1: "av01.0.08M.08", vp8: "vp8" };

export async function detectMachine(): Promise<Machine> {
  const nav: any = navigator, uad = nav.userAgentData;
  let os = uad?.platform || nav.platform || "Unknown", arch = "";
  try { const h = await uad?.getHighEntropyValues?.(["architecture", "bitness", "platformVersion"]); if (h) arch = `${h.architecture}${h.bitness ? "-" + h.bitness : ""}`; } catch {}
  if (/mac/i.test(os)) os = "macOS"; else if (/win/i.test(os)) os = "Windows"; else if (/linux/i.test(os)) os = "Linux";
  let gpu = "Unknown", gpuVendor = "";
  try {
    const c = document.createElement("canvas"), gl = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null;
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    if (gl && ext) { const raw = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)); gpuVendor = String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL));
      const m = /ANGLE \(([^,]+),\s*([^,(]+?)(?:\s*\(0x[0-9a-f]+\))?(?:,|\))/i.exec(raw); gpu = m ? m[2].replace(/^ANGLE Metal Renderer:\s*/i, "").replace(/Direct3D11 vs_5_0 ps_5_0/i, "").trim() || raw : raw; }
  } catch {}
  let webgpu = "";
  try { const a = await nav.gpu?.requestAdapter?.(); if (a) { const i = a.info || (await a.requestAdapterInfo?.()) || {}; webgpu = [i.vendor, i.architecture, i.description].filter(Boolean).join(" · ") || "available"; } } catch {}
  const codecs: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(CODEC_STR)) {
    try { codecs[k] = !!(await (window as any).VideoEncoder?.isConfigSupported({ codec: v, width: 1920, height: 1080, bitrate: 8e6, framerate: 30 }))?.supported; } catch { codecs[k] = false; }
  }
  const b = /(Edg|Chrome|Firefox|Safari)\/([\d.]+)/.exec(navigator.userAgent);
  return { os, arch, threads: nav.hardwareConcurrency || 0, memGB: nav.deviceMemory ? nav.deviceMemory : null, gpu, gpuVendor, webgpu, browser: b ? `${b[1] === "Edg" ? "Edge" : b[1]} ${b[2].split(".")[0]}` : "Unknown", codecs };
}

/** Real speed test: encodes synthetic 720p frames with each codec × (hardware | software). */
export async function benchmark(codecs: string[], onStep: (m: string) => void): Promise<BenchRow[]> {
  const rows: BenchRow[] = [], W = 1280, H = 720, N = 45;
  const cv = new OffscreenCanvas(W, H), ctx = cv.getContext("2d")!;
  for (const codec of codecs) for (const mode of ["hardware", "software"] as const) {
    onStep(`Testing ${codec.toUpperCase()} · ${mode}…`);
    let fps: number | null = null;
    try {
      const cfg: any = { codec: CODEC_STR[codec], width: W, height: H, bitrate: 6e6, framerate: 30, hardwareAcceleration: mode === "hardware" ? "prefer-hardware" : "prefer-software", latencyMode: "quality" };
      if (codec === "h264") cfg.avc = { format: "annexb" };
      if (!(await VideoEncoder.isConfigSupported(cfg)).supported) { rows.push({ codec, mode, fps }); continue; }
      let done = 0, err = false; const enc = new VideoEncoder({ output: () => { done++; }, error: () => { err = true; } }); enc.configure(cfg);
      const t0 = performance.now();
      for (let i = 0; i < N && !err; i++) {
        const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, `hsl(${(i * 8) % 360},80%,55%)`); g.addColorStop(1, `hsl(${(i * 8 + 140) % 360},80%,30%)`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "#fff"; ctx.font = "80px sans-serif"; ctx.fillText("Render " + i, 80 + i * 8, 360);
        const f = new VideoFrame(cv, { timestamp: i * 33333 }); enc.encode(f, { keyFrame: i % 30 === 0 }); f.close();
        if (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
      }
      await enc.flush(); enc.close(); const dt = (performance.now() - t0) / 1000; if (!err && done) fps = Math.round(N / dt);
    } catch { fps = null; }
    rows.push({ codec, mode, fps });
  }
  return rows;
}

export type Pref = Partial<Settings>;
export function recommend(m: Machine, bench?: BenchRow[]): { pref: Pref; why: string } {
  const order = ["h264", "h265", "vp9", "av1", "vp8"].filter((c) => m.codecs[c]);
  const codec = (order[0] || "vp9") as Settings["codec"];
  const row = (mode: string) => bench?.find((r) => r.codec === codec && r.mode === mode)?.fps ?? null;
  const hw = row("hardware"), sw = row("software");
  const hwMode: Settings["hw"] = hw && sw ? (hw >= sw * 1.15 ? "prefer-hardware" : "prefer-software") : "no-preference";
  const why = `${codec.toUpperCase()} in MP4 is the most compatible format your browser can encode.` + (hw && sw ? ` Measured: hardware ${hw} fps vs software ${sw} fps → ${hwMode === "prefer-hardware" ? "using your GPU/media engine" : "using CPU encoding"}.` : " Run the benchmark to pick GPU vs CPU encoding automatically.");
  return { pref: { container: "mp4", codec, hw: hwMode, quality: "high" }, why };
}
export const loadPref = (): Pref | null => { try { return JSON.parse(localStorage.getItem("rs_pref") || "null"); } catch { return null; } };
export const savePref = (p: Pref) => localStorage.setItem("rs_pref", JSON.stringify(p));

/* Detection runs once per session and is shared by the sidebar panel, the
   "This computer" page and the render views; pass force to re-detect. */
let machineP: Promise<Machine> | null = null;
export const detectMachineCached = (force = false): Promise<Machine> => { if (force || !machineP) machineP = detectMachine(); return machineP; };

/* ---- Render power -------------------------------------------------------
   Cores are real only where an engine can use them: HyperFrames renders with
   parallel Chrome workers (--workers, capped at the detected core count).
   The @remotion/web-renderer has no concurrency option — it draws frames on
   one thread — so for Remotion "full power" maps to its strongest real
   settings (GPU-preferred encoding + the largest media cache) instead. */
export type PowerPref = { mode: "auto" | "custom" | "full"; cores: number };
export const loadPower = (): PowerPref => {
  try { const p = JSON.parse(localStorage.getItem("rs_power") || "{}"); return { mode: p.mode === "custom" || p.mode === "full" ? p.mode : "auto", cores: Math.max(0, Math.floor(+p.cores) || 0) }; }
  catch { return { mode: "auto", cores: 0 }; }
};
export const savePower = (p: PowerPref) => { try { localStorage.setItem("rs_power", JSON.stringify(p)); } catch {} };
/** The HyperFrames --workers value a power choice resolves to (never above the detected cores). */
export const powerWorkers = (p: PowerPref, maxCores: number): string => {
  if (p.mode === "full") return maxCores > 0 ? String(maxCores) : "auto";
  if (p.mode === "custom" && p.cores > 0) return String(maxCores > 0 ? Math.min(p.cores, maxCores) : p.cores);
  return "auto";
};
