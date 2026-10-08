import fs from "node:fs";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { CONFIG, stageSetting } from "../config";
import { generateModel } from "./generate";
import { toRoundUsage } from "./usage";
import { P, SAMPLE_HOUSE } from "../fixtures/samples";

const saved = structuredClone(CONFIG.stages);
afterEach(() => void (CONFIG.stages = structuredClone(saved)));
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function fake(answers: string[]) {
  const requests: Anthropic.MessageCreateParams[] = [];
  const client = {
    messages: {
      stream(params: Anthropic.MessageCreateParams) {
        requests.push(structuredClone(params));
        const text = answers.shift()!;
        return {
          on() {
            return this;
          },
          async finalMessage() {
            return { content: [{ type: "text", text }], stop_reason: "end_turn", stop_details: null, usage: { input_tokens: 0, output_tokens: 1_000_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
          },
        };
      },
    },
  } as unknown as Pick<Anthropic, "messages">;
  return { client, requests };
}

describe("model and effort per stage", () => {
  it("resolves stage settings, with repairs using the repair entry", () => {
    CONFIG.stages.design = { effort: "high" };
    CONFIG.stages.repair = { model: "claude-haiku-4-5-20251001", effort: "low" };
    expect(stageSetting("design", 0)).toEqual({ model: CONFIG.model, effort: "high" });
    expect(stageSetting("design", 2)).toEqual({ model: "claude-haiku-4-5-20251001", effort: "low" });
    expect(stageSetting("analysis", 1)).toEqual(stageSetting("analysis", 0)); // the analysis's retry isn't a repair
  });

  it("sends each round with its stage's model and effort, and prices it with that model's rates", async () => {
    CONFIG.stages.design = { effort: "high" };
    CONFIG.stages.repair = { model: "claude-sonnet-5", effort: "medium" };
    const broken = { ...SAMPLE_HOUSE, parts: [...SAMPLE_HOUSE.parts, P("brick_1x2", "red", 20, 9, 20)] };
    const { client, requests } = fake([JSON.stringify(broken), JSON.stringify({ name: "", description: "", remove: [broken.parts.length - 1], set: [], add: [] })]);
    const r = await generateModel({ text: "tiny house" }, () => {}, { client });
    dirs.push(r.debugDir);
    expect(requests.map((q) => [q.model, q.output_config?.effort])).toEqual([
      [CONFIG.model, "high"],
      ["claude-sonnet-5", "medium"],
    ]);
    expect(r.rounds.map((x) => [x.model, x.effort])).toEqual([
      [CONFIG.model, "high"],
      ["claude-sonnet-5", "medium"],
    ]);
    // 1M output tokens each: $20 on Opus 5.5, $10 on Sonnet 5.
    expect(r.rounds.map((x) => x.usage.cost)).toEqual([20, 10]);
  });

  it("prices unknown models at the default model's rates", () => {
    expect(toRoundUsage({ input_tokens: 1e6, output_tokens: 0 }, "some-future-model").cost).toBe(CONFIG.pricing[CONFIG.model].input);
  });
});
