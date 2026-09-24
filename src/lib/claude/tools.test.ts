import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { generateModel, type GenerateEvent } from "./generate";
import { searchPartsTool } from "./tools";
import { P } from "../fixtures/samples";
import { mountsFor } from "../parts/wheels";

// A small car made of catalog parts, as Claude would return it after searching.
const h1 = P("4600", "black", 2, 2, 1), h2 = P("4600", "black", 2, 2, 7);
const car = {
  name: "Small red car",
  description: "A red car on four small wheels.",
  parts: [
    h1,
    h2,
    P("plate_2x8", "dark_gray", 2, 3, 1, 90),
    P("plate_2x8", "red", 2, 4, 1, 90),
    P("plate_4x8", "red", 1, 5, 1, 90),
    ...[h1, h2].flatMap((h) => mountsFor(h, "4624c01").map((m) => ({ ...P("4624c01", "white", 0, 0, 0), ...m.at }))),
  ],
};

const usage = { input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
function fakeClient() {
  const requests: Anthropic.MessageCreateParams[] = [];
  const client = {
    messages: {
      stream(params: Anthropic.MessageCreateParams) {
        requests.push(structuredClone(params));
        const first = requests.length === 1;
        const content = first
          ? [{ type: "tool_use", id: "toolu_1", name: "search_parts", input: { query: "plate with wheel pins" } }]
          : [{ type: "text", text: JSON.stringify(car) }];
        return {
          on() {
            return this;
          },
          async finalMessage() {
            return { content, stop_reason: first ? "tool_use" : "end_turn", stop_details: null, usage };
          },
        };
      },
    },
  };
  return { client: client as unknown as Pick<Anthropic, "messages">, requests };
}

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe("search_parts tool in the generation loop", () => {
  it("answers Claude's search, continues the same round, and logs catalog use", async () => {
    const { client, requests } = fakeClient();
    const events: GenerateEvent[] = [];
    const r = await generateModel({ text: "a small red car", size: "small" }, (e) => events.push(e), { client });
    dirs.push(r.debugDir);
    expect(requests).toHaveLength(2);
    expect(requests[0].tools?.map((t) => (t as Anthropic.Tool).name)).toEqual(["search_parts"]);
    // The second call carries Claude's tool call and our result, which lists the wheel-pin plate.
    const reply = requests[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    expect(reply[0].type).toBe("tool_result");
    expect(String(reply[0].content)).toContain("| 4600 |");
    expect(events.some((e) => e.type === "tool" && e.summary.includes("4600"))).toBe(true);
    // One round, both calls' tokens counted, the car is valid.
    expect(r.valid).toBe(true);
    expect(r.rounds).toHaveLength(1);
    expect(r.rounds[0].toolCalls).toBe(1);
    expect(r.rounds[0].usage.output).toBe(400);
    const summary = JSON.parse(fs.readFileSync(`${r.debugDir}/summary.json`, "utf8"));
    expect(summary.catalog.parts).toEqual({ "4600": 2, "4624c01": 4 });
    expect(fs.existsSync(`${r.debugDir}/round-0.tools.json`)).toBe(true);
  });

  it("returns a part table for a query and handles no matches", () => {
    expect(searchPartsTool.run({ query: "windscreen 2x4" }).text).toContain("| 3823 |");
    expect(searchPartsTool.run({ query: "zzzz" }).text).toMatch(/No parts match/);
  });
});
