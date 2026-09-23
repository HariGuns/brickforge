import { getPart } from "../parts/library";
import { countParts, type PartCount } from "../model/stats";
import type { BrickModel } from "../model/schema";
import type { BuildStep } from "../steps/steps";

export interface CalloutItem extends PartCount {
  /** Short size label for the callout, e.g. "2×4", "1×2 plate", "2×2 slope". */
  size: string;
}

export interface ManualPage {
  /** 1-based page number (= step number). */
  n: number;
  step: BuildStep;
  pieces: number;
  callout: CalloutItem[];
  /** Layer of this step among all layers (1-based) and the layer count. */
  layer: number;
  layers: number;
}

/** "2×4" for bricks; other categories get a suffix so a 2×4 plate and a 2×4 brick read differently. */
export function sizeLabel(partId: string): string {
  const def = getPart(partId);
  if (!def) return partId;
  const dims = `${Math.min(def.w, def.d)}×${Math.max(def.w, def.d)}`;
  if (def.category === "brick") return dims;
  if (def.category === "slope") return `${def.d}×${def.w} slope`;
  return `${dims} ${def.category}`;
}

/** One instruction page per build step. */
export function manualPages(model: BrickModel, steps: BuildStep[]): ManualPage[] {
  const layerYs = [...new Set(steps.map((s) => s.y))];
  return steps.map((step) => ({
    n: step.n,
    step,
    pieces: step.parts.length,
    callout: countParts(model, step.parts).map((c) => ({ ...c, size: sizeLabel(c.part) })),
    layer: layerYs.indexOf(step.y) + 1,
    layers: layerYs.length,
  }));
}
