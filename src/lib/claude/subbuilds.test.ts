import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { generateDesign, checkPlan, resumeDesign } from "./subbuilds";
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
const photoAnalysis = {
  subject: "A small village",
  category: "scene",
  dimensions: { length: 40, width: 40, height: 12 },
  keyFeatures: ["two huts", "two pine trees", "green base"],
  colors: [{ area: "grass", color: "green" }],
  view: { azimuth: 30, elevation: 35 },
  notes: "",
};
// First assembly attempt: a hut floats above the base.
const badMain = { ...goodMain, uses: goodMain.uses.map((u, i) => (i === 1 ? { ...u, y: 5 } : u)) };

/** Top-level properties of the request's JSON output schema (tells plan / sub-build / assembly apart). */
const schemaProps = (q: Anthropic.MessageCreateParams) => ((q.output_config?.format?.schema ?? {}) as { properties?: Record<string, unknown> }).properties ?? {};

function fakeClient(opts: { failAssembly?: boolean; assemblyOk?: boolean } = {}) {
  const requests: Anthropic.MessageCreateParams[] = [];
  let assemblies = opts.assemblyOk ? 1 : 0;
  const client = {
    messages: {
      stream(params: Anthropic.MessageCreateParams) {
        requests.push(structuredClone(params));
        const props = schemaProps(params);
        const c0 = params.messages[0].content;
        const first = typeof c0 === "string" ? c0 : c0.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
        let text: string;
        if ("keyFeatures" in props) text = JSON.stringify(photoAnalysis);
        else if ("matches" in props) text = JSON.stringify({ matches: true, differences: [], changes: { name: "", description: "", changes: [], newSubBuilds: [], removeSubBuilds: [] } });
        else if ("layout" in props) text = JSON.stringify(plan);
        else if ("setCopies" in props && params.messages.length > 1) text = JSON.stringify({ name: "", description: "", remove: [], set: [], add: [], removeCopies: [], setCopies: [{ index: 1, ...goodMain.uses[1], mirror: false }], addCopies: [] });
        else if ("uses" in props) {
          if (opts.failAssembly) throw new Error("Your credit balance is too low to access the Anthropic API.");
          text = JSON.stringify(assemblies++ === 0 ? badMain : goodMain);
        }
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
    const r = await generateDesign({ text: "a tiny village", detail: "standard" }, (e) => events.push(e), { client });
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

  it("resumes an interrupted run: reuses the plan and sub-builds, runs only the assembly", async () => {
    const first = fakeClient({ failAssembly: true });
    let dir = "";
    await expect(generateDesign({ text: "a tiny village", detail: "standard" }, (e) => e.type === "start" && (dir = e.debugDir), { client: first.client })).rejects.toThrow(/credit/);
    dirs.push(dir);
    expect(first.requests).toHaveLength(4); // plan + 2 sub-builds + the failed assembly call

    const second = fakeClient({ assemblyOk: true });
    const r = await resumeDesign(dir, () => {}, { client: second.client });
    expect(r.debugDir).toBe(dir);
    expect(second.requests.map((q) => ("uses" in schemaProps(q) ? "assembly" : "other"))).toEqual(["assembly"]);
    expect(r.valid).toBe(true);
    expect(r.model!.parts).toHaveLength(2 + 2 * 7 + 2 * 5);
    expect(r.rounds.filter((x) => x.reused).map((x) => x.scope).sort()).toEqual(["plan", "sub:hut", "sub:pine_tree"]);
    const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
    expect(summary.resumed.reused).toEqual({ plan: true, subBuilds: ["hut", "pine_tree"], assembly: false });
    expect(summary.resumed.costBefore).toBeGreaterThan(0);
  });

  it("with a photo: analyses first, plans at the target size, and reuses the analysis on resume", async () => {
    const image = { mediaType: "image/jpeg" as const, data: "AAAA" };
    const first = fakeClient({ failAssembly: true });
    let dir = "";
    const events: GenerateEvent[] = [];
    await expect(generateDesign({ image, detail: "high" }, (e) => (events.push(e), e.type === "start" && (dir = e.debugDir)), { client: first.client })).rejects.toThrow(/credit/);
    dirs.push(dir);
    expect("keyFeatures" in schemaProps(first.requests[0])).toBe(true);
    const planText = (first.requests[1].messages[0].content as Anthropic.ContentBlockParam[]).flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    expect(planText).toContain("Photo analysis");
    expect(planText).toContain("16 studs wide (x)");
    expect(events.some((e) => e.type === "stage" && e.scope === "analysis" && e.status === "done")).toBe(true);

    const second = fakeClient({ assemblyOk: true });
    const r = await resumeDesign(dir, () => {}, { client: second.client });
    // Only the assembly is redone (the analysis is reused), then the finished design is compared with the photo.
    expect(second.requests.map((q) => ("uses" in schemaProps(q) ? "assembly" : "keyFeatures" in schemaProps(q) ? "analysis" : "matches" in schemaProps(q) ? "compare" : "other"))).toEqual(["assembly", "compare"]);
    expect(r.refine?.[0].matches).toBe(true);
    expect(r.analysis?.analysis.subject).toBe("A small village");
    expect(r.rounds.filter((x) => x.reused).map((x) => x.scope)).toContain("analysis");
  });

  it("refuses to resume something that isn't a sub-build run", async () => {
    await expect(resumeDesign("src")).rejects.toThrow(/input.json/);
  });

  it("rejects plans outside the limits", () => {
    expect(checkPlan({ ...plan, subBuilds: [] }).length).toBeGreaterThan(0);
    expect(checkPlan({ ...plan, subBuilds: [{ ...plan.subBuilds[0], id: "Bad Id" }] })[0].message).toMatch(/lowercase/);
    expect(checkPlan({ ...plan, subBuilds: [{ ...plan.subBuilds[0], copies: 999 }] }).map((i) => i.message).join(" ")).toMatch(/copies/);
    expect(checkPlan(plan)).toEqual([]);
  });
});

describe("debug folders", () => {
  it("two runs of the same prompt in the same second get separate folders", async () => {
    const { DebugRun } = await import("./debug");
    const a = new DebugRun("same prompt");
    const b = new DebugRun("same prompt");
    dirs.push(a.dir, b.dir);
    expect(a.dir).not.toBe(b.dir);
  });
});

describe("design edits (fake Claude)", () => {
  it("changing a sub-build once changes every copy", async () => {
    const { editDesign } = await import("./subbuilds");
    const { diffDesigns, describeDesignDiff } = await import("../design/diff");
    const { compileDesign } = await import("../design/compile");
    // The edit adds a second tip plate to the pine tree.
    const edited = {
      ...SAMPLE_VILLAGE,
      subBuilds: SAMPLE_VILLAGE.subBuilds.map((s) => (s.id === "pine_tree" ? { ...s, parts: [...s.parts, P("plate_1x1", "yellow", 0, 11, 0)] } : s)),
    };
    const requests: Anthropic.MessageCreateParams[] = [];
    const client = {
      messages: {
        stream(params: Anthropic.MessageCreateParams) {
          requests.push(structuredClone(params));
          return {
            on() {
              return this;
            },
            async finalMessage() {
              // The edit returns only the change: one part added to the pine tree sub-build.
              const change = { name: "", description: "", changes: [{ id: "pine_tree", remove: [], set: [], add: [P("plate_1x1", "yellow", 0, 11, 0)], removeCopies: [], setCopies: [], addCopies: [] }], newSubBuilds: [], removeSubBuilds: [] };
              return { content: [{ type: "text", text: JSON.stringify(change) }], stop_reason: "end_turn", stop_details: null, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
            },
          };
        },
      },
    } as unknown as Pick<Anthropic, "messages">;
    const r = await editDesign({ text: "put a star on every tree", baseDesign: SAMPLE_VILLAGE }, () => {}, { client });
    dirs.push(r.debugDir);
    const prompt = requests[0].messages[0].content as string;
    expect(prompt).toMatch(/Sub-build pine_tree "Pine tree"/);
    expect(prompt).toMatch(/Change request: put a star on every tree/);
    expect(r.valid).toBe(true);
    expect(r.design!.subBuilds).toEqual(edited.subBuilds);
    const before = compileDesign(SAMPLE_VILLAGE).stats.pieces;
    expect(r.model!.parts.length).toBe(before + 4); // 4 pine tree copies
    expect(describeDesignDiff(diffDesigns(SAMPLE_VILLAGE, r.design!))).toBe("changed Pine tree; main build unchanged");
  });
});
