/* Auto-detection: what kind of project lives inside an uploaded ZIP?
   Covers every tool from the "Top 5 AI motion graphics repos" reel:
   Remotion, HyperFrames, OpenMontage, skill packs (Motion Design Skills,
   Anything-to-Explainer — those two are agent skill packs; videos made
   *with* them come out as Remotion or HyperFrames projects and are
   detected as such). */

export type RawFiles = Map<string, Uint8Array>;
export type DetKind = "remotion" | "hyperframes" | "openmontage" | "skills" | "unknown";

export type Detection = {
  kind: DetKind;
  root: string; // path prefix inside the ZIP ("" or "folder/")
  label: string; // short badge text, e.g. "HyperFrames"
  detail: string; // one-line human explanation of the evidence found
  pkg?: any; // remotion: parsed package.json
  indexPath?: string; // hyperframes: root-relative path of index.html
  width?: number;
  height?: number;
  duration?: number;
  skillNames?: string[]; // skills: names found
};

const dec = new TextDecoder();
const text = (raw: RawFiles, path: string) => {
  const b = raw.get(path);
  return b ? dec.decode(b) : "";
};
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");
/** If every file shares one top-level folder, return it ("name/"), else "". */
const commonTop = (raw: RawFiles) => {
  const keys = [...raw.keys()];
  if (!keys.length) return "";
  const first = keys[0].split("/")[0];
  return first && keys.every((k) => k.startsWith(first + "/")) ? first + "/" : "";
};
const shallowest = (paths: string[]) => [...paths].sort((a, b) => a.split("/").length - b.split("/").length || a.length - b.length);

export function detectProject(raw: RawFiles): Detection {
  const keys = [...raw.keys()];

  /* 1 — Remotion: a package.json that depends on remotion */
  const pkgPaths = shallowest(keys.filter((k) => k.endsWith("package.json")));
  for (const p of pkgPaths) {
    try {
      const pkg = JSON.parse(text(raw, p));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.remotion || deps["@remotion/cli"]) {
        return { kind: "remotion", root: dirOf(p), label: "Remotion", detail: "package.json depends on remotion", pkg };
      }
    } catch {}
  }

  /* 2 — HyperFrames: an index.html hosting compositions */
  const htmlPaths = shallowest(keys.filter((k) => k.toLowerCase().endsWith("index.html")));
  for (const p of htmlPaths) {
    const html = text(raw, p);
    const isHF = html.includes("data-composition-id") && (html.includes("data-composition-src") || html.includes("__timelines"));
    if (!isHF) continue;
    const root = dirOf(p);
    const rootTag = /<[a-z]+[^>]*data-composition-id="main"[^>]*>/i.exec(html)?.[0]
      || /<[a-z]+[^>]*id="root"[^>]*>/i.exec(html)?.[0] || "";
    const num = (name: string) => {
      const m = new RegExp(`data-${name}="([0-9.]+)"`).exec(rootTag);
      return m ? parseFloat(m[1]) : undefined;
    };
    return {
      kind: "hyperframes", root, label: "HyperFrames",
      detail: "index.html hosts timed compositions (data-composition-src)",
      indexPath: p.slice(root.length),
      width: num("width"), height: num("height"), duration: num("duration"),
    };
  }

  /* 3 — OpenMontage: the agent video-production system itself */
  const omPath = keys.find((k) => /openmontage/i.test(k));
  const guide = keys.find((k) => /(^|\/)AGENT_GUIDE\.md$/i.test(k));
  const readme = shallowest(keys.filter((k) => /(^|\/)README\.md$/i.test(k)))[0];
  if (omPath || (guide && /open\s?montage/i.test(text(raw, guide))) || (readme && /open\s?montage/i.test(text(raw, readme)))) {
    return { kind: "openmontage", root: commonTop(raw), label: "OpenMontage", detail: "OpenMontage agent pipeline files found" };
  }

  /* 4 — Skill pack: one or more SKILL.md files (Motion Design Skills, Anything-to-Explainer, …) */
  const skillFiles = keys.filter((k) => /(^|\/)SKILL\.md$/i.test(k));
  if (skillFiles.length) {
    const names = skillFiles.map((k) => {
      const head = /^#\s+(.+)$/m.exec(text(raw, k))?.[1]?.trim();
      const folder = k.split("/").slice(-2, -1)[0];
      return head || folder || "skill";
    });
    return { kind: "skills", root: commonTop(raw), label: "Skill pack", detail: `${skillFiles.length} SKILL.md file(s) found`, skillNames: names.slice(0, 12) };
  }

  return { kind: "unknown", root: "", label: "Unknown", detail: "No known project markers found" };
}
