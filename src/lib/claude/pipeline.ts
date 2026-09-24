import { CONFIG } from "../config";
import type { BuildSize } from "../prompts/design";

export type Pipeline = "single" | "subbuilds" | "auto";
export const PIPELINES: Pipeline[] = ["single", "subbuilds", "auto"];
/** Paths that can run (all of them since phase 3). */
export const AVAILABLE_PIPELINES: Pipeline[] = ["single", "subbuilds", "auto"];

/** Which generator runs: "auto" picks sub-builds for Large builds, single pass otherwise. */
export function resolvePipeline(requested: Pipeline | undefined, size: BuildSize | undefined, isEdit = false): "single" | "subbuilds" {
  const p = requested ?? CONFIG.generator;
  if (isEdit) return "single"; // edits of flat models always use the single-pass edit path for now
  if (p === "auto") return size === "large" ? "subbuilds" : "single";
  return p;
}
