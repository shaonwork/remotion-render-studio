# Render Studio — every AI video project, one studio

A static web app (Vite + React) that opens video-project ZIPs **in the browser** and
figures out by itself which tool made them. No server — projects and renders are
stored in the browser's IndexedDB; Vercel (or any static host) only serves the files.

## Auto-detection

Drop any ZIP (or project folder) and the studio detects its type:

| ZIP you drop | Detected as | What the studio does |
| --- | --- | --- |
| Remotion project (`package.json` depends on `remotion`) | **Remotion** | Compiles it in the browser and renders MP4/WebM with WebCodecs — full studio, exactly as before. |
| HyperFrames project (`index.html` with `data-composition-src`) | **HyperFrames** | Plays the real project in the built-in player (timelines, captions and audio in sync, play/pause/scrub), lists its scenes, and offers a one-click **render kit** — the desktop HyperFrames tool does the final MP4, because it needs a real browser engine + FFmpeg. |
| OpenMontage (the agent system itself) | **OpenMontage** | Explains what it is and what to do with it — it is an AI production pipeline you run on your computer, not a playable project. Videos/projects it exports as Remotion or HyperFrames ZIPs are detected automatically when dropped here. |
| Skill pack (`SKILL.md` files — e.g. Motion Design Skills, Anything-to-Explainer) | **Skill pack** | Lists the skills inside and explains how to use them. Skills teach an AI agent; videos made *with* them come out as Remotion or HyperFrames projects, which this studio opens. |
| Anything else | **Unknown** | Shows what was found and which formats are supported. |

Detection code: `src/lib/detect.ts`. The HyperFrames player is a small
deterministic runtime (`src/lib/hfplayer.ts`) that mounts each composition
into its host, time-gates every `[data-start]` element, seeks every GSAP
timeline (`window.__timelines`) and syncs audio/video clips — the same
model the official renderer uses, adapted for live playback.

## Deploy to Vercel
**Option A — GitHub:** push this folder to a repo → Vercel → *Add New Project* → import. Defaults are picked up from `vercel.json`.
**Option B — CLI:** `npm i -g vercel && vercel --prod` inside this folder.

## Offline single-file version
```
npm run build:single   # → single/Render-Studio.html
```
This produces **one self-contained HTML file** (~22 MB): every script, style,
the esbuild WebAssembly compiler and the media encoders are inlined, so it runs
straight from `file://` — double-click it and the whole studio opens in the
browser. No server, no hosting, works with no internet. Projects still persist
in the browser's IndexedDB; on browsers that block storage for local files the
studio falls back to in-memory storage for the session (`src/lib/db.ts`).

## Local dev
```
npm install
npm run dev      # http://localhost:5173
npm run build    # outputs dist/
```

## Features
- Any supported project ZIP **or project folder** (drag & drop, click to browse, paste, or "Open a project folder").
- **Output folder**: pick where finished Remotion videos are saved (Chrome/Edge, Windows & macOS).
- **This computer** page: detects OS, CPU threads, GPU, supported encoders and benchmarks hardware vs software encoding to choose the fastest settings.

## Notes
- Use desktop **Chrome or Edge** (needs WebCodecs for Remotion rendering). Safari/Firefox are limited.
- Remotion licensing: pass your key under *Advanced → Remotion license key* (default `free-license`, only if you qualify: https://remotion.dev/license).
- Supported imports in uploaded Remotion projects: remotion, react, @remotion/{transitions, shapes, paths, noise, layout-utils, media}, zod.
- The classic `<Audio>/<Video>/<OffthreadVideo>` are automatically mapped to `@remotion/media`.
- HyperFrames preview note: projects that load their own extra runtime/player scripts may behave differently in the preview; the render kit always produces the exact official render.
