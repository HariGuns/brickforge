import Anthropic from "@anthropic-ai/sdk";
import { catalogUsage, formatCatalogUsage } from "../parts/usage";
import { searchPartsTool } from "./tools";
import { apiKey, settingsEnabled } from "../settings/store";
import { CONFIG } from "../config";
import { BrickModelSchema, type BrickModel } from "../model/schema";
import { brickModelJsonSchema } from "../model/jsonSchema";
import { systemPrompt } from "../prompts/system";
import { photoDesignPrompt, textDesignPrompt } from "../prompts/design";
import { analysisBlock, type PhotoAnalysis, type SizeTarget } from "../prompts/analysis";
import type { Detail } from "../detail";
import { analyzePhoto, type AnalysisEvent } from "./analyze";
import { sumUsage } from "./usage";
import { editPrompt } from "../prompts/edit";
import { validate, type Issue, type ValidationResult } from "../validate/validator";
import { buildSteps, type BuildStep } from "../steps/steps";
import { DebugRun } from "./debug";
import { formatUsage, type RoundUsage } from "./usage";
import { runLoop, type LoopEvent, type RoundSummary } from "./loop";
import type { BrickDesign } from "../design/schema";
import type { CompileResult } from "../design/compile";

export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export interface GenerateInput {
  text?: string;
  image?: { mediaType: ImageMediaType; data: string /* base64 */ };
  /** Target width and part budget (see CONFIG.detail). */
  detail?: Detail;
  /** Current model to edit; `text` is then the change request. */
  base?: BrickModel;
}

export type { RoundSummary } from "./loop";

export interface GenerateResult {
  model: BrickModel | null;
  valid: boolean;
  validation: Pick<ValidationResult, "errors" | "warnings" | "components" | "connections"> | null;
  steps: BuildStep[];
  rounds: RoundSummary[];
  usage: RoundUsage;
  debugDir: string;
  /** Sub-build path only: the design the model was compiled from, and compile info. */
  design?: BrickDesign;
  compile?: Pick<CompileResult, "stats" | "tree" | "subBuilds">;
  pipeline?: "single" | "subbuilds";
  /** Photo builds: what the analysis found, the size it set, and what it cost (also counted in `usage`). */
  analysis?: { analysis: PhotoAnalysis; target: SizeTarget; cost: number };
}

/** A stage of the sub-build path starting or finishing ("plan", "sub:<id>", "assembly"). */
export interface StageEvent {
  type: "stage";
  scope: string;
  label: string;
  status: "start" | "done";
  valid?: boolean;
  parts?: number;
  copies?: number;
  cost?: number;
}

export type GenerateEvent = { type: "start"; debugDir: string } | LoopEvent | StageEvent | AnalysisEvent | { type: "done"; result: GenerateResult } | { type: "error"; message: string };

let client: { key: string; api: Anthropic } | null = null;
/** A client for the current key (Settings, or ANTHROPIC_API_KEY in .env.local); rebuilt when the key changes. */
export function getClient(): Anthropic {
  const key = apiKey().key;
  if (!key) throw new Error(settingsEnabled() ? "No Anthropic API key yet. Add one in Settings." : "ANTHROPIC_API_KEY is not set. Add it to .env.local.");
  if (client?.key !== key) client = { key, api: new Anthropic({ apiKey: key }) };
  return client.api;
}

export function invalidOutput(message: string): Issue {
  return { code: "INVALID_OUTPUT", severity: "error", parts: [], message };
}

/** Parse Claude's JSON text into a model, returning issues instead of throwing. */
export function parseModel(text: string): { model: BrickModel | null; issues: Issue[] } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { model: null, issues: [invalidOutput(`Output was not valid JSON (${(e as Error).message}).`)] };
  }
  const r = BrickModelSchema.safeParse(json);
  if (!r.success) {
    const issues = r.error.issues.slice(0, 20).map((i) => invalidOutput(`${i.path.join(".")}: ${i.message}`));
    return { model: null, issues };
  }
  return { model: r.data, issues: [] };
}

export interface GenerateOptions {
  signal?: AbortSignal;
  /** Injected client (tests); defaults to one built from ANTHROPIC_API_KEY. */
  client?: Pick<Anthropic, "messages">;
}

/**
 * Generate → validate → repair loop. Each repair round continues the same
 * conversation (append-only), feeding the validator's errors back to Claude.
 * Returns the first valid model, or the attempt with the fewest errors.
 */
export async function generateModel(input: GenerateInput, onEvent: (e: GenerateEvent) => void = () => {}, opts: GenerateOptions = {}): Promise<GenerateResult> {
  if (!input.text?.trim() && !input.image) throw new Error(input.base ? "Describe the change you want." : "Provide a description or a photo.");
  const anthropic = opts.client ?? getClient();
  const signal = opts.signal;
  const debug = new DebugRun(`${input.base ? "edit-" : ""}${input.text?.trim() || "photo"}`);
  onEvent({ type: "start", debugDir: debug.dir });

  const system = systemPrompt();
  debug.write("input.json", { mode: input.base ? "edit" : "build", text: input.text ?? null, detail: input.detail ?? null, hasImage: !!input.image, config: CONFIG });
  if (input.base) debug.write("base-model.json", input.base);
  debug.write("system-prompt.md", system);
  if (input.image) debug.writeBinary(`input-image.${input.image.mediaType.split("/")[1]}`, Buffer.from(input.image.data, "base64"));

  // A photo build starts with the analysis: proportions, features, colours, camera angle → target size.
  const photo = input.image && !input.base ? await analyzePhoto({ text: input.text, image: input.image, detail: input.detail }, CONFIG.grid, { anthropic, debug, onEvent, signal }, system) : null;
  if (photo) onEvent({ type: "analysis", analysis: photo.analysis, target: photo.target, cost: photo.usage.cost });

  const firstText = input.base
    ? editPrompt(input.base, input.text ?? "", !!input.image)
    : input.image
      ? photoDesignPrompt(input.text, input.detail, photo ? analysisBlock(photo.analysis, photo.target, { partLimit: CONFIG.maxParts }) : undefined)
      : textDesignPrompt(input.text!, input.detail);

  const firstContent: Anthropic.MessageParam["content"] = input.image
    ? [
        { type: "image", source: { type: "base64", media_type: input.image.mediaType, data: input.image.data } },
        { type: "text", text: firstText },
      ]
    : firstText;

  const loop = await runLoop<BrickModel>(
    {
      scope: "main",
      debugPrefix: "",
      system,
      firstContent,
      firstText,
      schema: brickModelJsonSchema(),
      tools: [searchPartsTool],
      parse: (text) => {
        const r = parseModel(text);
        return { value: r.model, issues: r.issues };
      },
      // Structural issues (weak joints, overhangs) block acceptance during repair
      // rounds; after the last round they're reported as warnings instead.
      check: (model, last) => {
        const v = validate(model, { structure: last ? "warn" : "error" });
        return { errors: v.errors, warnings: v.warnings, valid: v.valid, partCount: model.parts.length };
      },
    },
    { anthropic, debug, onEvent, signal },
  );

  const bestModel = loop.best?.value ?? null;
  const v = bestModel ? validate(bestModel, { structure: loop.best!.check.valid ? "warn" : "error" }) : null;
  const result: GenerateResult = {
    model: bestModel,
    valid: loop.best?.check.valid ?? false,
    validation: v ? { errors: loop.best!.check.errors, warnings: loop.best!.check.warnings, components: v.components, connections: v.connections } : null,
    steps: bestModel ? buildSteps(bestModel) : [],
    rounds: loop.rounds,
    usage: photo ? sumUsage([photo.usage, loop.usage]) : loop.usage,
    debugDir: debug.dir,
    pipeline: "single",
    ...(photo ? { analysis: { analysis: photo.analysis, target: photo.target, cost: photo.usage.cost } } : {}),
  };
  const catalog = catalogUsage(result.model);
  console.log(`[generate] ${formatCatalogUsage(catalog)}`);
  debug.write("summary.json", {
    pipeline: "single",
    valid: result.valid,
    rounds: loop.rounds,
    ...(photo ? { analysis: { subject: photo.analysis.subject, target: photo.target, usage: photo.usage } } : {}),
    total: result.usage,
    partCount: result.model?.parts.length ?? 0,
    catalog,
  });
  if (result.model) debug.write("final-model.json", result.model);
  console.log(`[generate] done: valid=${result.valid}, ${loop.rounds.length} round(s) · total ${formatUsage(result.usage)}${photo ? ` (analysis ${formatUsage(photo.usage)})` : ""} · debug: ${debug.dir}`);
  onEvent({ type: "done", result });
  return result;
}
