import { unzipSync } from "fflate";
import { detectProject, type Detection } from "./detect";

export type Files = Map<string, Uint8Array>;
export type Opened = { files: Files; pkg: any; entry: string; root: string };
export type AnyOpened = { files: Files; det: Detection };

const SKIP = /(^|\/)(__MACOSX|node_modules|\.git|\.DS_Store|out|\.next|dist)(\/|$)/;

async function unzipAll(blob: Blob): Promise<Map<string, Uint8Array>> {
  const u8 = new Uint8Array(await blob.arrayBuffer());
  const raw = unzipSync(u8, { filter: (f) => !SKIP.test(f.name) && !f.name.endsWith("/") });
  return new Map(Object.entries(raw));
}

const sliceRoot = (raw: Map<string, Uint8Array>, root: string): Files => {
  const files: Files = new Map();
  for (const [k, v] of raw) if (k.startsWith(root)) files.set(k.slice(root.length), v);
  return files;
};

/** Open ANY supported project ZIP: auto-detects Remotion / HyperFrames /
    OpenMontage / skill packs. `files` are paths relative to the project root. */
export async function openAny(blob: Blob): Promise<AnyOpened> {
  const raw = await unzipAll(blob);
  if (!raw.size) throw new Error("This ZIP is empty.");
  const det = detectProject(raw);
  return { files: sliceRoot(raw, det.root), det };
}

/** Remotion-only open (used by the Remotion compile/render pipeline). */
export async function openZip(blob: Blob): Promise<Opened> {
  const { files, det } = await openAny(blob);
  if (det.kind !== "remotion" || !det.pkg) {
    throw new Error(
      det.kind === "hyperframes"
        ? "This is a HyperFrames project — open it from the Library to use the HyperFrames studio."
        : "No Remotion project found in this ZIP (a package.json that depends on “remotion” is required)."
    );
  }
  const pkg = det.pkg;
  let entry = "";
  for (const s of Object.values<string>(pkg.scripts || {})) {
    const m = /remotion\s+(?:studio|render|preview|bundle|compositions|still)\s+([^\s"']+\.(?:tsx?|jsx?))/.exec(s);
    if (m && files.has(m[1].replace(/^\.\//, ""))) { entry = m[1].replace(/^\.\//, ""); break; }
  }
  if (!entry) entry = ["src/index.ts", "src/index.tsx", "src/index.js", "src/index.jsx", "index.ts", "index.tsx", "index.js", "src/entry.ts", "src/Root.tsx"].find((c) => files.has(c)) || "";
  if (!entry) throw new Error("Couldn’t find the entry file (expected src/index.ts).");
  return { files, pkg, entry, root: det.root };
}
