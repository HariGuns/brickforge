/** First-turn prompt for editing an existing model from chat. Tune freely. */
import type { BrickModel } from "../model/schema";

/** One placement per line, numbered, so Claude can refer to and copy parts exactly. */
export function modelListing(model: BrickModel): string {
  return model.parts.map((p, i) => `#${i} ${JSON.stringify(p)}`).join("\n");
}

export function editPrompt(base: BrickModel, request: string, hasImage = false): string {
  return `Here is the current model.

Name: ${base.name}
Description: ${base.description}
Parts (${base.parts.length}):
${modelListing(base)}

Change request: ${request.trim() || "Adjust the model to match the attached photo more closely."}${hasImage ? "\n\nUse the attached photo as a reference for the change." : ""}

Return the complete updated model (every part, not just the changed ones). Keep every part that the change doesn't touch exactly as it is — same part, color, x, y, z and rot — so the rest of the model doesn't move. Only shift the whole model if the request needs it. The finished model must still meet every physical rule. Keep the name unless the change makes it wrong, and write the description for the updated model as a whole.`;
}
