import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { generateModel, parseModel, type GenerateEvent } from "./generate";
import { CONFIG } from "../config";
import { P, SAMPLE_HOUSE } from "../fixtures/samples";
import { compactCodec } from "../diff/codec";

/** Fake client whose stream() returns queued JSON answers and records requests. */
function fakeClient(answers: string[]) {
  const requests: Anthropic.MessageCreateParams[] = [];
  const client = {
    messages: {
      stream(params: Anthropic.MessageCreateParams) {
        requests.push(structuredClone(params));
        const text = answers.shift()!;
        const handlers: Record<string, ((d: string) => void)[]> = {};
        return {
          on(ev: string, fn: (d: string) => void) {
            (handlers[ev] ??= []).push(fn);
            return this;
          },
          async finalMessage() {
            handlers.thinking?.forEach((f) => f("planning the layers…"));
            handlers.text?.forEach((f) => f(text));
            return {
              content: [
                { type: "thinking", thinking: "planning the layers…", signature: "sig" },
                { type: "text", text },
              ],
              stop_reason: "end_turn",
              stop_details: null,
              usage: { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 500, cache_creation_input_tokens: 100 },
            };
          },
        };
      },
    },
  };
  return { client: client as unknown as Pick<Anthropic, "messages">, requests };
}

/** A repair / edit answer: only the changes. */
const diff = (d: { remove?: number[]; set?: object[]; add?: object[] } = {}) => JSON.stringify({ name: "", description: "", remove: d.remove ?? [], set: d.set ?? [], add: d.add ?? [] });

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe("generate/repair loop (fake Claude)", () => {
  it("feeds validator errors back and stops when the model is valid", async () => {
    const broken = { ...SAMPLE_HOUSE, parts: [...SAMPLE_HOUSE.parts, P("brick_2x2", "red", 20, 9, 20)] }; // floating part
    // The repair removes the floating part by its index.
    const { client, requests } = fakeClient([JSON.stringify(broken), diff({ remove: [broken.parts.length - 1] })]);
    const events: GenerateEvent[] = [];
    const r = await generateModel({ text: "tiny house" }, (e) => events.push(e), { client });
    dirs.push(r.debugDir);
    // Test runs go to the throwaway data folder (vitest.global-setup.ts), never the real debug/.
    expect(r.debugDir.startsWith(path.resolve(process.env.BRICKFORGE_DATA_DIR!))).toBe(true);

    expect(r.valid).toBe(true);
    expect(r.rounds.map((x) => x.errorCount)).toEqual([1, 0]);
    expect(r.steps.length).toBeGreaterThan(0);

    // Round 2 continues the conversation: user, assistant (unchanged content), user repair prompt.
    const second = requests[1].messages;
    expect(second).toHaveLength(3);
    expect(second[1].role).toBe("assistant");
    // The finished round's thinking isn't re-sent (it would be billed again as input).
    expect((second[1].content as { type: string }[]).map((b) => b.type)).toEqual(["text"]);
    expect(second[2].content).toMatch(/FLOATING/);
    expect(second[2].content).toContain(`Your last answer, with indices:\n#0 ${compactCodec.formatPlacement(broken.parts[0])}`);
    expect(requests[0].model).toBe(CONFIG.model);
    // One schema for both rounds (it's part of the cached prefix): full-answer fields plus the diff's.
    // The repair gives changes; the result is the house without the stray brick.
    const schemaProps = (q: Anthropic.MessageCreateParams) => Object.keys(((q.output_config?.format?.schema ?? {}) as { properties?: object }).properties ?? {});
    expect(schemaProps(requests[0])).toEqual(["name", "description", "parts", "remove", "set", "add"]);
    expect(requests[1].output_config?.format).toEqual(requests[0].output_config?.format);
    expect(r.model!.parts).toEqual(SAMPLE_HOUSE.parts);

    // Usage and cost: 2 rounds × (1000×4 + 2000×20 + 500×0.2 + 100×5) / 1e6
    expect(r.usage.cost).toBeCloseTo(2 * (4000 + 40000 + 100 + 500) / 1e6, 6);

    // Debug folder has raw output and validator results per round.
    const files = fs.readdirSync(r.debugDir);
    for (const f of ["round-0.raw.json.txt", "round-0.validation.json", "round-1.raw.json.txt", "summary.json", "system-prompt.md", "final-model.json"]) {
      expect(files).toContain(f);
    }
    const v0 = JSON.parse(fs.readFileSync(path.join(r.debugDir, "round-0.validation.json"), "utf8"));
    expect(v0.errors[0].code).toBe("FLOATING");
    expect(events.filter((e) => e.type === "round_end")).toHaveLength(2);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("returns the best attempt when repairs run out", async () => {
    const bad = JSON.stringify({ name: "x", description: "x", parts: [P("brick_2x2", "red", 0, 0, 0), P("brick_2x2", "red", 0, 9, 0)] });
    // Round 0 doesn't parse, so round 1 asks for the whole model again; later rounds change nothing.
    const answers = ["not json", bad, ...Array.from({ length: CONFIG.maxRepairRounds - 1 }, () => diff())];
    const { client, requests } = fakeClient(answers);
    const r = await generateModel({ text: "x" }, () => {}, { client });
    dirs.push(r.debugDir);
    expect(requests).toHaveLength(CONFIG.maxRepairRounds + 1);
    expect(r.valid).toBe(false);
    expect(r.model?.parts).toHaveLength(2);
    expect(r.rounds[0].errorCodes).toEqual({ INVALID_OUTPUT: 1 });
  });
});

describe("edit mode (fake Claude)", () => {
  it("sends the current model and the change request, and records the base in debug", async () => {
    const edited = { ...SAMPLE_HOUSE, parts: [...SAMPLE_HOUSE.parts, P("brick_1x1", "white", 0, 17, 2)] };
    const { client, requests } = fakeClient([diff({ add: [P("brick_1x1", "white", 0, 17, 2)] })]);
    const r = await generateModel({ text: "add a chimney", base: SAMPLE_HOUSE }, () => {}, { client });
    dirs.push(r.debugDir);
    const first = requests[0].messages[0].content as string;
    expect(first).toContain("Change request: add a chimney");
    expect(first).toContain(`#0 ${compactCodec.formatPlacement(SAMPLE_HOUSE.parts[0])}`);
    expect(first).toContain(`Parts (${SAMPLE_HOUSE.parts.length})`);
    expect(r.valid).toBe(true);
    expect(r.model?.parts).toEqual(edited.parts);
    expect(fs.readdirSync(r.debugDir)).toContain("base-model.json");
    expect(JSON.parse(fs.readFileSync(path.join(r.debugDir, "input.json"), "utf8")).mode).toBe("edit");
  });
});

describe("structural issues in the repair loop (fake Claude)", () => {
  const overhang = JSON.stringify({ name: "Beam", description: "d", parts: [P("brick_1x1", "red", 0, 0, 0), P("brick_1x8", "blue", 0, 3, 0)] });
  const balanced = JSON.stringify({ name: "Beam", description: "d", parts: [P("brick_1x1", "red", 4, 0, 0), P("brick_1x8", "blue", 0, 3, 0)] });

  it("sends an overhang back for repair", async () => {
    void balanced;
    const { client, requests } = fakeClient([overhang, diff({ set: [{ index: 0, ...P("brick_1x1", "red", 4, 0, 0) }] })]);
    const r = await generateModel({ text: "a beam" }, () => {}, { client });
    dirs.push(r.debugDir);
    expect(r.rounds.map((x) => x.errorCodes)).toEqual([{ OVERSTRESSED: 1 }, {}]);
    expect(requests[1].messages.at(-1)!.content).toMatch(/OVERSTRESSED/);
    expect(r.valid).toBe(true);
  });

  it("accepts it as a warning if it's still there after the last round", async () => {
    const { client } = fakeClient([overhang, ...Array.from({ length: CONFIG.maxRepairRounds }, () => diff())]);
    const r = await generateModel({ text: "a beam" }, () => {}, { client });
    dirs.push(r.debugDir);
    expect(r.valid).toBe(true);
    expect(r.validation?.warnings.map((w) => w.code)).toContain("OVERSTRESSED");
  });
});

describe("parseModel", () => {
  it("reports schema problems as issues", () => {
    const r = parseModel(JSON.stringify({ name: "x", description: "x", parts: [{ part: "brick_2x2", color: "red", x: 0.5, y: 0, z: 0, rot: 45 }] }));
    expect(r.model).toBeNull();
    expect(r.issues.every((i) => i.code === "INVALID_OUTPUT")).toBe(true);
  });
});
