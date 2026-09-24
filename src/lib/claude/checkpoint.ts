import fs from "node:fs";
import { PhotoAnalysisSchema, type PhotoAnalysis, type SizeTarget } from "../prompts/analysis";
import { toDetail } from "../detail";
import path from "node:path";
import { BrickModelSchema, type BrickModel } from "../model/schema";
import type { Plan } from "../prompts/subbuilds";
import type { GenerateInput, ImageMediaType } from "./generate";
import type { RoundSummary } from "./loop";

/**
 * What an interrupted sub-build run left in its debug folder: the input, the
 * plan (if it was accepted) and, per stage, every round's summary plus the
 * model of the round that passed. Resume reuses the valid stages.
 */
export interface StageCheckpoint<T> {
  rounds: RoundSummary[];
  /** The value from the round that passed validation, if any. */
  valid: T | null;
}

export interface Checkpoint {
  dir: string;
  input: GenerateInput;
  plan: StageCheckpoint<Plan>;
  subs: Map<string, StageCheckpoint<BrickModel>>;
  assembly: StageCheckpoint<unknown>;
  /** The photo analysis, if the run got that far (reused on resume). */
  analysis?: { analysis: PhotoAnalysis; target: SizeTarget; rounds: RoundSummary[] };
}

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

function stage<T>(dir: string, prefix: string, parse: (raw: unknown) => T | null): StageCheckpoint<T> {
  const files = fs.readdirSync(dir);
  const rounds: RoundSummary[] = [];
  let valid: T | null = null;
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}round-(\\d+)\\.validation\\.json$`);
  const nums = files.flatMap((f) => (re.test(f) ? [Number(f.match(re)![1])] : [])).sort((a, b) => a - b);
  for (const n of nums) {
    const v = readJson(path.join(dir, `${prefix}round-${n}.validation.json`)) as { summary?: RoundSummary; errors?: unknown[] } | null;
    if (!v?.summary) continue;
    rounds.push({ ...v.summary, reused: true });
    if (!v.errors?.length) {
      const value = parse(readJson(path.join(dir, `${prefix}round-${n}.model.json`)));
      if (value !== null) valid = value;
    }
  }
  return { rounds, valid };
}

export function loadCheckpoint(dir: string): Checkpoint {
  const abs = path.resolve(dir);
  const input = readJson(path.join(abs, "input.json")) as { pipeline?: string; text?: string | null; detail?: string | null; size?: string | null; hasImage?: boolean } | null;
  if (!input) throw new Error(`${abs} has no input.json; it isn't a generation run.`);
  if (input.pipeline !== "subbuilds") throw new Error("Only sub-build runs can be resumed (single-pass runs are one call; just run them again).");
  let image: GenerateInput["image"];
  if (input.hasImage) {
    const f = fs.readdirSync(abs).find((x) => x.startsWith("input-image."));
    if (!f) throw new Error("The run used a photo, but input-image.* is missing.");
    const ext = f.split(".").pop()!;
    image = { mediaType: `image/${ext === "jpg" ? "jpeg" : ext}` as ImageMediaType, data: fs.readFileSync(path.join(abs, f)).toString("base64") };
  }
  const plan = stage<Plan>(abs, "plan.", (raw) => (raw && typeof raw === "object" && "subBuilds" in raw ? (raw as Plan) : null));
  const subs = new Map<string, StageCheckpoint<BrickModel>>();
  for (const sub of plan.valid?.subBuilds ?? []) {
    subs.set(sub.id, stage(abs, `sub-${sub.id}.`, (raw) => {
      const r = BrickModelSchema.safeParse(raw);
      return r.success ? r.data : null;
    }));
  }
  const assembly = stage<unknown>(abs, "assembly.", (raw) => raw ?? null);
  const saved = readJson(path.join(abs, "analysis.json")) as { analysis?: unknown; target?: SizeTarget } | null;
  const parsedAnalysis = PhotoAnalysisSchema.safeParse(saved?.analysis);
  const analysis = parsedAnalysis.success && saved?.target ? { analysis: parsedAnalysis.data, target: saved.target, rounds: stage<unknown>(abs, "analysis.", (raw) => raw ?? null).rounds } : undefined;
  // Older runs saved a Small/Medium/Large size; toDetail maps it.
  return { dir: abs, input: { text: input.text ?? undefined, detail: toDetail(input.detail ?? input.size), image }, plan, subs, assembly, ...(analysis ? { analysis } : {}) };
}
