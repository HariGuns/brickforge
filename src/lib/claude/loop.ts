import type Anthropic from "@anthropic-ai/sdk";
import { CONFIG } from "../config";
import type { Issue } from "../validate/validator";
import { repairPrompt } from "../prompts/repair";
import type { DebugRun } from "./debug";
import { formatUsage, sumUsage, toRoundUsage, type RoundUsage } from "./usage";

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
}

export type LoopEvent =
  | { type: "round_start"; scope: string; round: number; kind: "design" | "repair" }
  | { type: "progress"; scope: string; round: number; thinkingChars: number; outputChars: number; thinking?: string }
  | { type: "round_end"; scope: string; summary: RoundSummary; errors: Issue[] };

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
}

export interface LoopContext {
  anthropic: Pick<Anthropic, "messages">;
  debug: DebugRun;
  onEvent: (e: LoopEvent) => void;
  signal?: AbortSignal;
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

  for (let round = 0; round <= maxRounds; round++) {
    const kind = round === 0 ? "design" : "repair";
    ctx.onEvent({ type: "round_start", scope: spec.scope, round, kind });
    ctx.debug.write(f(`round-${round}.prompt.md`), round === 0 ? spec.firstText : (messages.at(-1)!.content as string));
    const t0 = Date.now();

    const stream = ctx.anthropic.messages.stream(
      {
        model: CONFIG.model,
        max_tokens: CONFIG.maxTokens,
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: CONFIG.effort, format: { type: "json_schema", schema: spec.schema } },
        // Stable system prompt is cached; top-level cache_control caches the growing conversation for the next round.
        system: [{ type: "text", text: spec.system, cache_control: { type: "ephemeral" } }],
        cache_control: { type: "ephemeral" },
        messages,
      },
      { signal: ctx.signal },
    );

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
      const parsed = spec.parse(text);
      value = parsed.value;
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
    };
    rounds.push(summary);
    ctx.debug.write(f(`round-${round}.validation.json`), { summary, errors: issues, warnings });
    if (value !== null) ctx.debug.write(f(`round-${round}.model.json`), value);
    console.log(`[generate] ${spec.scope} round ${round} (${kind}): ${summary.partCount} parts, ${issues.length} errors, ${warnings.length} warnings, ${seconds.toFixed(1)}s · ${formatUsage(usage)}`);
    ctx.onEvent({ type: "round_end", scope: spec.scope, summary, errors: issues.slice(0, 50) });

    if (value !== null && check && (!best || issues.length < best.check.errors.length)) best = { value, check };
    if (check?.valid) break;
    if (round === maxRounds) break;

    messages.push({ role: "assistant", content: msg.content });
    messages.push({ role: "user", content: (spec.repairText ?? ((e, w, r) => repairPrompt(e, w, { round: r })))(issues, warnings, round + 1) });
  }

  return { best, rounds, usage: sumUsage(rounds.map((r) => r.usage)) };
}
