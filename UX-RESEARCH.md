# Render Studio — UX Research & Decisions (2026-11-07)

Written before the user-friendliness rebuild, in response to Shaon's complaints
about the previous build: (1) hard to understand, (2) UI blinks/flickers,
(3) text not clear in places, (4) the preview needs page scrolling to see,
(5) the settings panel overflows (codec select truncated, audio-quality
segmented control spilling out). Every finding below ends in a concrete
decision that the rebuild implements.

## 1. Readability on dark UIs

**Standard.** WCAG 2.2 AA (SC 1.4.3) requires ≥ 4.5:1 contrast for normal
text, 3:1 for large text and UI components. Practical guides converge on:
body text ≥ 14–16px, secondary/fine print never below ~12–14px, line-height
1.4–1.6.

**Why the current build still looks dim despite "passing".** The old
secondary colour `--dim: #8d93a1` measures 6.5:1 on the page background
(#07080c) and 6.1:1 on card surfaces — a paper pass. But APCA research
(WCAG 3 draft work) shows the WCAG 2 formula *overstates* contrast for
light-on-dark pairs: mid-gray on near-black is perceived at roughly half its
rated strength. Compounding that, the old UI set that gray at 10.5–12px in
medium weights (stat labels 10.5px, sidebar notes 11px, hints 12px), where
thin strokes carry even less perceived contrast. Result: text that passes a
checker but reads as murky — exactly complaint (3).

**Decisions.**
- Text scale (measured against page bg / card surface):
  - Primary text `#eceef3` — 17.2:1 / 16.1:1 (unchanged).
  - Secondary text `--dim` → `#aeb6c4` — 9.8:1 / 9.2:1 (AAA-level), used for
    hints, sub-text, meta lines.
  - Labels `--label: #c6cdd9` — 12.5:1 / 11.7:1, 12px uppercase, for field
    labels (was 11.5px in the dim gray).
- Size floor: no meaningful text below 12px. Hints 12.5px, sub-text 13px,
  sidebar meta 12.5px, stat labels 11.5px bold uppercase in the label colour
  (large-text treatment), body stays 14px, line-height 1.5 for prose hints.
- Truncation: anything ellipsised (project names, folder names, GPU string)
  gets a `title` with the full text; selects get room to show their value
  (see §5) instead of being squeezed.

## 2. App-shell layout — the work view must fit the viewport

**Pattern.** Pro tools (VS Code, Slack, Figma) use a fixed app shell:
`height: 100dvh`, document never scrolls, each region owns its scrolling
(`overflow-y: auto` on the main region, `min-height: 0` on flex children so
scrollers actually engage). `100dvh` (dynamic viewport units) is the 2023+
baseline and avoids the classic 100vh overflow bugs.

**Why the current build scrolls.** `.shell` is only `min-height: 100vh`,
`.main` is a normal-flow page with 90px bottom padding, and the preview box
is sized by *width* (`aspect-ratio` + `width: 100%`). For a 9:16 composition
in a ~900px-wide column that yields a ~1600px-tall preview — taller than any
laptop screen, so the user scrolls to see the bottom and the player
controls (complaint 4).

**Decisions.**
- Shell: `html, body, #root { height: 100%; overflow: hidden }`,
  `.shell { height: 100dvh }`, `.main` becomes the single scroll region for
  page-like views (Library, Showcase) with `overflow-y: auto`.
- Studio work view: a full-height flex column — header (fixed), then a work
  grid that takes exactly the remaining height. Left column: preview card
  flexes to fill; compositions card capped (max-height + own scroll).
  Right column: the settings panel is a full-height card with its own
  internal scroll area and a **fixed footer** holding the Render button and
  job status — always visible, never scrolled away.
- Preview sizing is height-driven: a `ResizeObserver` measures the stage
  box and the player is sized `min(boxW, boxH × W/H) × min(boxH, boxW × H/W)`
  in px, so a 9:16 preview + its controls are fully visible at 1440×900 and
  1280×720 with zero page scroll. Viewport math at 1280×720: 720 − main
  padding (24+28) − header (~62) ≈ 606px for the work grid; the stage gets
  ≈ 480–560px after the card chrome → 9:16 preview ≈ 270–315px wide × full
  height. Small, but complete — that is the honest trade at 720p, and the
  panel/footer stay put.
- Below 1150px the grid stacks and the work area scrolls internally (the
  document still never scrolls).

## 3. Flicker — causes found in this codebase, and fixes

Research consensus: flicker = high-frequency state high in the tree
re-rendering heavy subtrees, remounts from unstable keys/props, layout
animations, and paint-expensive effects. All four were present:

1. **Progress state in the page root.** `renderMediaOnWeb` fires
   `onProgress` per frame event; `ProjectView` stored every tick in state,
   re-rendering the *entire* view — settings panel, compositions, and the
   Remotion Player — dozens of times per second, plus a 400ms `now` timer
   doing the same for the elapsed clock.
   → **Fix:** live progress moves into a mutable ref; a small isolated
   `ProgressPanel` component polls it at 4Hz with its own state and its own
   clock. The page-level `job` state changes only on start / done / error /
   cancel. The preview is wrapped in `React.memo` with stable props.
2. **Remount flashes.** The blanket `.main > * { animation: viewin }` rule
   replays a fade/slide whenever a direct child of main mounts — including
   when the project block swaps from the loading fallback to the resolved
   view. → **Fix:** blanket rule removed; a subtle entrance animation is
   applied only to genuine view roots, transform/opacity only.
3. **Paint-expensive surfaces.** Every `.card` and the sidebar used
   `backdrop-filter: blur(18px)` over the fixed gradient backdrop — any
   repaint (progress, scroll) re-blurs large areas, a classic shimmer/
   flicker source. → **Fix:** backdrop blur removed from cards/sidebar
   (kept on modal/overlay/toast where it is transient); panel fills raised
   slightly to compensate.
4. **Perpetual motion.** The logo and primary buttons ran an infinite
   `background-position` gradient animation — constant repaint that reads as
   blinking, worst on the big primary button. The status `.pulse` animated
   `box-shadow` (paint each frame). → **Fix:** infinite gradient animation
   removed; pulse re-implemented with transform + opacity; the render
   progress stripes stay (transform-only, and only while rendering);
   `prefers-reduced-motion` still disables motion globally.
5. **Thumbnail URL churn.** Sidebar/card thumbnails come from IndexedDB,
   which returns a *new* Blob object on every read; `useObjectUrl` revoked
   and recreated the URL on every list refresh (e.g. after each render), so
   images visibly blinked. → **Fix:** `useObjectUrl` accepts a stable key
   (project/render id) and caches URLs per key, re-creating only when the
   blob's size actually changes.

## 4. Progressive disclosure & plain language

**Pattern.** Show the few decisions every render needs; collapse the rest
behind one clearly-labelled "Advanced settings" disclosure; one dominant
primary action; every jargon term gets a plain label plus a one-line
"what this does" helper. Defaults must be good enough that a first-time
user can press Render without opening Advanced.

**Decisions (Remotion panel).**
- Basic, always visible, in task order: **Video format** · **Quality**
  ("Higher = sharper picture, bigger file") · **Video size** (was
  "Resolution scale 0.5×/1×/2×" → "Half size / Full size / …" + the pixel
  size in the helper) · **How much to render** (Full video / Quick test /
  Part only) · **Sound on/off** (was the negatively-worded "Mute audio"
  switch) · **Save to folder** · **File name**.
- Advanced (collapsed by default): Video codec, GPU/CPU encoder, Turbo
  (full-power) switch, Sound format, Sound quality, "Patience for slow
  frames" (was "Frame wait timeout / delayRender"), Transparent background,
  Keyframe interval, "Memory for videos" (media cache), Input props (JSON),
  License key — each with a one-line plain-English helper.
- The Render button lives in the panel's fixed footer (§2), labelled
  "Start render", full width.
- HyperFrames panel keeps all its flags; group order already goes
  basic → advanced; labels gain the same helpers where they were bare
  ("Rate control", "Workers" already explained).

## 5. Panel overflow discipline

**Root cause of complaint (5).** The panel is a fixed 380px column; rows
use `.f { flex: 1; min-width: 130px }` and `.seg` never wraps, so a
two-field row (Audio codec select + 5-option Audio quality segment) needs
≈ 130 + 12 + ~290px of non-shrinking content inside a ~336px content box —
the select ellipsises ("Auto (best for for…") and the segment spills past
the card edge.

**Decisions.**
- `.f { flex: 1 1 150px; min-width: 0 }` — fields may shrink; rows wrap.
- `.seg { flex-wrap: wrap }`, buttons `flex: 1 1 auto` — a segment wraps to
  two lines instead of overflowing.
- Audio codec + quality become full-width stacked rows (they were the
  offenders); the codec's default option shortens to "Auto (recommended)".
- Panel column widens 380 → 400px; `min-width: 0` added down the grid/card
  chain; selects capped at 100% width.

## Sources

- WCAG 2.2 SC 1.4.3 (4.5:1 / 3:1) and practical size guidance —
  acellesend.com WCAG email guide; humanstandards.org "Legibility &
  Contrast" (16px body, fine print ≥14px, line-height 1.4–1.6).
- APCA vs WCAG 2 — web3icons.com guide: WCAG 2 overrates dark-mode pairs;
  mid-gray on black perceives far weaker than its ratio.
- App-shell pattern — hypermedia-components "Shell" (grid, 100dvh, main
  scrolls independently); production post-mortems (forge-workout-tracker
  CLAUDE.md v3.4/v3.5: fixed-height shell, `overflow: hidden` document,
  `min-h: 0` scrollers, backdrop-blur layers drifting/flickering).
- React flicker — copyprogramming "React UI Flickering When State Updated"
  (async updates, cascaded re-renders, key churn); anber.me "Optimizing
  React Render Performance" (isolate volatile state into micro-components,
  memo only with stable props); FLICKERING_FIX_COMPLETE.md (memoization +
  UI throttling precedent).
- Contrast ratios in §1 were computed locally with the WCAG luminance
  formula against this app's actual background colours.
