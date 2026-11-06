import { useEffect, useState } from "react";
import { getProject, type ProjectRec } from "../lib/db";
import { openAny, type Files } from "../lib/zip";
import type { Detection } from "../lib/detect";
import { fmtB } from "../lib/util";

type St =
  | { status: "loading" }
  | { status: "error"; err: string }
  | { status: "ready"; files: Files; rec: ProjectRec; det: Detection };

const COPY: Record<string, { title: string; body: string[] }> = {
  openmontage: {
    title: "This is OpenMontage — an AI video-making system",
    body: [
      "OpenMontage isn’t a video project file. It’s a toolbox that an AI agent (like Muse) runs on your computer: you give it a topic, and it researches, writes the script, generates the voice and edits the finished video for you.",
      "Because of that, this studio can’t render it in the browser — there is nothing to “play” here yet.",
      "What to do: unzip it on your computer, open the folder with your AI coding assistant and follow its AGENT_GUIDE.md. When OpenMontage (or you) exports a finished Remotion or HyperFrames project ZIP, drop that ZIP here — it will be detected and opened automatically.",
    ],
  },
  skills: {
    title: "This is a skill pack for AI agents",
    body: [
      "A skill pack is a set of instruction files (SKILL.md) that teach an AI assistant new abilities — for example, the Motion Design Skills pack teaches an agent timing, easing, typography and color, so the videos it makes look professional instead of cheap.",
      "There is no video inside to render. Skills are “read” by the AI, not played.",
      "What to do: give this folder to your AI assistant as a skill (in Muse these live under ~/.agents/skills). Videos the agent then creates with Remotion or HyperFrames can be dropped here as ZIPs and will open automatically.",
    ],
  },
  unknown: {
    title: "We couldn’t recognize this ZIP",
    body: [
      "This studio auto-detects: Remotion projects (package.json depending on remotion), HyperFrames projects (index.html with data-composition-src), OpenMontage, and skill packs (SKILL.md files).",
      "None of those markers were found in this ZIP. If it is a video project made with a different tool, it can’t be opened here yet — but if it was exported as a Remotion or HyperFrames project, make sure the ZIP contains the project’s index.html / package.json near its top level.",
    ],
  },
};

export function InfoView({ id }: { id: string; tab: string; setTab: (t: string) => void; onChanged: () => void; toast: (m: string) => void }) {
  const [st, setSt] = useState<St>({ status: "loading" });
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const rec = await getProject(id);
        if (!rec) throw new Error("Project not found.");
        const o = await openAny(rec.zip);
        if (!dead) setSt({ status: "ready", files: o.files, rec, det: o.det });
      } catch (e: any) {
        if (!dead) setSt({ status: "error", err: String(e.message || e) });
      }
    })();
    return () => { dead = true; };
  }, [id]);

  if (st.status === "loading") return <div className="center" style={{ flex: 1 }}><div className="spin lg" /><p>Unpacking ZIP…</p></div>;
  if (st.status === "error") return <div className="card errcard"><h3>Couldn’t open this project</h3><pre>{st.err}</pre></div>;

  const copy = COPY[st.det.kind] || COPY.unknown;
  const bytes = Array.from(st.files.values()).reduce((a, b) => a + b.length, 0);
  return (
    <div>
      <div className="phead"><div><h1>{st.rec.name}</h1><p className="mt"><span className="badge kind">{st.det.label}</span> · {st.det.detail} · {st.files.size} files · {fmtB(bytes)} unpacked</p></div></div>
      <div className="card" style={{ maxWidth: 820 }}>
        <h3>{copy.title}</h3>
        {copy.body.map((p, i) => <p key={i} className="mt" style={{ marginTop: 10, lineHeight: 1.55 }}>{p}</p>)}
        {st.det.skillNames && st.det.skillNames.length > 0 && (
          <><div className="sechead" style={{ margin: "20px 0 8px" }}><h2 style={{ fontSize: 14 }}>Skills inside</h2></div>
            <div className="comps">{st.det.skillNames.map((n) => <div key={n} className="comp"><b>{n}</b></div>)}</div></>
        )}
      </div>
      <div className="card" style={{ maxWidth: 820, marginTop: 16 }}><h3>Files</h3><div className="flist">{Array.from(st.files.entries()).sort().slice(0, 200).map(([k, v]) => <div key={k}><span>{k}</span><small>{fmtB(v.length)}</small></div>)}</div></div>
    </div>
  );
}
