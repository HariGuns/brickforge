import type Anthropic from "@anthropic-ai/sdk";
import { CONFIG, stageSetting, type Effort, type Stage } from "../config";
import type { Issue } from "../validate/validator";
import { repairPrompt } from "../prompts/repair";
import type { DebugRun } from "./debug";
import { cacheHit, formatUsage, sumUsage, toRoundUsage, type RoundUsage } from "./usage";

/**
 * The generate → validate → repair loop, shared by the single-pass generator
 * and each stage of the sub-build generator. Each repair round continues the
 * same conversation (append-only) and feeds the check's errors back to Claude.
 */

export interface RoundSummary {
  round: number;
  /** Which loop this round belongs to: "main" (single pass), "plan", "sub:<id>" or "assembly". */
  scope: string;
  partCount: number;
  errorCount: number;
  warningCount: number;
  errorCodes: Record<string, number>;
  usage: RoundUsage;
  stopReason: string | null;
  seconds: number;
  /** Loaded from an earlier, interrupted run (resume) rather than run now. */
  reused?: boolean;
  /** Tool calls (part searches) made during this round. */
  toolCalls?: number;
  /** Model and effort used for this round. */
  model?: string;
  effort?: Effort;
}

/** A client-side tool Claude can call during a round (e.g. search_parts). */
export interface LoopTool {
  def: Anthropic.Tool;
  /** Returns the tool result text, plus a short summary for logs and the UI. */
  run: (input: Record<string, unknown>) => { text: string; summary: string };
}

/** Most tool turns in one round before Claude must answer. */
const MAX_TOOL_TURNS = 10;

export type LoopEvent =
  | { type: "round_start"; scope: string; round: number; kind: "design" | "repair" }
  | { type: "progress"; scope: string; round: number; thinkingChars: number; outputChars: number; thinking?: string }
  | { type: "round_end"; scope: string; summary: RoundSummary; errors: Issue[] }
  | { type: "tool"; scope: string; round: number; name: string; input: Record<string, unknown>; summary: string };

export interface CheckResult {
  errors: Issue[];
  warnings: Issue[];
  valid: boolean;
  partCount: number;
}

export interface LoopSpec<T> {
  scope: string;
  /** File-name prefix in the debug folder ("" keeps the classic round-N.* names). */
  debugPrefix: string;
  system: string;
  firstContent: Anthropic.MessageParam["content"];
  /** Text version of the first prompt, for the debug folder. */
  firstText: string;
  schema: Record<string, unknown>;
  parse: (text: string) => { value: T | null; issues: Issue[] };
  /** Validate a parsed value. `last` = no repair round follows (structural issues become warnings). */
  check: (value: T, last: boolean) => CheckResult;
  maxRepairRounds?: number;
  repairText?: (errors: Issue[], warnings: Issue[], round: number) => string;
  /** Client-side tools Claude may call before answering. */
  tools?: LoopTool[];
  /**
   * "none": list the tools but don't let Claude call them. Every stage of a run
   * sends the same tools, so they and the system prompt (with the part menu)
   * form one cached prefix; a stage without tools would miss the cache.
   */
  toolChoice?: "auto" | "none";
  /** Which CONFIG.stages entry sets the model and effort (repair rounds use `repair`). Default "design". */
  stage?: Stage;
  /**
   * Repairs as diffs: from the first repair round on, Claude returns only the
   * changes (this schema), applied to its previous answer; the repair prompt
   * shows that answer with indices.
   */
  diff?: {
    schema: Record<string, unknown>;
    apply: (prev: T, json: unknown) => { value: T | null; issues: Issue[] };
    listing: (v: T) => string;
    instructions: string;
  };
}

export interface LoopContext {
  anthropic: Pick<Anthropic, "messages">;
  debug: DebugRun;
  onEvent: (e: LoopEvent) => void;
  signal?: AbortSignal;
  /**
   * Called once, as soon as the first request starts streaming (its prompt,
   * and so the cache entry, has been processed). Used to start parallel
   * requests after the first one, so they read the cache instead of all
   * writing it.
   */
  onStarted?: () => void;
}

export interface LoopResult<T> {
  /** The first valid value, or the one with the fewest errors. */
  best: { value: T; check: CheckResult } | null;
  rounds: RoundSummary[];
  usage: RoundUsage;
}

const invalidOutput = (message: string): Issue => ({ code: "INVALID_OUTPUT", severity: "error", parts: [], message });

export async function runLoop<T>(spec: LoopSpec<T>, ctx: LoopContext): Promise<LoopResult<T>> {
  const maxRounds = spec.maxRepairRounds ?? CONFIG.maxRepairRounds;
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: spec.firstContent }];
  const rounds: RoundSummary[] = [];
  const f = (name: string) => `${spec.debugPrefix}${name}`;
  let best: LoopResult<T>["best"] = null;
  /** The last answer that parsed (valid or not): what a repair diff applies to. */
  let lastValue: T | null = null;
  let startedOnce = false;
  const started = () => {
    if (startedOnce) return;
    startedOnce = true;
    ctx.onStarted?.();
  };

  for (let round = 0; round <= maxRounds; round++) {
    const kind = round === 0 ? "design" : "repair";
    ctx.onEvent({ type: "round_start", scope: spec.scope, round, kind });
    ctx.debug.write(f(`round-${round}.prompt.md`), round === 0 ? spec.firstText : (messages.at(-1)!.content as string));
    const t0 = Date.now();

    let thinkingChars = 0;
    let outputChars = 0;
    let lastEmit = 0;
    let thinkingTail = "";
    const emitProgress = (force = false) => {
      const now = Date.now();
      if (!force && now - lastEmit < 400) return;
      lastEmit = now;
      ctx.onEvent({ type: "progress", scope: spec.scope, round, thinkingChars, outputChars, thinking: thinkingTail.slice(-400) });
    };

    const useDiff = round > 0 && !!spec.diff && lastValue !== null;
    const setting = stageSetting(spec.stage ?? "design", round);
    const diffBase = lastValue;
    // One round = one answer; with tools, Claude may search first (several API calls, same round).
    const tools = spec.tools ?? [];
    const toolLog: { name: string; input: unknown; summary: string }[] = [];
    const thinkingParts: string[] = [];
    const callUsage: RoundUsage[] = [];
    let msg: Anthropic.Message;
    for (let turn = 0; ; turn++) {
      const stream = ctx.anthropic.messages.stream(
        {
          model: setting.model,
          max_tokens: CONFIG.maxTokens,
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort: setting.effort, format: { type: "json_schema", schema: useDiff ? spec.diff!.schema : spec.schema } },
          // Stable system prompt is cached; top-level cache_control caches the growing conversation for the next call.
          system: [{ type: "text", text: spec.system, cache_control: { type: "ephemeral" } }],
          cache_control: { type: "ephemeral" },
          ...(tools.length ? { tools: tools.map((t) => t.def), tool_choice: turn >= MAX_TOOL_TURNS || spec.toolChoice === "none" ? { type: "none" as const } : { type: "auto" as const } } : {}),
          messages,
        },
        { signal: ctx.signal },
      );
      stream.on("streamEvent", () => started());
      stream.on("thinking", (delta) => {
        thinkingChars += delta.length;
        thinkingTail += delta;
        emitProgress();
      });
      stream.on("text", (delta) => {
        outputChars += delta.length;
        emitProgress();
      });
      msg = await stream.finalMessage();
      started();
      callUsage.push(toRoundUsage(msg.usage, setting.model));
      thinkingParts.push(...msg.content.flatMap((b) => (b.type === "thinking" ? [b.thinking] : [])));
      if (msg.stop_reason !== "tool_use") break;

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const b of msg.content) {
        if (b.type !== "tool_use") continue;
        const tool = tools.find((t) => t.def.name === b.name);
        const input = (b.input ?? {}) as Record<string, unknown>;
        const out = tool ? tool.run(input) : { text: `Unknown tool ${b.name}`, summary: "unknown tool" };
        toolLog.push({ name: b.name, input, summary: out.summary });
        ctx.onEvent({ type: "tool", scope: spec.scope, round, name: b.name, input, summary: out.summary });
        results.push({ type: "tool_result", tool_use_id: b.id, content: out.text });
      }
      messages.push({ role: "assistant", content: msg.content });
      messages.push({ role: "user", content: results });
    }
    emitProgress(true);
    const seconds = (Date.now() - t0) / 1000;
    const usage = sumUsage(callUsage);
    if (toolLog.length) ctx.debug.write(f(`round-${round}.tools.json`), toolLog);

    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const thinking = thinkingParts.join("\n\n");
    ctx.debug.write(f(`round-${round}.raw.json.txt`), text);
    if (thinking) ctx.debug.write(f(`round-${round}.thinking.md`), thinking);

    if (msg.stop_reason === "refusal") {
      const why = msg.stop_details?.explanation ?? "no explanation given";
      ctx.debug.write(f(`round-${round}.refusal.json`), msg.stop_details ?? {});
      throw new Error(`Claude declined this request (${why}).`);
    }

    let issues: Issue[];
    let warnings: Issue[] = [];
    let value: T | null = null;
    let check: CheckResult | null = null;
    if (msg.stop_reason === "max_tokens") {
      issues = [invalidOutput(`Your output was cut off at the ${CONFIG.maxTokens}-token limit. Return something smaller (fewer, larger parts).`)];
    } else {
      let parsed: { value: T | null; issues: Issue[] };
      if (useDiff) {
        try {
          parsed = spec.diff!.apply(diffBase!, JSON.parse(text));
        } catch (e) {
          parsed = { value: null, issues: [invalidOutput(`Output was not valid JSON (${(e as Error).message}).`)] };
        }
      } else parsed = spec.parse(text);
      value = parsed.value;
      if (value !== null) lastValue = value;
      if (value !== null) {
        check = spec.check(value, round === maxRounds);
        issues = check.errors;
        warnings = check.warnings;
      } else {
        issues = parsed.issues;
      }
    }

    const errorCodes: Record<string, number> = {};
    for (const e of issues) errorCodes[e.code] = (errorCodes[e.code] ?? 0) + 1;
    const summary: RoundSummary = {
      round,
      scope: spec.scope,
      partCount: check?.partCount ?? 0,
      errorCount: issues.length,
      warningCount: warnings.length,
      errorCodes,
      usage,
      stopReason: msg.stop_reason,
      seconds,
      ...(toolLog.length ? { toolCalls: toolLog.length } : {}),
      model: setting.model,
      effort: setting.effort,
    };
    rounds.push(summary);
    ctx.debug.write(f(`round-${round}.validation.json`), { summary, errors: issues, warnings });
    if (value !== null) ctx.debug.write(f(`round-${round}.model.json`), value);
    console.log(`[generate] ${spec.scope} round ${round} (${kind}, ${setting.model} ${setting.effort}): ${summary.partCount} parts, ${issues.length} errors, ${warnings.length} warnings, ${toolLog.length ? `${toolLog.length} part searches, ` : ""}${seconds.toFixed(1)}s · ${formatUsage(usage)} · cache hit ${cacheHit(usage)}`);
    ctx.onEvent({ type: "round_end", scope: spec.scope, summary, errors: issues.slice(0, 50) });

    if (value !== null && check && (!best || issues.length < best.check.errors.length)) best = { value, check };
    if (check?.valid) break;
    if (round === maxRounds) break;

    messages.push({ role: "assistant", content: msg.content });
    const diff = spec.diff && lastValue !== null ? { listing: spec.diff.listing(lastValue), instructions: spec.diff.instructions } : undefined;
    messages.push({ role: "user", content: (spec.repairText ?? ((e, w, r) => repairPrompt(e, w, { round: r, diff })))(issues, warnings, round + 1) });
  }

  return { best, rounds, usage: sumUsage(rounds.map((r) => r.usage)) };
}
