import { CONFIG } from "../config";
import type { Detail } from "../detail";

export type Pipeline = "single" | "subbuilds" | "auto";
export const PIPELINES: Pipeline[] = ["single", "subbuilds", "auto"];

/** Which generator runs: "auto" picks sub-builds for High and Very high detail, single pass for Standard. */
export function resolvePipeline(requested: Pipeline | undefined, detail: Detail | undefined, isEdit = false): "single" | "subbuilds" {
  const p = requested ?? CONFIG.generator;
  if (isEdit) return "single"; // edits of flat models always use the single-pass edit path for now
  if (p === "auto") return detail === "high" || detail === "very_high" ? "subbuilds" : "single";
  return p;
}
