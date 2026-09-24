import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { generateDesign } from "./subbuilds";
import { SAMPLE_VILLAGE } from "../fixtures/designs";
import { P } from "../fixtures/samples";

const tree = SAMPLE_VILLAGE.subBuilds.find((s) => s.id === "pine_tree")!;
const hut = SAMPLE_VILLAGE.subBuilds.find((s) => s.id === "hut")!;
const plan = {
  name: "Tiny village",
  description: "d",
  layout: "l",
  subBuilds: [
    { id: "hut", name: "Hut", purpose: "a hut", w: 4, d: 4, h: 7, parts: 7, copies: 2 },
    { id: "pine_tree", name: "Pine tree", purpose: "a tree", w: 2, d: 2, h: 11, parts: 5, copies: 2 },
  ],
};
const main = {
  name: "Tiny village",
  description: "d",
  parts: [P("plate_4x8", "green", 0, 0, 0), P("plate_4x8", "green", 0, 0, 4)],
  uses: [
    { sub: "hut", x: 0, y: 1, z: 2, rot: 0 },
    { sub: "hut", x: 4, y: 1, z: 4, rot: 90 },
    { sub: "pine_tree", x: 4, y: 1, z: 0, rot: 270 },
    { sub: "pine_tree", x: 6, y: 1, z: 0, rot: 180 },
  ],
};
const props = (q: Anthropic.MessageCreateParams) => ((q.output_config?.format?.schema ?? {}) as { properties?: Record<string, unknown> }).properties ?? {};

/** A fake that streams: its first event arrives after 10 ms, the full answer after 60 ms. */
function streamingFake() {
  const requests: Anthropic.MessageCreateParams[] = [];
  const log: string[] = [];
  const client = {
    messages: {
      stream(params: Anthropic.MessageCreateParams) {
        requests.push(structuredClone(params));
        const c0 = params.messages[0].content;
        const first = typeof c0 === "string" ? c0 : "";
        const p = props(params);
        const name = "layout" in p ? "plan" : "uses" in p ? "assembly" : first.includes('sub-build "Hut"') ? "hut" : "tree";
        log.push(`${name} sent`);
        const text = JSON.stringify(name === "plan" ? plan : name === "assembly" ? main : name === "hut" ? { name: "Hut", description: "h", parts: hut.parts } : { name: "Tree", description: "t", parts: tree.parts });
        const handlers: Record<string, (() => void)[]> = {};
        setTimeout(() => (log.push(`${name} streaming`), handlers.streamEvent?.forEach((f) => f())), 10);
        return {
          on(ev: string, fn: () => void) {
            (handlers[ev] ??= []).push(fn);
            return this;
          },
          finalMessage: () =>
            new Promise((resolve) =>
              setTimeout(() => {
                log.push(`${name} done`);
                resolve({ content: [{ type: "text", text }], stop_reason: "end_turn", stop_details: null, usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 0 } });
              }, 60),
            ),
        };
      },
    },
  } as unknown as Pick<Anthropic, "messages">;
  return { client, requests, log };
}

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe("prompt caching", () => {
  it("builders share tools, system prompt and cache; the single-call plan writes no cache", async () => {
    const { client, requests } = streamingFake();
    const r = await generateDesign({ text: "a tiny village", detail: "standard" }, () => {}, { client });
    dirs.push(r.debugDir);
    expect(requests.length).toBeGreaterThanOrEqual(4);
    const [planReq, ...builders] = requests;
    for (const q of builders) {
      expect(q.tools).toEqual(builders[0].tools);
      expect(q.system).toEqual(builders[0].system);
      expect((q.system as Anthropic.TextBlockParam[])[0].cache_control).toEqual({ type: "ephemeral" });
      expect(q.tool_choice?.type).toBe("auto");
    }
    expect(planReq.cache_control).toBeUndefined();
    expect((planReq.system as Anthropic.TextBlockParam[])[0].cache_control).toBeUndefined();
    const summary = JSON.parse(fs.readFileSync(`${r.debugDir}/summary.json`, "utf8"));
    expect(summary.cache).toEqual({ read: 90 * requests.length, write: 0, uncached: 10 * requests.length, hitRate: 0.9 });
  });

  it("starts the other sub-builds once the first one is streaming (its prompt is cached), not all at once", async () => {
    const { client, log } = streamingFake();
    const r = await generateDesign({ text: "a tiny village", detail: "standard" }, () => {}, { client });
    dirs.push(r.debugDir);
    const at = (e: string) => log.indexOf(e);
    expect(at("tree sent")).toBeGreaterThan(at("hut streaming"));
    expect(at("tree sent")).toBeLessThan(at("hut done")); // still in parallel
  });
});
