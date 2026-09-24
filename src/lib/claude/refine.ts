import type Anthropic from "@anthropic-ai/sdk";
import { CONFIG } from "../config";
import type { BrickModel } from "../model/schema";
import type { PhotoAnalysis, SizeTarget } from "../prompts/analysis";
import { renderModel, type View } from "../render/render";
import type { Issue } from "../validate/validator";
import { runLoop, type CheckResult, type LoopContext, type LoopTool, type RoundSummary } from "./loop";
import { sumUsage, type RoundUsage } from "./usage";

/** A comparison round starting / finishing (shown in the chat; cost logged separately). */
export interface RefineEvent {
  type: "refine";
  round: number;
  rounds: number;
  status: "start" | "done";
  matches?: boolean;
  differences?: string[];
  /** The corrected model passed the checks and replaced the previous one. */
  accepted?: boolean;
  cost?: number;
}

export interface RefineLog {
  round: number;
  matches: boolean;
  differences: string[];
  accepted: boolean;
  cost: number;
  renders: string[];
}

export interface RefineSpec<T> {
  photo: { mediaType: Anthropic.Base64ImageSource["media_type"]; data: string };
  analysis: PhotoAnalysis;
  target: SizeTarget;
  initial: T;
  /** The flat model to render. */
  toModel: (v: T) => BrickModel;
  prompt: (v: T, round: number, rounds: number) => string;
  /** refineJsonSchema(key, inner). */
  schema: Record<string, unknown>;
  key: "model" | "design";
  parseInner: (json: unknown) => { value: T | null; issues: Issue[] };
  check: (v: T, last: boolean) => CheckResult;
  system: string;
  tools?: LoopTool[];
}

interface Answer<T> {
  matches: boolean;
  differences: string[];
  value: T | null;
}

/** The side view on the side the photo shows (right side for azimuth ≥ 0). */
export function views(photo: View): { view: View; side: View } {
  return { view: photo, side: { azimuth: photo.azimuth >= 0 ? 90 : -90, elevation: 5 } };
}

/**
 * Visual comparison loop: render the current model from the photo's angle and
 * from the side, show Claude the photo and both renders, and take its
 * corrected model if it passes the checks (with up to CONFIG.refine.repairRounds
 * repairs). Stops when Claude says it matches, when a correction can't be made
 * valid (the previous model stays), or after CONFIG.refine.rounds rounds.
 */
export async function refineWithPhoto<T>(spec: RefineSpec<T>, ctx: LoopContext, emit: (e: RefineEvent) => void): Promise<{ value: T; rounds: RoundSummary[]; usage: RoundUsage; log: RefineLog[] }> {
  const total = CONFIG.refine.rounds;
  let current = spec.initial;
  const rounds: RoundSummary[] = [];
  const log: RefineLog[] = [];
  const { view, side } = views(spec.analysis.view);
  for (let r = 1; r <= total; r++) {
    emit({ type: "refine", round: r, rounds: total, status: "start" });
    const size = { width: CONFIG.refine.width, height: CONFIG.refine.height };
    const model = spec.toModel(current);
    const pngs = [await renderModel(model, view, size), await renderModel(model, side, size)];
    const names = [`refine-${r}.view.png`, `refine-${r}.side.png`];
    pngs.forEach((b, i) => ctx.debug.writeBinary(names[i], b));
    const text = spec.prompt(current, r, total);
    const image = (data: string, media_type: Anthropic.Base64ImageSource["media_type"]): Anthropic.ImageBlockParam => ({ type: "image", source: { type: "base64", media_type, data } });
    const loop = await runLoop<Answer<T>>(
      {
        scope: `refine:${r}`,
        debugPrefix: `refine-${r}.`,
        system: spec.system,
        firstContent: [image(spec.photo.data, spec.photo.mediaType), ...pngs.map((b) => image(b.toString("base64"), "image/png")), { type: "text", text }],
        firstText: text,
        schema: spec.schema,
        tools: spec.tools,
        maxRepairRounds: CONFIG.refine.repairRounds,
        parse: (raw) => {
          let json: { matches?: unknown; differences?: unknown; [k: string]: unknown };
          try {
            json = JSON.parse(raw);
          } catch (e) {
            return { value: null, issues: [invalid(`Output was not valid JSON (${(e as Error).message}).`)] };
          }
          const differences = Array.isArray(json.differences) ? json.differences.map(String) : [];
          if (json.matches === true) return { value: { matches: true, differences, value: null }, issues: [] };
          const inner = spec.parseInner(json[spec.key]);
          return inner.value ? { value: { matches: false, differences, value: inner.value }, issues: [] } : { value: null, issues: inner.issues };
        },
        check: (a, last) => (a.matches || !a.value ? { errors: [], warnings: [], valid: true, partCount: 0 } : spec.check(a.value, last)),
      },
      ctx,
    );
    rounds.push(...loop.rounds);
    const answer = loop.best?.value;
    const accepted = !!answer && !answer.matches && !!answer.value && !!loop.best?.check.valid;
    if (accepted) current = answer!.value!;
    const entry: RefineLog = { round: r, matches: !!answer?.matches, differences: answer?.differences ?? [], accepted, cost: loop.usage.cost, renders: names };
    log.push(entry);
    ctx.debug.write(`refine-${r}.json`, entry);
    console.log(`[generate] comparison ${r}/${total}: ${entry.matches ? "matches" : accepted ? `refined (${entry.differences.length} differences)` : "correction not valid, kept the previous model"} · $${entry.cost.toFixed(4)}`);
    emit({ type: "refine", round: r, rounds: total, status: "done", matches: entry.matches, differences: entry.differences, accepted, cost: entry.cost });
    if (!accepted) break; // it matches, or the correction couldn't be made valid
  }
  return { value: current, rounds, usage: sumUsage(rounds.map((x) => x.usage)), log };
}

const invalid = (message: string): Issue => ({ code: "INVALID_OUTPUT", severity: "error", parts: [], message });
