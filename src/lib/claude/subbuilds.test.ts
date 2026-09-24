import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { generateDesign, checkPlan } from "./subbuilds";
import type { GenerateEvent } from "./generate";
import { SAMPLE_VILLAGE } from "../fixtures/designs";
import { P } from "../fixtures/samples";

const tree = SAMPLE_VILLAGE.subBuilds.find((s) => s.id === "pine_tree")!;
const hut = SAMPLE_VILLAGE.subBuilds.find((s) => s.id === "hut")!;
const plan = {
  name: "Tiny village",
  description: "Two huts and two pine trees on a green base.",
  layout: "8×8 base of two 4×8 plates; hut 1 across the seam, hut 2 rotated at the back right; trees in the front.",
  subBuilds: [
    { id: "hut", name: "Hut", purpose: "a small tan hut with a red roof", w: 4, d: 4, h: 7, parts: 7, copies: 2 },
    { id: "pine_tree", name: "Pine tree", purpose: "a pine tree", w: 2, d: 2, h: 11, parts: 5, copies: 2 },
  ],
};
const goodMain = {
  name: "Tiny village",
  description: "Two huts and two pine trees.",
  parts: [P("plate_4x8", "green", 0, 0, 0), P("plate_4x8", "green", 0, 0, 4)],
  uses: [
    { sub: "hut", x: 0, y: 1, z: 2, rot: 0 },
    { sub: "hut", x: 4, y: 1, z: 4, rot: 90 },
    { sub: "pine_tree", x: 4, y: 1, z: 0, rot: 270 },
    { sub: "pine_tree", x: 6, y: 1, z: 0, rot: 180 },
  ],
};
// First assembly attempt: a hut floats above the base.
const badMain = { ...goodMain, uses: goodMain.uses.map((u, i) => (i === 1 ? { ...u, y: 5 } : u)) };

/** Top-level properties of the request's JSON output schema (tells plan / sub-build / assembly apart). */
const schemaProps = (q: Anthropic.MessageCreateParams) => ((q.output_config?.format?.schema ?? {}) as { properties?: Record<string, unknown> }).properties ?? {};

function fakeClient() {
  const requests: Anthropic.MessageCreateParams[] = [];
  let assemblies = 0;
  const client = {
    messages: {
      stream(params: Anthropic.MessageCreateParams) {
        requests.push(structuredClone(params));
        const props = schemaProps(params);
        const first = params.messages[0].content as string;
        let text: string;
        if ("layout" in props) text = JSON.stringify(plan);
        else if ("uses" in props) text = JSON.stringify(assemblies++ === 0 ? badMain : goodMain);
        else if (first.includes('sub-build "Hut"')) text = JSON.stringify({ name: "Hut", description: "hut", parts: hut.parts });
        else text = JSON.stringify({ name: "Pine tree", description: "tree", parts: tree.parts });
        return {
          on() {
            return this;
          },
          async finalMessage() {
            return { content: [{ type: "text", text }], stop_reason: "end_turn", stop_details: null, usage: { input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
          },
        };
      },
    },
  };
  return { client: client as unknown as Pick<Anthropic, "messages">, requests };
}

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe("sub-build generator (fake Claude)", () => {
  it("plans, designs each sub-build once, assembles, repairs the assembly and compiles", async () => {
    const { client, requests } = fakeClient();
    const events: GenerateEvent[] = [];
    const r = await generateDesign({ text: "a tiny village", size: "small" }, (e) => events.push(e), { client });
    dirs.push(r.debugDir);

    expect(r.pipeline).toBe("subbuilds");
    expect(r.valid).toBe(true);
    // plan + 2 unique sub-builds + 2 assembly rounds (the first had a floating hut)
    expect(requests).toHaveLength(5);
    expect(r.rounds.map((x) => x.scope).sort()).toEqual(["assembly", "assembly", "plan", "sub:hut", "sub:pine_tree"]);
    const repair = requests.at(-1)!.messages.at(-1)!.content as string;
    expect(repair).toMatch(/DETACHED_SUBBUILD|SUBBUILD_UNSUPPORTED|FLOATING/);
    // The assembly prompt describes each finished sub-build's outside.
    expect(requests.find((q) => "uses" in schemaProps(q))!.messages[0].content).toMatch(/top surface/);

    expect(r.model!.parts).toHaveLength(2 + 2 * 7 + 2 * 5);
    expect(r.compile!.stats).toMatchObject({ uniqueSubBuilds: 2, copies: 4, errors: 0 });
    expect(r.design!.subBuilds.map((s) => s.id).sort()).toEqual(["hut", "pine_tree"]);
    expect(events.filter((e) => e.type === "stage" && e.status === "done").map((e) => (e as { scope: string }).scope).sort()).toEqual(["assembly", "plan", "sub:hut", "sub:pine_tree"]);
    const files = fs.readdirSync(r.debugDir);
    for (const f of ["plan.json", "final-design.json", "final-model.json", "summary.json", "sub-hut.round-0.model.json", "assembly.round-1.validation.json"]) expect(files).toContain(f);
    expect(JSON.parse(fs.readFileSync(path.join(r.debugDir, "summary.json"), "utf8")).stages.subBuilds).toHaveLength(2);
  });

  it("rejects plans outside the limits", () => {
    expect(checkPlan({ ...plan, subBuilds: [] }).length).toBeGreaterThan(0);
    expect(checkPlan({ ...plan, subBuilds: [{ ...plan.subBuilds[0], id: "Bad Id" }] })[0].message).toMatch(/lowercase/);
    expect(checkPlan({ ...plan, subBuilds: [{ ...plan.subBuilds[0], copies: 999 }] }).map((i) => i.message).join(" ")).toMatch(/copies/);
    expect(checkPlan(plan)).toEqual([]);
  });
});
