/** First-turn user prompts. Tune freely. */
import { CONFIG } from "../config";
import { detailTarget, type Detail } from "../detail";

/** Target scale per Detail level for a text request (a photo gets exact numbers from the analysis). */
function detailLine(detail: Detail | undefined): string {
  const t = detailTarget(detail);
  const parts = Math.min(t.parts, CONFIG.maxParts);
  return `\n\nDetail: ${detail === "very_high" ? "very high" : (detail ?? "standard")} — the subject about ${t.width} studs wide (side to side), in its real proportions, and at most ${parts} parts${t.parts > CONFIG.maxParts ? ` (the single-pass limit; use fewer, larger parts where they don't hurt the shape)` : ""}. Vehicles: at least ${CONFIG.detail.vehicleMinWidth} studs wide. Orient the model with its front facing +z (toward the viewer).`;
}

export function textDesignPrompt(description: string, detail?: Detail): string {
  return `Design a buildable brick model of: ${description.trim()}

Capture the subject's characteristic silhouette, proportions and colors at a buildable scale.${detailLine(detail)}`;
}

/** `analysis`: the photo-analysis block (analysisBlock), which carries the exact target size. */
export function photoDesignPrompt(extra?: string, detail?: Detail, analysis?: string): string {
  return `Design a buildable brick model of the main subject in this photo.

${
    analysis
      ? `${analysis}

Build a simplified but recognisable version at exactly this scale. Get the proportions and the key features right first (in the order listed); then add detail within the part budget. Ignore the background.`
      : "Identify the subject, its overall shape, proportions and main colors, then build a simplified but recognizable version of it. Ignore the background."
  }${extra?.trim() ? `\n\nAdditional instructions: ${extra.trim()}` : ""}${analysis ? "" : detailLine(detail)}`;
}
