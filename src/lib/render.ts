import { renderMediaOnWeb, canRenderMediaOnWeb, getEncodableVideoCodecs, getEncodableAudioCodecs, type WebRendererVideoCodec, type WebRendererAudioCodec, type WebRendererQuality, type WebRendererContainer } from "@remotion/web-renderer";
import type { CompMeta } from "./host";

export type Settings = {
  container: "mp4" | "webm" | "mkv" | "mov"; codec: WebRendererVideoCodec; quality: "low" | "medium" | "high" | "very-high"; hw: "no-preference" | "prefer-hardware" | "prefer-software";
  scale: number; range: "full" | "test" | "custom"; testFrames: number; from: number; to: number; muted: boolean; props: string; filename: string; keepCopy: boolean;
  /* Real @remotion/web-renderer options. 0 / "auto" / false = leave unset so the library default applies. */
  audioCodec: "auto" | WebRendererAudioCodec; audioBitrate: "auto" | WebRendererQuality;
  delayRenderMs: number; keyframeSec: number; mediaCacheMb: number; transparent: boolean;
};
export const defaultSettings = (): Settings => ({ container: "mp4", codec: "h264", quality: "high", hw: "no-preference", scale: 1, range: "full", testFrames: 60, from: 0, to: 150, muted: false, props: "{}", filename: "", keepCopy: true, audioCodec: "auto", audioBitrate: "auto", delayRenderMs: 0, keyframeSec: 0, mediaCacheMb: 0, transparent: false });

export const supported = () => typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";

/* Which encoder path a render will use, stated honestly. WebCodecs never
   reveals the encoder it actually picked, so this reports (a) what the
   user's setting asks for and (b) what this machine can do — probed with
   the real VideoEncoder.isConfigSupported for the exact codec/size:
   an explicit GPU/CPU choice is checked against the machine, while
   "Auto" is reported as the browser's choice plus the machine's
   capability. Nothing here guesses a CPU percentage — browsers do not
   expose real CPU usage to pages. */
const ENC_STR: Record<string, string> = { h264: "avc1.640028", h265: "hvc1.1.6.L93.B0", vp9: "vp09.00.10.08", av1: "av01.0.08M.08", vp8: "vp8" };
export async function probeEncoderMode(codec: string, width: number, height: number, pref: Settings["hw"]): Promise<string> {
  const hwOk = async (): Promise<boolean> => {
    try {
      const cfg: any = { codec: ENC_STR[codec] || codec, width: Math.max(2, Math.round(width / 2) * 2), height: Math.max(2, Math.round(height / 2) * 2), bitrate: 8e6, framerate: 30, hardwareAcceleration: "prefer-hardware" };
      return !!(await (window as any).VideoEncoder?.isConfigSupported(cfg))?.supported;
    } catch { return false; }
  };
  if (pref === "prefer-software") return "CPU · software encoding";
  if (pref === "prefer-hardware") return (await hwOk()) ? "GPU · hardware encoding" : "CPU · software (GPU encoding unavailable)";
  return (await hwOk()) ? "Auto · browser chooses (hardware encoding available)" : "Auto · browser chooses (software encoding)";
}
export async function encodable(container: WebRendererContainer, quality?: WebRendererQuality): Promise<WebRendererVideoCodec[]> {
  try { return (await getEncodableVideoCodecs(container, quality ? { videoBitrate: quality } : undefined)) as WebRendererVideoCodec[]; } catch { return []; }
}
export async function encodableAudio(container: WebRendererContainer): Promise<WebRendererAudioCodec[]> {
  try { return (await getEncodableAudioCodecs(container)) as WebRendererAudioCodec[]; } catch { return []; }
}
export type Progress = { progress: number; rendered: number; encoded: number; etaMs: number };
export async function renderComposition(c: CompMeta, s: Settings, signal: AbortSignal, onProgress: (p: Progress) => void, expectAudio = false) {
  let inputProps: Record<string, unknown> = {}; try { inputProps = JSON.parse(s.props || "{}"); } catch { throw new Error("Input props JSON is not valid."); }
  const total = c.durationInFrames || 1;
  const frameRange: [number, number] | null = s.range === "test" ? [0, Math.min(total, Math.max(1, s.testFrames)) - 1] : s.range === "custom" ? [Math.max(0, s.from), Math.min(total - 1, s.to)] : null;
  const audioOpts = {
    ...(s.audioBitrate !== "auto" ? { audioBitrate: s.audioBitrate } : {}),
    ...(s.audioCodec !== "auto" ? { audioCodec: s.audioCodec } : {}),
  };
  /* Pre-flight with the renderer's own checker, using the exact same options the
     render will get. This turns the classic silent failure — a finished video
     with no sound because no audio encoder could be resolved — into a clear
     error BEFORE rendering, and surfaces codec fallbacks as warnings. */
  let warnings: string[] = [], audioCodec: string | null = null;
  if (!s.muted) {
    const can = await canRenderMediaOnWeb({ container: s.container, videoCodec: s.codec, width: Math.round((c.width || 0) * s.scale), height: Math.round((c.height || 0) * s.scale), scale: s.scale, transparent: s.transparent, muted: s.muted, videoBitrate: s.quality, ...audioOpts } as any);
    const errs = can.issues.filter((i) => i.severity === "error");
    if (errs.length) throw new Error(errs[0].message);
    warnings = can.issues.filter((i) => i.severity === "warning").map((i) => i.message);
    audioCodec = can.resolvedAudioCodec;
    if (expectAudio && !audioCodec) throw new Error("This browser could not provide an audio encoder for this format, so the video would come out silent. Try another format (e.g. WebM) or pick a specific audio codec in the render settings.");
  }
  const t0 = performance.now();
  const res = await renderMediaOnWeb({
    composition: { id: c.id, component: c.component, width: c.width, height: c.height, fps: c.fps, durationInFrames: c.durationInFrames, defaultProps: c.defaultProps, calculateMetadata: c.calculateMetadata } as any,
    inputProps: inputProps as any, container: s.container, videoCodec: s.codec, videoBitrate: s.quality, hardwareAcceleration: s.hw, frameRange, scale: s.scale, muted: s.muted, signal, logLevel: "warn", licenseKey: localStorage.getItem("rs_license") || "free-license",
    ...audioOpts,
    ...(s.delayRenderMs > 0 ? { delayRenderTimeoutInMilliseconds: s.delayRenderMs } : {}),
    ...(s.keyframeSec > 0 ? { keyframeIntervalInSeconds: s.keyframeSec } : {}),
    ...(s.mediaCacheMb > 0 ? { mediaCacheSizeInBytes: Math.round(s.mediaCacheMb * 1024 * 1024) } : {}),
    ...(s.transparent ? { transparent: true } : {}),
    onProgress: (p: any) => onProgress({ progress: p.progress, rendered: p.renderedFrames, encoded: p.encodedFrames, etaMs: p.renderEstimatedTime }),
  } as any);
  const blob = await res.getBlob();
  return { blob, renderMs: performance.now() - t0, frames: frameRange ? frameRange[1] - frameRange[0] + 1 : total, warnings, audioCodec };
}

/** Post-render truth check: does the produced file actually contain an audio
    track? Catches every silent-audio path (extraction fallback included) at
    the moment it happens instead of letting a mute video pass as "done". */
export async function outputHasAudio(blob: Blob): Promise<boolean> {
  try {
    const { Input, BlobSource, ALL_FORMATS } = await import("mediabunny");
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack();
    input.dispose();
    return !!track;
  } catch { return false; }
}
export async function makeThumb(blob: Blob): Promise<Blob | undefined> {
  return new Promise((ok) => {
    const v = document.createElement("video"), u = URL.createObjectURL(blob); v.muted = true; v.preload = "auto"; v.src = u;
    const done = (b?: Blob) => { URL.revokeObjectURL(u); ok(b); };
    v.onerror = () => done(); setTimeout(() => done(), 8000);
    v.onloadeddata = () => { v.currentTime = Math.min(1.2, (v.duration || 2) * 0.3); };
    v.onseeked = () => { const c = document.createElement("canvas"), w = 640; c.width = w; c.height = Math.round((w * v.videoHeight) / v.videoWidth) || 360; c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height); c.toBlob((b) => done(b || undefined), "image/jpeg", 0.82); };
  });
}

/** Downscale any image blob to a small JPEG (used for project thumbnails). */
export async function shrinkImage(blob: Blob, w = 540): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(blob);
    const h = Math.max(2, Math.round((w * bmp.height) / bmp.width));
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    cv.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
    return await new Promise((ok) => cv.toBlob((b) => ok(b || blob), "image/jpeg", 0.82));
  } catch { return blob; }
}

/** Render one frame of a Remotion composition as the project's library thumbnail. */
export async function makeProjectThumb(c: CompMeta, delayRenderMs = 0): Promise<Blob | undefined> {
  try {
    const { renderStillOnWeb } = await import("@remotion/web-renderer");
    const total = c.durationInFrames || 1;
    const frame = Math.min(total - 1, Math.max(0, Math.round(total * 0.12)));
    const res = await renderStillOnWeb({
      composition: { id: c.id, component: c.component, width: c.width, height: c.height, fps: c.fps, durationInFrames: c.durationInFrames, defaultProps: c.defaultProps, calculateMetadata: c.calculateMetadata } as any,
      frame, inputProps: (c.defaultProps || {}) as any, scale: Math.min(1, 720 / (c.width || 720)),
      ...(delayRenderMs > 0 ? { delayRenderTimeoutInMilliseconds: delayRenderMs } : {}),
      licenseKey: localStorage.getItem("rs_license") || "free-license",
    } as any);
    return await shrinkImage(await res.blob({ format: "jpeg", quality: 0.85 }), 540);
  } catch { return undefined; }
}
