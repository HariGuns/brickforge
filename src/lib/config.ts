/**
 * Where runs, builds and exports are stored: the working directory by default
 * (development and the launcher), or BRICKFORGE_DATA_DIR (the desktop app sets
 * it to its user data folder, ~/.config/BrickForge).
 */
const DATA = process.env.BRICKFORGE_DATA_DIR ? `${process.env.BRICKFORGE_DATA_DIR.replace(/\/+$/, "")}/` : "";

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
  generator: "auto" as "single" | "subbuilds" | "auto",
  /**
   * Detail setting: target width of the subject in studs (its side-to-side
   * size) and the part budget. Photos of vehicles are never narrower than
   * vehicleMinWidth. Auto uses the sub-build generator for High and Very high.
   */
  detail: {
    standard: { width: 10, parts: 300 },
    high: { width: 16, parts: 700 },
    very_high: { width: 22, parts: 1500 },
    vehicleMinWidth: 14,
  },
  /** Effort for the photo analysis call (a short structured description). */
  analysisEffort: "medium" as const,
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
  debugDir: `${DATA}debug`,
  /** Saved builds (one JSON file per build, all versions). */
  buildsDir: `${DATA}builds`,
  /** .ldr/.mpd files shown in the Library. */
  exportsDir: `${DATA}exports`,
};
