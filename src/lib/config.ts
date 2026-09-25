/**
 * Where runs, builds and exports are stored: the working directory by default
 * (development and the launcher), or BRICKFORGE_DATA_DIR (the desktop app sets
 * it to its user data folder, ~/.config/BrickForge).
 */
const DATA = process.env.BRICKFORGE_DATA_DIR ? `${process.env.BRICKFORGE_DATA_DIR.replace(/\/+$/, "")}/` : "";

export type Effort = "low" | "medium" | "high";
/** Generation stages that call Claude (see CONFIG.stages). */
export type Stage = "analysis" | "plan" | "design" | "subBuild" | "assembly" | "edit" | "refine" | "repair";
export interface StageSetting {
  model?: string;
  effort?: Effort;
}
export interface Pricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

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
  /**
   * Photo builds: compare renders with the photo and refine, up to `rounds`
   * times (0 = off); each refined model gets up to `repairRounds` repairs.
   * Renders are width × height px.
   */
  refine: { rounds: 2, repairRounds: 2, width: 768, height: 512 },
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
  /**
   * Sideways building (studs on sides, sideways sub-build copies). On by default;
   * NEXT_PUBLIC_BRICKFORGE_SIDEWAYS=0 turns it off (read at startup; baked into the
   * client at build time). Off: side-stud parts aren't loaded, sideways copies can't
   * be made and the prompts are as before.
   */
  sideways: { enabled: process.env.NEXT_PUBLIC_BRICKFORGE_SIDEWAYS !== "0" },
  /**
   * How parts and copies are written in Claude's answers and in listings:
   * "compact" strings ("brick_2x4 red 3 0 5 90") or "json" objects.
   */
  outputFormat: "compact" as "compact" | "json",
  /**
   * Keep Claude's earlier thinking in the conversation for repair rounds. Off:
   * the repair sees the answer (listed with indices) and the errors, and the
   * earlier thinking isn't re-sent (it's billed as input, and cache-written,
   * every round).
   */
  keepThinkingInRepairs: false,
  /** Default model and effort; each stage can override them (see `stages`). */
  model: "claude-opus-5-5",
  effort: "high" as Effort,
  /**
   * Model and effort per stage. `repair` applies to every repair round (after
   * the first answer) of the design stages; each stage's first answer uses its
   * own entry. Leave a field out to use the default above. The model must
   * support adaptive thinking and the effort setting.
   */
  stages: {
    analysis: { effort: "medium" },
    plan: {},
    design: {},
    // Medium matched high on the Huracán sub-builds (same plan) for 33% less.
    subBuild: { effort: "medium" },
    assembly: {},
    edit: {},
    refine: {},
    repair: { effort: "medium" },
  } as Record<Stage, StageSetting>,
  maxTokens: 64000,
  /**
   * USD per million tokens, per model, for cost estimates (cacheWrite = 5-minute
   * cache writes). From platform.claude.com/docs/en/about-claude/pricing,
   * checked 2026-09-24 (Opus 5.5 cache reads are 0.05× input; Sonnet 5's
   * $2/$10 launch price is now its standard price).
   */
  pricing: {
    "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
    "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
    "claude-haiku-4-5-20251001": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  } as Record<string, Pricing>,
  debugDir: `${DATA}debug`,
  /** Saved builds (one JSON file per build, all versions). */
  buildsDir: `${DATA}builds`,
  /** .ldr/.mpd files shown in the Library. */
  exportsDir: `${DATA}exports`,
};

/** Model and effort for a stage's round (round 0 = its first answer; later rounds are repairs). */
export function stageSetting(stage: Stage, round = 0): { model: string; effort: Effort } {
  const s = CONFIG.stages[round > 0 && stage !== "analysis" ? "repair" : stage] ?? {};
  return { model: s.model ?? CONFIG.model, effort: s.effort ?? CONFIG.effort };
}

/** Prices for a model (the default model's if it isn't listed). */
export function pricingFor(model: string): Pricing {
  return CONFIG.pricing[model] ?? CONFIG.pricing[CONFIG.model];
}
