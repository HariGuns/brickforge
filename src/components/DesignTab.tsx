"use client";

import type { BrickModel } from "@/lib/model/schema";
import type { ModelStats } from "@/lib/model/stats";
import type { BrickDesign } from "@/lib/design/schema";
import type { CompileResult, TreeNode } from "@/lib/design/compile";
import * as I from "./icons";

/** JSON with one placement per line, so large models stay scannable. */
export function compactJson(model: BrickModel): string {
  const parts = model.parts.map((p) => `    ${JSON.stringify(p)}`).join(",\n");
  return `{\n  "name": ${JSON.stringify(model.name)},\n  "description": ${JSON.stringify(model.description)},\n  "parts": [\n${parts}\n  ]\n}`;
}

/** A design as JSON, one placement or copy per line. */
export function designJson(d: BrickDesign): string {
  const lines = (items: unknown[], indent: string) => items.map((x) => `${indent}${JSON.stringify(x)}`).join(",\n");
  const block = (parts: unknown[], uses: unknown[], indent: string) =>
    `${indent}"parts": [\n${lines(parts, indent + "  ")}\n${indent}],\n${indent}"uses": [${uses.length ? `\n${lines(uses, indent + "  ")}\n${indent}` : ""}]`;
  const subs = d.subBuilds.map((s) => `    {\n      "id": ${JSON.stringify(s.id)},\n      "name": ${JSON.stringify(s.name)},\n${block(s.parts, s.uses, "      ")}\n    }`).join(",\n");
  return `{\n  "name": ${JSON.stringify(d.name)},\n  "description": ${JSON.stringify(d.description)},\n  "subBuilds": [\n${subs}\n  ],\n  "main": {\n${block(d.main.parts, d.main.uses, "    ")}\n  }\n}`;
}

function Tree({ node, depth, compiled, onPick }: { node: TreeNode; depth: number; compiled: CompileResult; onPick: (sub: string | null) => void }) {
  const info = node.sub ? compiled.subBuilds.find((s) => s.id === node.sub) : null;
  return (
    <>
      <button className="tree-row" style={{ paddingLeft: 8 + depth * 16 }} onClick={() => onPick(node.sub)} title={node.sub ? `Highlight all ${info?.copies ?? 0} copies in the 3D view` : "Show the whole model"}>
        <span className="tree-name">
          {node.sub ? <I.Bricks size={13} /> : <I.Cube size={13} />}
          {node.name}
          {node.sub && node.count > 1 && <span className="tree-count">×{node.count}</span>}
        </span>
        <span className="muted">
          {node.sub ? `${node.parts} parts${info && info.copies !== node.count ? ` · ${info.copies} in model` : ""}` : `${node.parts} parts`}
        </span>
      </button>
      {node.children.map((c) => (
        <Tree key={c.sub} node={c} depth={depth + 1} compiled={compiled} onPick={onPick} />
      ))}
    </>
  );
}

export function DesignTab(props: {
  model: BrickModel;
  design: BrickDesign | null;
  compiled: CompileResult;
  stats: ModelStats;
  steps: number;
  onDownloadJson: () => void;
  onHighlight: (parts: Set<number> | undefined) => void;
}) {
  const { stats, compiled } = props;
  const c = compiled.stats;
  const fmt = (n: number) => n.toLocaleString("en-US");
  const rows: [string, string][] = [
    ["Pieces", fmt(c.pieces)],
    ["Steps", fmt(props.steps)],
    ["Pages", fmt(props.steps)],
    ["Compile time", `${c.compileMs} ms`],
    ["Errors", fmt(c.errors)],
    ["Warnings", fmt(c.warnings)],
    ["Size", `${c.sizeCm.w} × ${c.sizeCm.d} × ${c.sizeCm.h} cm`],
    ["Footprint", `${stats.width} × ${stats.depth} studs, ${stats.heightPlates} plates tall`],
    ...(props.design ? ([["Sub-builds", `${c.uniqueSubBuilds} unique, ${c.copies} copies`]] as [string, string][]) : []),
    ["Part types", String(stats.partTypes)],
    ["Colours", String(stats.colors)],
  ];
  const pick = (sub: string | null) => {
    if (!sub) return props.onHighlight(undefined);
    props.onHighlight(new Set(compiled.instances.filter((i) => i.sub === sub).flatMap((i) => i.parts)));
  };

  return (
    <div className="design">
      <pre className="json-pane" aria-label="Design JSON">{props.design ? designJson(props.design) : compactJson(props.model)}</pre>
      <div className="side-pane">
        <span className="section-label">Stats</span>
        {rows.map(([k, v]) => (
          <div key={k} className={`stat-row ${k === "Errors" && c.errors ? "bad" : ""}`}>
            <span>{k}</span>
            <span>{v}</span>
          </div>
        ))}
        <span className="section-label" style={{ paddingTop: 14 }}>
          {props.design ? `Sub-builds · ${c.uniqueSubBuilds}` : "Sub-builds"}
        </span>
        {props.design ? (
          <div className="tree" role="tree">
            <Tree node={compiled.tree} depth={0} compiled={compiled} onPick={pick} />
          </div>
        ) : (
          <p className="empty-note" style={{ margin: 0 }}>
            This model was built in a single pass, so it has no sub-builds. Choose Sub-builds (or Auto for Large) in the chat to build large models from repeated pieces.
          </p>
        )}
        <button className="link-btn" style={{ paddingTop: 8 }} onClick={props.onDownloadJson}>
          Download {props.design ? "design" : "model"} JSON
        </button>
      </div>
    </div>
  );
}
