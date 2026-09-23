/** Tunable limits and generation settings. */
export const CONFIG = {
  /** Build area in studs (x, z) and max height in plates (y). */
  grid: { x: 48, z: 48, y: 96 },
  maxParts: 300,
  /** Repair rounds after the initial generation. */
  maxRepairRounds: 4,
  model: "claude-opus-5-5",
  effort: "high" as const,
  maxTokens: 64000,
  /** USD per million tokens for cost estimates (claude-opus-5-5). */
  pricing: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  debugDir: "debug",
  /** Saved builds (one JSON file per build, all versions). */
  buildsDir: "builds",
};
