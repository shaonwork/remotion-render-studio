/* Modules that uploaded projects can import. They are provided by this app (one shared copy of React/Remotion). */
import * as React from "react";
import * as JsxRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as R from "remotion";
import * as Transitions from "@remotion/transitions";
import * as Fade from "@remotion/transitions/fade";
import * as Slide from "@remotion/transitions/slide";
import * as Wipe from "@remotion/transitions/wipe";
import * as Flip from "@remotion/transitions/flip";
import * as ClockWipe from "@remotion/transitions/clock-wipe";
import * as Shapes from "@remotion/shapes";
import * as Paths from "@remotion/paths";
import * as Noise from "@remotion/noise";
import * as Layout from "@remotion/layout-utils";
import * as Zod from "zod";
import * as Media from "@remotion/media";

export type CompMeta = { id: string; component: any; width?: number; height?: number; fps?: number; durationInFrames?: number; defaultProps?: any; calculateMetadata?: any; still?: boolean };
export type Ctx = { root: any; comps: CompMeta[]; url: (p: string) => string; missing: Set<string> };

export const makeHost = (ctx: Ctx): Record<string, any> => {
  const Capture = (still: boolean) => (props: any) => { if (!ctx.comps.find((c) => c.id === props.id)) ctx.comps.push({ ...props, still }); return null; };
  // The browser renderer only supports the new @remotion/media components — map the classic ones onto them.
  const mapAV = (C: any) => (props: any) => {
    const { startFrom, endAt, ...rest } = props;
    return React.createElement(C, { ...rest, ...(startFrom != null ? { trimBefore: startFrom } : {}), ...(endAt != null ? { trimAfter: endAt } : {}) });
  };
  const remotion = {
    ...R,
    __esModule: true,
    registerRoot: (c: any) => { ctx.root = c; },
    staticFile: (p: string) => ctx.url(p),
    Composition: Capture(false),
    Still: Capture(true),
    Audio: mapAV((Media as any).Audio),
    Html5Audio: mapAV((Media as any).Audio),
    Video: mapAV((Media as any).Video),
    OffthreadVideo: mapAV((Media as any).Video),
    Html5Video: mapAV((Media as any).Video),
    Folder: (p: any) => React.createElement(React.Fragment, null, p.children),
  };
  return {
    react: React, "react/jsx-runtime": JsxRuntime, "react/jsx-dev-runtime": JsxRuntime, "react-dom": ReactDOM, "react-dom/client": ReactDOMClient,
    remotion,
    "@remotion/transitions": Transitions, "@remotion/transitions/fade": Fade, "@remotion/transitions/slide": Slide, "@remotion/transitions/wipe": Wipe,
    "@remotion/transitions/flip": Flip, "@remotion/transitions/clock-wipe": ClockWipe,
    "@remotion/media": Media, "@remotion/shapes": Shapes, "@remotion/paths": Paths, "@remotion/noise": Noise, "@remotion/layout-utils": Layout, zod: Zod, "zod/v4": Zod,
  };
};
export const HOST_NAMES = new Set(Object.keys(makeHost({ root: null, comps: [], url: (p) => p, missing: new Set() })));
