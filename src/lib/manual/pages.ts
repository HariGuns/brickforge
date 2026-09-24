import { getPart } from "../parts/library";
import { countParts, type PartCount } from "../model/stats";
import type { BrickModel } from "../model/schema";
import type { BuildStep } from "../steps/steps";
import type { CopyItem, DesignStep, StepSection } from "../design/steps";

export interface CalloutItem extends PartCount {
  /** Short size label for the callout, e.g. "2×4", "1×2 plate", "2×2 slope". */
  size: string;
}

export interface ManualPage {
  /** 1-based page number across the whole manual (= step number). */
  n: number;
  /** Index into the sections list. */
  section: number;
  /** Step number within its section (1-based) and the section's step count. */
  local: number;
  localTotal: number;
  /** "Sub-build · Pine tree ×4", or null for the main build of a model without sub-builds. */
  label: string | null;
  step: DesignStep;
  pieces: number;
  callout: CalloutItem[];
  copies: CopyItem[];
  /** Layer of this step within its section (1-based) and the section's layer count. */
  layer: number;
  layers: number;
}

/** "2×4" for bricks; other categories get a suffix so a 2×4 plate and a 2×4 brick read differently. */
export function sizeLabel(partId: string): string {
  const def = getPart(partId);
  if (!def) return partId;
  const dims = `${Math.min(def.w, def.d)}×${Math.max(def.w, def.d)}`;
  const tall = `${dims}×${def.h / 3}`;
  switch (def.category) {
    case "brick":
      return dims;
    case "slope":
      return `${def.d}×${def.w} ${def.shape === "ridge" ? "ridge" : "slope"}`;
    case "window":
    case "door":
      return `${tall} ${def.category}`;
    case "fence":
    case "cone":
      return def.h > 3 ? `${tall} ${def.category}` : `${dims} ${def.category}`;
    default:
      return `${dims} ${def.category}`;
  }
}

/** A flat model as one main-build section (no sub-builds). */
export function flatSection(model: BrickModel, steps: BuildStep[]): StepSection {
  return { sub: null, name: model.name, copies: 1, model, steps: steps.map((s) => ({ ...s, ownParts: s.parts, copies: [] })) };
}

export function sectionLabel(s: StepSection, hasSubBuilds: boolean): string | null {
  if (s.sub) return `Sub-build · ${s.name}${s.copies > 1 ? ` ×${s.copies}` : ""}`;
  return hasSubBuilds ? "Main build" : null;
}

/** One instruction page per step, sub-builds first, then the main build. */
export function manualPages(sections: StepSection[]): ManualPage[] {
  const hasSubs = sections.some((s) => s.sub);
  const pages: ManualPage[] = [];
  sections.forEach((sec, si) => {
    const layerYs = [...new Set(sec.steps.map((s) => s.y))];
    sec.steps.forEach((step, k) => {
      pages.push({
        n: pages.length + 1,
        section: si,
        local: k + 1,
        localTotal: sec.steps.length,
        label: sectionLabel(sec, hasSubs),
        step,
        pieces: step.parts.length,
        callout: countParts(sec.model, step.ownParts).map((c) => ({ ...c, size: sizeLabel(c.part) })),
        copies: step.copies,
        layer: layerYs.indexOf(step.y) + 1,
        layers: layerYs.length,
      });
    });
  });
  return pages;
}
