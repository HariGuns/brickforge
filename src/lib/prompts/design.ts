/** First-turn user prompts. Tune freely. */

export function textDesignPrompt(description: string): string {
  return `Design a buildable brick model of: ${description.trim()}

Capture the subject's characteristic silhouette, proportions and colors at a buildable scale.`;
}

export function photoDesignPrompt(extra?: string): string {
  return `Design a buildable brick model of the main subject in this photo.

Identify the subject, its overall shape, proportions and main colors, then build a simplified but recognizable version of it. Ignore the background.${
    extra?.trim() ? `\n\nAdditional instructions: ${extra.trim()}` : ""
  }`;
}
