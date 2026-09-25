import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { generateDesign, resumeDesign } from "./subbuilds";
import { simulatedClient, TownScript } from "./simulated";
import { checkChildPlan, PlanTree } from "./tree";
import type { GenerateEvent } from "./generate";
import { compileDesign } from "../design/compile";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
/** A fresh, empty component library folder. */
const emptyLibrary = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "brickforge-lib-"));
  dirs.push(d);
  return d;
};

describe("sub-build trees (simulated Claude)", () => {
  it("plans the town square 3 levels deep, designs each leaf once, assembles each level and compiles", async () => {
    const effort: Record<string, string[]> = {};
    const client = simulatedClient({ onRequest: (q, kind) => (effort[kind] ??= []).push(q.output_config?.effort ?? "") });
    const events: GenerateEvent[] = [];
    const r = await generateDesign({ text: "a town square", detail: "very_high" }, (e) => events.push(e), { client, library: emptyLibrary() });
    dirs.push(r.debugDir);

    expect(r.valid).toBe(true);
    const stats = r.compile!.stats;
    expect(stats.uniqueSubBuilds).toBeGreaterThanOrEqual(45);
    expect(stats.copies).toBeGreaterThanOrEqual(100);
    expect(stats.errors).toBe(0);
    // 3 levels of sub-builds below the main build.
    const depth = (n: { children: { children: unknown[] }[] }): number => 1 + Math.max(0, ...n.children.map((c) => depth(c as never)));
    expect(depth(r.compile!.tree as never) - 1).toBe(3);

    // One call per unique leaf (the shared window is designed once), one per split sub-build's plan and assembly.
    const calls = client.requests.map((q) => q.kind);
    const count = (k: string) => calls.filter((c) => c === k).length;
    const script = new TownScript();
    const splits = [...script.byName.values()].filter((n) => "children" in n).length;
    const leaves = new Set([...script.byName.values()].filter((n) => !("children" in n)).map((n) => n.id)).size;
    expect(count("plan")).toBe(1);
    expect(count("childPlan")).toBe(splits);
    expect(count("leaf")).toBe(leaves);
    expect(count("subAssembly") + count("assembly")).toBe(splits + 1);
    expect(client.requests.filter((q) => q.name === "Small window" && q.kind === "leaf")).toHaveLength(1);

    // Small sub-assemblies run at medium; large ones, the main assembly, plans at high; leaves at medium.
    expect(new Set(effort.subAssembly)).toEqual(new Set(["medium"]));
    expect(new Set(effort.assembly)).toEqual(new Set(["high"]));
    expect(new Set([...effort.plan, ...effort.childPlan])).toEqual(new Set(["high"]));
    expect(new Set(effort.leaf)).toEqual(new Set(["medium"]));

    // Stage events for every level, with depth.
    const done = events.filter((e): e is Extract<GenerateEvent, { type: "stage" }> => e.type === "stage" && e.status === "done");
    expect(done.filter((e) => e.scope.startsWith("plan:")).length).toBe(splits);
    expect(done.find((e) => e.scope === "asm:house_facade")).toMatchObject({ valid: true, depth: 2, copies: 8 });
    expect(done.find((e) => e.scope === "sub:window_small")).toMatchObject({ depth: 3, copies: 26 });

    const summary = JSON.parse(fs.readFileSync(path.join(r.debugDir, "summary.json"), "utf8"));
    expect(summary.stages.tree).toMatchObject({ depth: 3 });
    expect(summary.stages.childPlans).toHaveLength(splits);
    expect(summary.stages.subAssemblies).toHaveLength(splits);
    expect(fs.existsSync(path.join(r.debugDir, "tree.json"))).toBe(true);
    // The saved design compiles to the same model.
    const again = compileDesign(r.design!);
    expect(again.stats.pieces).toBe(r.model!.parts.length);
  });

  it("repairs a sub-assembly at its own level (join checks per level)", async () => {
    const client = simulatedClient({ failFirst: ["Market stall", "Tree canopy"] });
    const r = await generateDesign({ text: "a town square", detail: "very_high" }, () => {}, { client, library: emptyLibrary() });
    dirs.push(r.debugDir);
    expect(r.valid).toBe(true);
    const repairs = r.rounds.filter((x) => x.round > 0).map((x) => x.scope).sort();
    expect(repairs).toEqual(["asm:market_stall", "sub:tree_canopy"]);
    const first = JSON.parse(fs.readFileSync(path.join(r.debugDir, "asm-market_stall.round-0.validation.json"), "utf8"));
    expect(first.errors.map((e: { code: string }) => e.code).join(" ")).toMatch(/SUBBUILD|FLOATING/);
  });

  it("resumes an interrupted tree run: reuses the plans, leaves and sub-assemblies that passed", async () => {
    let calls = 0;
    const failing = simulatedClient();
    const flaky = {
      messages: {
        stream(params: Anthropic.MessageCreateParams) {
          if (++calls > 40) throw new Error("Your credit balance is too low to access the Anthropic API.");
          return failing.messages.stream(params);
        },
      },
    } as unknown as Pick<Anthropic, "messages">;
    let dir = "";
    const library = emptyLibrary();
    await expect(generateDesign({ text: "a town square", detail: "very_high" }, (e) => e.type === "start" && (dir = e.debugDir), { client: flaky, library })).rejects.toThrow(/credit/);
    dirs.push(dir);

    const second = simulatedClient();
    const r = await resumeDesign(dir, () => {}, { client: second, library });
    expect(r.valid).toBe(true);
    // Every call of the first run passed, so the resumed run makes only the rest.
    const script = new TownScript();
    const splits = [...script.byName.values()].filter((n) => "children" in n).length;
    const leaves = new Set([...script.byName.values()].filter((n) => !("children" in n)).map((n) => n.id)).size;
    expect(second.requests.length).toBe(1 + splits + leaves + splits + 1 - 40);
    // Nothing that passed before is asked again.
    expect(second.requests.filter((q) => q.kind === "plan")).toHaveLength(0);
    expect(r.rounds.filter((x) => x.reused).length).toBe(40);
    expect(r.compile!.stats.uniqueSubBuilds).toBeGreaterThanOrEqual(45);
  });
});

describe("child plan checks", () => {
  const plan = { name: "t", description: "", layout: "", subBuilds: [{ id: "house", name: "House", purpose: "", w: 8, d: 8, h: 20, parts: 100, copies: 2, split: true }] };
  const lib = { library: new Map(), uniqueLeft: 10, copiesLeft: 100 };
  const kid = (o: Record<string, unknown> = {}) => ({ id: "window", name: "Window", purpose: "", w: 2, d: 1, h: 6, parts: 5, copies: 4, split: false, from: "new", recolor: [], ...o });

  it("accepts a plan within the parent and the limits", () => {
    const tree = new PlanTree(structuredClone(plan));
    expect(checkChildPlan(tree, tree.get("house"), { layout: "", children: [kid()] }, lib)).toEqual([]);
  });

  it("rejects children bigger than the parent, over its budget, too deep, or over the tree's limits", () => {
    const tree = new PlanTree(structuredClone(plan));
    const house = tree.get("house");
    const msg = (c: ReturnType<typeof kid>[], o = lib) => checkChildPlan(tree, house, { layout: "", children: c }, o).map((i) => i.message).join(" | ");
    expect(msg([kid({ w: 9 })])).toMatch(/fit inside/);
    expect(msg([kid({ parts: 30 })])).toMatch(/budget of 100/);
    expect(msg([kid()], { ...lib, uniqueLeft: 0 })).toMatch(/at most 0/);
    expect(msg([kid()], { ...lib, copiesLeft: 7 })).toMatch(/copies/);
    expect(msg([kid({ from: "shared" })])).toMatch(/already planned/);
    house.depth = 2;
    expect(msg([kid({ split: true, parts: 10, copies: 1 })])).toMatch(/can't be split further/);
  });

  it("merges the same leaf planned by two parents and renames a clashing id", () => {
    const p = structuredClone(plan);
    p.subBuilds.push({ ...p.subBuilds[0], id: "tower", name: "Tower" });
    const tree = new PlanTree(p);
    tree.addLevel([
      { parent: "house", child: { layout: "", children: [kid()] } },
      { parent: "tower", child: { layout: "", children: [kid({ copies: 2 }), kid({ id: "door", h: 9, copies: 1 })] } },
    ]);
    expect(tree.get("window").uses).toEqual([
      { parent: "house", copies: 4 },
      { parent: "tower", copies: 2 },
    ]);
    expect(tree.totalCopies("window")).toBe(12);
    tree.addLevel([]);
    const t2 = new PlanTree(structuredClone(p));
    t2.addLevel([
      { parent: "house", child: { layout: "", children: [kid()] } },
      { parent: "tower", child: { layout: "", children: [kid({ w: 1 })] } },
    ]);
    expect([...t2.nodes.keys()]).toContain("window_2");
  });
});
