RENDER STUDIO — OFFLINE VERSION
================================

No hosting, no server, no install. Everything is inside ONE file.

HOW TO USE
  1. Unzip this folder anywhere on your computer.
  2. Double-click  Render-Studio.html
  3. The full studio opens in your browser. That is all.

  Use Chrome or Edge for the best result (video rendering needs
  Chrome's WebCodecs). The studio works fully offline — no internet
  is needed after you have this file.

WHAT YOU CAN DO
  * Drop any project ZIP into the studio. It detects the type itself:
      - Remotion projects: preview + render MP4/WebM right in the page.
      - HyperFrames projects: play them in the built-in player, pick
        render settings (format, quality, frame rate, resolution,
        file name) and download a one-click render kit.
      - OpenMontage / skill packs: the studio recognises them and
        explains what they are.
  * Every project gets a thumbnail from its own video the first time
    you open it, shown in the Library and the sidebar.
  * Projects and renders are stored in your browser (on this
    computer only). They survive closing the browser. Note: if you
    clear the browser's site data for this file, the library is
    deleted — the "Clear all data" button in the studio does the
    same on purpose.

RENDER KITS (HyperFrames)
  A kit has two double-click launchers:
    1-open-studio.command  — starts the official HyperFrames Studio
                             (a local server; preview + edit in your
                             browser). This is the main one.
    2-render-video.command — renders the video file directly, with
                             the settings you picked in the studio.
  The .command files keep their executable permission inside the
  ZIP, so a plain double-click runs them — no chmod needed. First
  time only, macOS may still ask because the file came from a
  download: right-click the file -> Open -> Open.

The file is large (~22 MB) because the whole studio — the Remotion
compiler and render engine included — lives inside it.
