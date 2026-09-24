/**
 * Visual comparison: Claude sees the photo, renders of the current model from
 * the photo's angle and from the side, and the model itself, and either says
 * it matches or lists the differences and returns a corrected model. Tune freely.
 */
import type { BrickDesign } from "../design/schema";
import type { BrickModel } from "../model/schema";
import { designListing } from "./edit";
import type { PhotoAnalysis, SizeTarget } from "./analysis";

const listing = (m: BrickModel) => m.parts.map((p, i) => `  #${i} ${JSON.stringify(p)}`).join("\n");

function intro(a: PhotoAnalysis, target: SizeTarget, round: number, rounds: number): string {
  return `You are checking a brick model against the photo it was built from (comparison round ${round} of ${rounds}).

Images, in order: 1. the photo; 2. a render of the current model from about the photo's camera angle; 3. a render from the side.

What it should be: ${a.subject}. Target size ${target.length} studs long (z) × ${target.width} studs wide (x) × about ${target.heightPlates} plates tall; front faces +z. Key features: ${a.keyFeatures.join("; ")}.

Compare the renders with the photo. Look first at overall proportions (length vs width vs height, how low or tall it sits, where the mass is), then silhouette and slopes, then the key features and colours. Ignore the background, lighting and the photo's perspective distortion; the model is a simplified brick version, so judge whether it reads as the same object.`;
}

export function refinePrompt(a: PhotoAnalysis, target: SizeTarget, model: BrickModel, round: number, rounds: number): string {
  return `${intro(a, target, round, rounds)}

Current model (${model.parts.length} parts, bottom layer first):
${listing(model)}

If it already matches the photo well, return matches: true, the differences you'd still note (may be empty), and an empty parts list (name and description can stay as they are).

Otherwise return matches: false, the most important differences (at most 6, most important first, each a concrete change such as "roof is 3 plates too high", "nose should taper over the front 4 studs"), and the complete corrected model with every part. Fix the listed differences; keep parts that are already right exactly as they are; keep it within the target size and part budget. The corrected model must still meet every physical rule.`;
}

export function refineDesignPrompt(a: PhotoAnalysis, target: SizeTarget, design: BrickDesign, pieces: number, round: number, rounds: number): string {
  return `${intro(a, target, round, rounds)}

Current model as sub-builds (${pieces} pieces in total; each sub-build is defined once and placed as copies, mirror: true copies are mirror images):
${designListing(design)}

If it already matches the photo well, return matches: true, the differences you'd still note (may be empty), and an empty design (no sub-builds, an empty main build).

Otherwise return matches: false, the most important differences (at most 6, most important first, each a concrete change), and the complete corrected design. Change a sub-build to change all its copies; keep ids, parts and copies that are already right exactly as they are. Everything must still be one connected, buildable structure.`;
}

/** Output schema: matches + differences + the corrected model (or design); `inner` is the model/design schema. */
export function refineJsonSchema(key: "model" | "design", inner: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "object",
    properties: { matches: { type: "boolean" }, differences: { type: "array", items: { type: "string" } }, [key]: inner },
    required: ["matches", "differences", key],
    additionalProperties: false,
  };
}
