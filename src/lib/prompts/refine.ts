/**
 * Visual comparison: Claude sees the photo, renders of the current model from
 * the photo's angle and from the side, and the model itself, and either says
 * it matches or lists the differences and returns a corrected model. Tune freely.
 */
import type { BrickDesign } from "../design/schema";
import type { BrickModel } from "../model/schema";
import { designListing, modelListing } from "./edit";
import type { PhotoAnalysis, SizeTarget } from "./analysis";
import { DESIGN_DIFF_INSTRUCTIONS, DIFF_INSTRUCTIONS } from "../diff/diff";

function intro(a: PhotoAnalysis, target: SizeTarget, round: number, rounds: number): string {
  return `You are checking a brick model against the photo it was built from (comparison round ${round} of ${rounds}).

Images, in order: 1. the photo; 2. a render of the current model from about the photo's camera angle; 3. a render from the side.

What it should be: ${a.subject}. Target size ${target.length} studs long (z) × ${target.width} studs wide (x) × about ${target.heightPlates} plates tall; front faces +z. Key features: ${a.keyFeatures.join("; ")}.

Compare the renders with the photo. Look first at overall proportions (length vs width vs height, how low or tall it sits, where the mass is), then silhouette and slopes, then the key features and colours. Ignore the background, lighting and the photo's perspective distortion; the model is a simplified brick version, so judge whether it reads as the same object.`;
}

export function refinePrompt(a: PhotoAnalysis, target: SizeTarget, model: BrickModel, round: number, rounds: number): string {
  return `${intro(a, target, round, rounds)}

Current model (${model.parts.length} parts, bottom layer first):
${modelListing(model)}

If it already matches the photo well, return matches: true, the differences you'd still note (may be empty), and no changes.

Otherwise return matches: false, the most important differences (at most 6, most important first, each a concrete change such as "roof is 3 plates too high", "nose should taper over the front 4 studs"), and the changes that fix them. Keep parts that are already right; stay within the target size and part budget. The corrected model must still meet every physical rule. Changes: ${DIFF_INSTRUCTIONS}`;
}

export function refineDesignPrompt(a: PhotoAnalysis, target: SizeTarget, design: BrickDesign, pieces: number, round: number, rounds: number): string {
  return `${intro(a, target, round, rounds)}

Current model as sub-builds (${pieces} pieces in total; each sub-build is defined once and placed as copies, mirror: true copies are mirror images):
${designListing(design)}

If it already matches the photo well, return matches: true, the differences you'd still note (may be empty), and no changes.

Otherwise return matches: false, the most important differences (at most 6, most important first, each a concrete change), and the changes that fix them. Change a sub-build to change all its copies (mirrored ones too). Everything must still be one connected, buildable structure. Changes: ${DESIGN_DIFF_INSTRUCTIONS}`;
}

/** Output schema: matches + differences + the changes (`changes`: a model or design diff schema). */
export function refineJsonSchema(changes: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "object",
    properties: { matches: { type: "boolean" }, differences: { type: "array", items: { type: "string" } }, changes },
    required: ["matches", "differences", "changes"],
    additionalProperties: false,
  };
}
