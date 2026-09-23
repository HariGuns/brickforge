import type { BrickModel } from "@/lib/model/schema";
import type { ModelStats } from "@/lib/model/stats";

/** JSON with one placement per line, so large models stay scannable. */
export function compactJson(model: BrickModel): string {
  const parts = model.parts.map((p) => `    ${JSON.stringify(p)}`).join(",\n");
  return `{\n  "name": ${JSON.stringify(model.name)},\n  "description": ${JSON.stringify(model.description)},\n  "parts": [\n${parts}\n  ]\n}`;
}

export function DesignTab(props: { model: BrickModel; stats: ModelStats; steps: number; onDownloadJson: () => void }) {
  const { stats } = props;
  const rows: [string, string][] = [
    ["Pieces", stats.pieces.toLocaleString("en-US")],
    ["Build steps", String(props.steps)],
    ["Footprint", `${stats.width} × ${stats.depth} studs`],
    ["Height", `${stats.heightPlates} plates (${(stats.heightPlates / 3).toFixed(1)} bricks)`],
    ["Layers", String(stats.layers)],
    ["Part types", String(stats.partTypes)],
    ["Colours", String(stats.colors)],
  ];
  return (
    <div className="design">
      <pre className="json-pane" aria-label="Model JSON">{compactJson(props.model)}</pre>
      <div className="side-pane">
        <span className="section-label">Model</span>
        {rows.map(([k, v]) => (
          <div key={k} className="stat-row">
            <span>{k}</span>
            <span>{v}</span>
          </div>
        ))}
        <span className="section-label" style={{ paddingTop: 14 }}>
          Sub-builds <span className="soon">Soon</span>
        </span>
        <p className="empty-note" style={{ margin: 0 }}>Large models will be split into named sub-builds (tower, walls, roof…) with their own steps.</p>
        <button className="link-btn" style={{ paddingTop: 8 }} onClick={props.onDownloadJson}>
          Download model JSON
        </button>
      </div>
    </div>
  );
}
