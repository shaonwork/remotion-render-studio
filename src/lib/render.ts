import { renderMediaOnWeb, canRenderMediaOnWeb, getEncodableVideoCodecs, getEncodableAudioCodecs, type WebRendererVideoCodec, type WebRendererAudioCodec, type WebRendererQuality, type WebRendererContainer } from "@remotion/web-renderer";
import { canEncodeVideo, Quality } from "mediabunny";
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

/* ------------------------------------------------------------------ */
/* Exact, SIZE-AWARE encoder probing.                                  */
/*                                                                     */
/* Encoder support in WebCodecs is per EXACT configuration — codec     */
/* string (for H.264 the string carries the AVC level, which          */
/* mediabunny derives from the frame size + bitrate), width, height,   */
/* bitrate, framerate AND hardwareAcceleration. A codec that encodes   */
/* happily at 1080×1920 can be refused at 2160×3840, and a mode that    */
/* fails (GPU) can succeed in another (CPU). So before a render starts */
/* we probe — through mediabunny's own canEncodeVideo, which builds    */
/* the very candidate configs the render's encoder selection will      */
/* try — every acceleration mode at the render's exact output size,    */
/* and the render then uses the first mode that probed as supported.   */
/* The Quality object is built exactly as @remotion/web-renderer       */
/* builds it ({quality, preferBitrate: true}), so the probed bitrate   */
/* candidate is bit-for-bit the render's candidate.                    */
/*                                                                     */
/* (The previous pre-flight passed already-scaled width/height AND     */
/* the scale to canRenderMediaOnWeb, whose contract is UNSCALED        */
/* dimensions + scale — so at 1.5×/2× it probed 2430×4320 /             */
/* 4320×7680, sizes no H.264 encoder accepts, and killed renders       */
/* that would have worked at the real size. That is fixed below:       */
/* canRenderMediaOnWeb now receives the composition size + scale.)     */
/* ------------------------------------------------------------------ */
export type AccelMode = Settings["hw"];
const MB_CODEC: Record<string, string> = { h264: "avc", h265: "hevc", vp8: "vp8", vp9: "vp9", av1: "av1" };
export const CODEC_NAME: Record<string, string> = { h264: "H.264", h265: "H.265 (HEVC)", vp9: "VP9", av1: "AV1", vp8: "VP8" };
const accelChain = (pref: AccelMode): AccelMode[] =>
  pref === "prefer-hardware" ? ["prefer-hardware", "no-preference", "prefer-software"]
  : pref === "prefer-software" ? ["prefer-software", "no-preference", "prefer-hardware"]
  : ["no-preference", "prefer-hardware", "prefer-software"];

/** The exact output dimensions the renderer will encode, mirroring
    @remotion/web-renderer's getEncodedDimensions (even dimensions for
    h264/h265/av1, obtained by trimming the base size before scaling). */
export function outputDims(width: number, height: number, scale: number, codec: string): { width: number; height: number } {
  if (codec !== "h264" && codec !== "h265" && codec !== "av1") return { width: Math.ceil(width * scale), height: Math.ceil(height * scale) };
  let w = width, h = height;
  while (Math.round(h * scale) % 2 !== 0 && h > 2) h--;
  while (Math.round(w * scale) % 2 !== 0 && w > 2) w--;
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

async function probeAccel(codec: string, w: number, h: number, fps: number, quality: Settings["quality"], mode: AccelMode): Promise<boolean> {
  const mb = MB_CODEC[codec];
  if (!mb || typeof VideoEncoder === "undefined") return false;
  try {
    return await canEncodeVideo(mb as any, { width: w, height: h, bitrate: new Quality({ quality, preferBitrate: true }), frameRate: fps, hardwareAcceleration: mode } as any);
  } catch { return false; }
}

export type EncodePlan = { mode: AccelMode | null; support: Partial<Record<AccelMode, boolean>> };
/** Probe every acceleration mode at the exact output config; the plan's
    mode is the first supported one in the user's preference order. */
export async function resolveEncodePlan(codec: string, w: number, h: number, fps: number, quality: Settings["quality"], pref: AccelMode): Promise<EncodePlan> {
  const support: Partial<Record<AccelMode, boolean>> = {};
  let mode: AccelMode | null = null;
  for (const m of accelChain(pref)) {
    support[m] = await probeAccel(codec, w, h, fps, quality, m);
    if (support[m] && !mode) mode = m;
  }
  return { mode, support };
}

const modeText = (m: AccelMode) => (m === "prefer-hardware" ? "GPU (hardware) encoding" : m === "prefer-software" ? "CPU (software) encoding" : "the browser's automatic encoding");
/** Plain-language note when the render will not use the encoder the user
    asked for — or null when it will. */
function encodeFallbackNote(codec: string, w: number, h: number, asked: AccelMode, used: AccelMode): string | null {
  if (used === asked) return null;
  const name = CODEC_NAME[codec] || codec.toUpperCase();
  if (asked === "no-preference") return `Encoding: ${modeText(used)} was used — the browser's automatic path can't encode ${name} at ${w}×${h} here.`;
  return `Encoding: ${modeText(used)} was used — the ${modeText(asked)} path can't encode ${name} at ${w}×${h} in this browser.`;
}

/* Which encoder path a render will use, stated honestly, from the same
   exact probing the render itself uses. Nothing here guesses a CPU
   percentage — browsers do not expose real CPU usage to pages. */
export async function probeEncoderMode(codec: string, width: number, height: number, pref: Settings["hw"], fps = 30, quality: Settings["quality"] = "high"): Promise<string> {
  const plan = await resolveEncodePlan(codec, width, height, fps, quality, pref);
  if (!plan.mode) return "Not available at this size in this browser";
  if (plan.mode === "prefer-hardware") return "GPU · hardware encoding";
  if (plan.mode === "prefer-software") return pref === "prefer-software" ? "CPU · software encoding" : "CPU · software encoding (hardware unavailable at this size)";
  return plan.support["prefer-hardware"] ? "Auto · browser chooses (hardware encoding available)" : "Auto · browser chooses (software encoding)";
}

/** When NO acceleration mode can encode the chosen codec at the chosen
    size, explain it properly: name the codec + size, find the largest
    size of the same format that DOES probe as supported, and list
    other format/codec pairs that support the chosen size — all probed
    live, nothing guessed. */
async function encodeFailureMessage(c: CompMeta, s: Settings, dims: { width: number; height: number }): Promise<string> {
  const name = CODEC_NAME[s.codec] || s.codec.toUpperCase();
  const fps = c.fps || 30;
  const lines = [`${s.container.toUpperCase()} (${name}) can't be encoded at ${dims.width}×${dims.height} in this browser — its ${name} encoder refuses frames that size at this quality, on both the GPU and CPU paths.`];
  const scaleLabel = (sc: number) => (sc === 1 ? "“Full”" : sc === 0.5 ? "“Half”" : `“${sc}×”`);
  for (const sc of [2, 1.75, 1.5, 1.25, 1, 0.75, 0.5]) {
    if (sc >= s.scale - 1e-9) continue;
    const d = outputDims(c.width || 0, c.height || 0, sc, s.codec);
    const p = await resolveEncodePlan(s.codec, d.width, d.height, fps, s.quality, s.hw);
    if (p.mode) { lines.push(`The largest ${s.container.toUpperCase()} size that works in this browser is ${d.width}×${d.height} — set “Video size” to ${scaleLabel(sc)} and press Start render again.`); break; }
  }
  const alts: string[] = [];
  for (const cont of ["webm", "mkv", "mp4", "mov"] as Settings["container"][]) {
    let list: string[] = [];
    try { list = (await encodable(cont, s.quality)) as string[]; } catch { list = []; }
    for (const cd of list) {
      if (cont === s.container && cd === s.codec) continue;
      if (s.transparent && !(cont === "webm" || cont === "mkv")) continue;
      const p = await resolveEncodePlan(cd, dims.width, dims.height, fps, s.quality, s.hw);
      if (p.mode) alts.push(`${cont.toUpperCase()} with ${(CODEC_NAME[cd] || cd.toUpperCase()).split(" ")[0]}`);
      if (alts.length >= 3) break;
    }
    if (alts.length >= 3) break;
  }
  if (alts.length) lines.push(`Or keep ${dims.width}×${dims.height} in a format this browser can encode at that size: ${alts.join(" · ")}.`);
  lines.push(`If this size has rendered in this browser before, also check that graphics acceleration is on (Chrome menu → Settings → System → “Use graphics acceleration when available”), restart the browser, and try again.`);
  return lines.join("\n");
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
  /* Size-aware encode plan FIRST: probe the exact output configuration in
     every acceleration mode. This decides which hardwareAcceleration the
     render may use — and if none works, the render stops HERE, at Start
     time, with a useful explanation instead of the bare library error. */
  const dims = outputDims(c.width || 0, c.height || 0, s.scale, s.codec);
  const plan = await resolveEncodePlan(s.codec, dims.width, dims.height, c.fps || 30, s.quality, s.hw);
  /* Pre-flight with the renderer's own checker. NOTE the arguments: this
     API takes the UNSCALED composition dimensions plus scale (it applies
     the scale itself) — passing pre-scaled dimensions here was the bug
     that probed 4× the pixels at 2× and rejected working renders. This
     checker still owns audio-codec resolution (the classic silent-video
     failure becomes a clear error BEFORE rendering), container checks and
     warnings; its video-codec verdict, however, only ever probes one
     implicit acceleration mode, so when our exact multi-mode plan found a
     working mode, that one issue is superseded and dropped. */
  const can = await canRenderMediaOnWeb({ container: s.container, videoCodec: s.codec, width: c.width, height: c.height, scale: s.scale, transparent: s.transparent, muted: s.muted, videoBitrate: s.quality, ...audioOpts } as any);
  let issues = can.issues.slice();
  if (plan.mode) issues = issues.filter((i) => i.type !== "video-codec-unsupported");
  const errs = issues.filter((i) => i.severity === "error");
  if (errs.length) throw new Error(errs[0].type === "video-codec-unsupported" ? await encodeFailureMessage(c, s, dims) : errs[0].message);
  if (!plan.mode) throw new Error(await encodeFailureMessage(c, s, dims));
  let warnings: string[] = issues.filter((i) => i.severity === "warning").map((i) => i.message);
  const audioCodec: string | null = can.resolvedAudioCodec;
  if (!s.muted && expectAudio && !audioCodec) throw new Error("This browser could not provide an audio encoder for this format, so the video would come out silent. Try another format (e.g. WebM) or pick a specific audio codec in the render settings.");
  const fbNote = encodeFallbackNote(s.codec, dims.width, dims.height, s.hw, plan.mode);
  if (fbNote) warnings.push(fbNote);
  const t0 = performance.now();
  /* Render — with a safety net: if the platform refuses the probed mode
     anyway when encoding actually starts (probed support can drift, e.g.
     the encoder's exact internal config differs), step to the next
     probed-supported mode and start over. Drawn frames are NOT committed
     output — in this pipelined renderer the encoder is only created when
     the first drawn frame reaches it, so an encoder refusal can surface
     after frames were drawn; restarting is still always safe (nothing
     exists until the final blob) and strictly better than failing. */
  const modesToTry = accelChain(s.hw).filter((m) => plan.support[m]);
  let res: any = null, lastErr: any = null;
  for (const mode of modesToTry) {
    try {
      res = await renderMediaOnWeb({
        composition: { id: c.id, component: c.component, width: c.width, height: c.height, fps: c.fps, durationInFrames: c.durationInFrames, defaultProps: c.defaultProps, calculateMetadata: c.calculateMetadata } as any,
        inputProps: inputProps as any, container: s.container, videoCodec: s.codec, videoBitrate: s.quality, hardwareAcceleration: mode, frameRange, scale: s.scale, muted: s.muted, signal, logLevel: "warn", licenseKey: localStorage.getItem("rs_license") || "free-license",
        ...audioOpts,
        ...(s.delayRenderMs > 0 ? { delayRenderTimeoutInMilliseconds: s.delayRenderMs } : {}),
        ...(s.keyframeSec > 0 ? { keyframeIntervalInSeconds: s.keyframeSec } : {}),
        ...(s.mediaCacheMb > 0 ? { mediaCacheSizeInBytes: Math.round(s.mediaCacheMb * 1024 * 1024) } : {}),
        ...(s.transparent ? { transparent: true } : {}),
        onProgress: (p: any) => { onProgress({ progress: p.progress, rendered: p.renderedFrames, encoded: p.encodedFrames, etaMs: p.renderEstimatedTime }); },
      } as any);
      if (mode !== plan.mode) warnings.push(`Encoding: the first encoder choice was refused when the render began, so it restarted on ${modeText(mode)} — the finished video is unaffected.`);
      break;
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || e);
      if (signal.aborted || !/encoder|codec|configur|not supported|unsupported/i.test(msg)) throw e;
    }
  }
  if (!res) throw lastErr || new Error("The render could not start.");
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
