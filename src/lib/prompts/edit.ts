/** First-turn prompt for editing an existing model from chat. Tune freely. */
import type { BrickModel, Placement } from "../model/schema";
import type { BrickDesign, Instance } from "../design/schema";
import { codec, modelListing } from "../diff/format";
import { DESIGN_DIFF_INSTRUCTIONS, DIFF_INSTRUCTIONS } from "../diff/diff";

export { modelListing };

export function editPrompt(base: BrickModel, request: string, hasImage = false): string {
  return `Here is the current model.

Name: ${base.name}
Description: ${base.description}
Parts (${base.parts.length}):
${modelListing(base)}

Change request: ${request.trim() || "Adjust the model to match the attached photo more closely."}${hasImage ? "\n\nUse the attached photo as a reference for the change." : ""}

Make the change and nothing else, so the rest of the model doesn't move; only shift the whole model if the request needs it. The finished model must still meet every physical rule. ${DIFF_INSTRUCTIONS} Give a new name only if the change makes the old one wrong, and a new description (of the whole updated model) if it changes.`;
}

/** The design as compact text: each sub-build once (parts and copies it contains), then the main build. */
export function designListing(d: BrickDesign): string {
  const c = codec();
  const block = (parts: Placement[], uses: Instance[]) =>
    [
      ...parts.map((p, i) => `  #${i} ${c.formatPlacement(p)}`),
      ...uses.map((u, i) => `  copy ${i}: ${c.formatInstance(u)}`),
      ...(uses.some((u) => u.mount) ? ["  (A mount's part number refers to this listing too; it's renumbered for you when parts are removed. A part you add is numbered after the last one, in the order you add it.)"] : []),
    ].join("\n");
  return [
    ...d.subBuilds.map((s) => `Sub-build ${s.id} "${s.name}" (${s.parts.length} parts${s.uses.length ? `, ${s.uses.length} copies inside` : ""}):\n${block(s.parts, s.uses)}`),
    `Main build (${d.main.parts.length} parts, ${d.main.uses.length} copies):\n${block(d.main.parts, d.main.uses)}`,
  ].join("\n\n");
}

export function designEditPrompt(base: BrickDesign, request: string, hasImage = false): string {
  return `Here is the current model, described as sub-builds (each defined once in its own frame and placed as copies) plus the main build.

Name: ${base.name}
Description: ${base.description}

${designListing(base)}

Change request: ${request.trim() || "Adjust the model to match the attached photo more closely."}${hasImage ? "\n\nUse the attached photo as a reference for the change." : ""}

${DESIGN_DIFF_INSTRUCTIONS}
- To change something that repeats (every tree, every tower…), change its sub-build once; all copies follow, including mirrored ones (mirror: true), which show the change mirrored.
- To change one copy only, give it its own new sub-build, or change the main build around it.
- Keep ids, parts and copies that the change doesn't touch exactly as they are.
- A sub-build keeps its lowest parts at y = 0 and its min corner at x = z = 0. If a sub-build's footprint or height changes, check its copies still sit on studs and don't overlap anything.
- Everything must still be one connected, buildable structure (the compiler checks joins, overlaps and structure).`;
}
