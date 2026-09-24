/** Tunable limits and generation settings. */
export const CONFIG = {
  /** Build area in studs (x, z) and max height in plates (y). */
  grid: { x: 48, z: 48, y: 96 },
  maxParts: 300,
  /** Limits for compiled designs (sub-builds). Each sub-build still has to fit `maxParts`. */
  design: { grid: { x: 128, z: 128, y: 256 }, maxParts: 5000, maxDepth: 4 },
  /**
   * Generator path: "single" = one design call + repair (current), "subbuilds" =
   * plan → sub-builds → assembly, "auto" = sub-builds for Large, single otherwise.
   */
  generator: "single" as "single" | "subbuilds" | "auto",
  /** Sub-build generator limits: unique sub-builds, total copies, envelope size (studs), parts per copy, parallel calls. */
  subbuilds: { maxUnique: 8, maxCopies: 64, maxEnvelope: 32, maxSubParts: 250, planRepairRounds: 2, concurrency: 4 },
  /**
   * Structural estimate (see validate/structure.ts). Mass: grams per 1 stud × 1 stud
   * × 1 plate of part volume (a 2×4 brick ≈ 2.3 g); slopes are ~75% solid.
   * Limits: a single-stud joint may carry at most this stack height / weight, and
   * the leverage of an overhang is limited per supporting stud (gram·studs).
   */
  structure: { gramsPerUnit: 0.0967, slopeFactor: 0.75, maxStackPlatesOnOneStud: 12, maxLoadOnOneStudG: 5, maxMomentPerStud: 6 },
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
