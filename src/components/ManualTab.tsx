"use client";

import { useEffect, useMemo } from "react";
import type { BrickModel } from "@/lib/model/schema";
import type { BuildStep } from "@/lib/steps/steps";
import { countParts } from "@/lib/model/stats";
import { Viewer } from "./ViewerLazy";
import * as I from "./icons";

export function ManualTab(props: {
  model: BrickModel;
  modelKey: string;
  steps: BuildStep[];
  step: number;
  onStep: (n: number) => void;
  theme: "light" | "dark";
}) {
  const { model, steps, onStep } = props;
  const n = Math.min(Math.max(1, props.step), steps.length);
  const current = steps[n - 1];
  const visible = useMemo(() => new Set(steps.slice(0, n).flatMap((s) => s.parts)), [steps, n]);
  const highlight = useMemo(() => new Set(current?.parts ?? []), [current]);
  const rows = current ? countParts(model, current.parts) : [];
  const layers = useMemo(() => [...new Set(steps.map((s) => s.y))], [steps]);
  const layer = current ? layers.indexOf(current.y) + 1 : 0;

  // ← / → step through the manual.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("textarea, input")) return;
      if (e.key === "ArrowRight") onStep(Math.min(steps.length, n + 1));
      if (e.key === "ArrowLeft") onStep(Math.max(1, n - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [n, steps.length, onStep]);

  if (!current) return <div className="stage-panel"><div className="stage-empty"><b>No steps</b></div></div>;

  return (
    <div className="manual">
      <div className="stage-panel">
        <div className="canvas-host">
          <Viewer model={model} visible={visible} highlight={highlight} fitKey={props.modelKey} theme={props.theme} />
        </div>
        <span className="pill" title="Parts in a step share the same layer height">
          Layer {layer} of {layers.length} · {current.y === 0 ? "on the ground" : `${current.y} plate${current.y === 1 ? "" : "s"} up`}
        </span>
      </div>
      <div className="manual-side">
        <div className="step-card">
          <div className="step-head">
            <b>Step {n}</b>
            <span className="muted">of {steps.length}</span>
          </div>
          <div className="progress" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={n}>
            <div style={{ width: `${(n / steps.length) * 100}%` }} />
          </div>
          <div className="step-nav">
            <button className="btn-outline" onClick={() => onStep(n - 1)} disabled={n <= 1}>
              <I.ChevronLeft size={15} />
              Previous
            </button>
            <button className="btn-next" onClick={() => onStep(n + 1)} disabled={n >= steps.length}>
              Next
              <I.ChevronRight size={15} />
            </button>
          </div>
        </div>
        <div className="step-parts">
          <span className="section-label">Add in this step · {current.parts.length} piece{current.parts.length === 1 ? "" : "s"}</span>
          {rows.map((r) => (
            <div key={`${r.part}|${r.color}`} className="part-row">
              <span className="swatch-lg" style={{ background: r.hex }} />
              <span className="pr-text">
                <b>{r.name}</b>
                <span>{r.colorName}</span>
              </span>
              <span className="qty">×{r.qty}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
