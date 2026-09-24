import Anthropic from "@anthropic-ai/sdk";
import { CONFIG } from "../config";
import { BrickModelSchema, type BrickModel } from "../model/schema";
import { brickModelJsonSchema } from "../model/jsonSchema";
import { systemPrompt } from "../prompts/system";
import { photoDesignPrompt, textDesignPrompt, type BuildSize } from "../prompts/design";
import { repairPrompt } from "../prompts/repair";
import { editPrompt } from "../prompts/edit";
import { validate, type Issue, type ValidationResult } from "../validate/validator";
import { buildSteps, type BuildStep } from "../steps/steps";
import { DebugRun } from "./debug";
import { formatUsage, sumUsage, toRoundUsage, type RoundUsage } from "./usage";

export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export interface GenerateInput {
  text?: string;
  image?: { mediaType: ImageMediaType; data: string /* base64 */ };
  size?: BuildSize;
  /** Current model to edit; `text` is then the change request. */
  base?: BrickModel;
}

export interface RoundSummary {
  round: number;
  partCount: number;
  errorCount: number;
  warningCount: number;
  errorCodes: Record<string, number>;
  usage: RoundUsage;
  stopReason: string | null;
  seconds: number;
}

export interface GenerateResult {
  model: BrickModel | null;
  valid: boolean;
  validation: Pick<ValidationResult, "errors" | "warnings" | "components" | "connections"> | null;
  steps: BuildStep[];
  rounds: RoundSummary[];
  usage: RoundUsage;
  debugDir: string;
}

export type GenerateEvent =
  | { type: "start"; debugDir: string }
  | { type: "round_start"; round: number; kind: "design" | "repair" }
  | { type: "progress"; round: number; thinkingChars: number; outputChars: number; thinking?: string }
  | { type: "round_end"; summary: RoundSummary; errors: Issue[] }
  | { type: "done"; result: GenerateResult }
  | { type: "error"; message: string };

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local.");
  return (client ??= new Anthropic());
}

function invalidOutput(message: string): Issue {
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
  const firstText = input.base
    ? editPrompt(input.base, input.text ?? "", !!input.image)
    : input.image
      ? photoDesignPrompt(input.text, input.size)
      : textDesignPrompt(input.text!, input.size);
  debug.write("input.json", { mode: input.base ? "edit" : "build", text: input.text ?? null, size: input.size ?? null, hasImage: !!input.image, config: CONFIG });
  if (input.base) debug.write("base-model.json", input.base);
  debug.write("system-prompt.md", system);
  if (input.image) debug.writeBinary(`input-image.${input.image.mediaType.split("/")[1]}`, Buffer.from(input.image.data, "base64"));

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: input.image
        ? [
            { type: "image", source: { type: "base64", media_type: input.image.mediaType, data: input.image.data } },
            { type: "text", text: firstText },
          ]
        : firstText,
    },
  ];

  const rounds: RoundSummary[] = [];
  let best: { model: BrickModel; v: ValidationResult; errorCount: number } | null = null;

  for (let round = 0; round <= CONFIG.maxRepairRounds; round++) {
    const kind = round === 0 ? "design" : "repair";
    onEvent({ type: "round_start", round, kind });
    debug.write(`round-${round}.prompt.md`, typeof messages.at(-1)!.content === "string" ? (messages.at(-1)!.content as string) : firstText);
    const t0 = Date.now();

    const stream = anthropic.messages.stream(
      {
        model: CONFIG.model,
        max_tokens: CONFIG.maxTokens,
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: CONFIG.effort, format: { type: "json_schema", schema: brickModelJsonSchema() } },
        // Stable system prompt is cached; top-level cache_control caches the growing conversation for the next round.
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        cache_control: { type: "ephemeral" },
        messages,
      },
      { signal },
    );

    let thinkingChars = 0;
    let outputChars = 0;
    let lastEmit = 0;
    let thinkingTail = "";
    const emitProgress = (force = false) => {
      const now = Date.now();
      if (!force && now - lastEmit < 400) return;
      lastEmit = now;
      onEvent({ type: "progress", round, thinkingChars, outputChars, thinking: thinkingTail.slice(-400) });
    };
    stream.on("thinking", (delta) => {
      thinkingChars += delta.length;
      thinkingTail += delta;
      emitProgress();
    });
    stream.on("text", (delta) => {
      outputChars += delta.length;
      emitProgress();
    });

    const msg = await stream.finalMessage();
    emitProgress(true);
    const seconds = (Date.now() - t0) / 1000;
    const usage = toRoundUsage(msg.usage);

    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const thinking = msg.content.flatMap((b) => (b.type === "thinking" ? [b.thinking] : [])).join("\n\n");
    debug.write(`round-${round}.raw.json.txt`, text);
    if (thinking) debug.write(`round-${round}.thinking.md`, thinking);

    if (msg.stop_reason === "refusal") {
      const why = msg.stop_details?.explanation ?? "no explanation given";
      debug.write(`round-${round}.refusal.json`, msg.stop_details ?? {});
      throw new Error(`Claude declined this request (${why}).`);
    }

    let issues: Issue[];
    let warnings: Issue[] = [];
    let model: BrickModel | null = null;
    let v: ValidationResult | null = null;
    if (msg.stop_reason === "max_tokens") {
      issues = [invalidOutput(`Your output was cut off at the ${CONFIG.maxTokens}-token limit. Return a smaller model (fewer, larger parts).`)];
    } else {
      const parsed = parseModel(text);
      model = parsed.model;
      if (model) {
        // Structural issues (weak joints, overhangs) block acceptance during repair
        // rounds; after the last round they're reported as warnings instead.
        v = validate(model, { structure: round < CONFIG.maxRepairRounds ? "error" : "warn" });
        issues = v.errors;
        warnings = v.warnings;
      } else {
        issues = parsed.issues;
      }
    }

    const errorCodes: Record<string, number> = {};
    for (const e of issues) errorCodes[e.code] = (errorCodes[e.code] ?? 0) + 1;
    const summary: RoundSummary = {
      round,
      partCount: model?.parts.length ?? 0,
      errorCount: issues.length,
      warningCount: warnings.length,
      errorCodes,
      usage,
      stopReason: msg.stop_reason,
      seconds,
    };
    rounds.push(summary);
    debug.write(`round-${round}.validation.json`, { summary, errors: issues, warnings, components: v?.components.map((c) => c.length) });
    if (model) debug.write(`round-${round}.model.json`, model);
    console.log(`[generate] round ${round} (${kind}): ${summary.partCount} parts, ${issues.length} errors, ${warnings.length} warnings, ${seconds.toFixed(1)}s · ${formatUsage(usage)}`);
    onEvent({ type: "round_end", summary, errors: issues.slice(0, 50) });

    if (model && v && (!best || issues.length < best.errorCount)) best = { model, v, errorCount: issues.length };
    if (v?.valid) break;
    if (round === CONFIG.maxRepairRounds) break;

    messages.push({ role: "assistant", content: msg.content });
    messages.push({ role: "user", content: repairPrompt(issues, warnings, { round: round + 1 }) });
  }

  const total = sumUsage(rounds.map((r) => r.usage));
  const result: GenerateResult = {
    model: best?.model ?? null,
    valid: best?.v.valid ?? false,
    validation: best ? { errors: best.v.errors, warnings: best.v.warnings, components: best.v.components, connections: best.v.connections } : null,
    steps: best ? buildSteps(best.model) : [],
    rounds,
    usage: total,
    debugDir: debug.dir,
  };
  debug.write("summary.json", { valid: result.valid, rounds, total, partCount: result.model?.parts.length ?? 0 });
  if (result.model) debug.write("final-model.json", result.model);
  console.log(`[generate] done: valid=${result.valid}, ${rounds.length} round(s) · total ${formatUsage(total)} · debug: ${debug.dir}`);
  onEvent({ type: "done", result });
  return result;
}
