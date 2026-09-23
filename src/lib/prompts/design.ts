/** First-turn user prompts. Tune freely. */

export type BuildSize = "small" | "medium" | "large";

/** Target scale per size choice; appended to the first-turn prompt. */
const SIZE_HINTS: Record<BuildSize, string> = {
  small: "Size: small — about 30–80 parts, at most ~12 studs in the largest horizontal dimension.",
  medium: "Size: medium — about 60–160 parts, roughly 12–20 studs in the largest horizontal dimension.",
  large: "Size: large — about 150–300 parts, roughly 20–32 studs in the largest horizontal dimension, with more detail.",
};

function sizeLine(size?: BuildSize): string {
  return size ? `\n\n${SIZE_HINTS[size]}` : "";
}

export function textDesignPrompt(description: string, size?: BuildSize): string {
  return `Design a buildable brick model of: ${description.trim()}

Capture the subject's characteristic silhouette, proportions and colors at a buildable scale.${sizeLine(size)}`;
}

export function photoDesignPrompt(extra?: string, size?: BuildSize): string {
  return `Design a buildable brick model of the main subject in this photo.

Identify the subject, its overall shape, proportions and main colors, then build a simplified but recognizable version of it. Ignore the background.${
    extra?.trim() ? `\n\nAdditional instructions: ${extra.trim()}` : ""
  }${sizeLine(size)}`;
}
