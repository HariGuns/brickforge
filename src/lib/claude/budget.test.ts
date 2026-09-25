import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Budget, BudgetExceeded } from "./budget";
import { generateDesign, resumeDesign } from "./subbuilds";
import { generateModel, type GenerateEvent } from "./generate";
import { simulatedClient } from "./simulated";
import { loadLibrary } from "../components/library";
import { roundsIn } from "./breakdown";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const emptyLibrary = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "brickforge-lib-"));
  dirs.push(d);
  return d;
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("budget", () => {
  it("reserves each call's estimate and refuses one that would go over the cap", () => {
    const b = new Budget(0.3);
    const a = b.reserve("sub:a", "subBuild"); // default estimate 0.12
    const c = b.reserve("sub:b", "subBuild");
    // 0.24 reserved: a third one (0.12) would make 0.36.
    expect(() => b.reserve("sub:c", "subBuild")).toThrow(BudgetExceeded);
    a.settle(0.05);
    c.settle(0.05);
    expect(b.spent).toBeCloseTo(0.1);
    expect(() => b.reserve("sub:c", "subBuild")).not.toThrow();
    // Estimates grow with what calls really cost.
    const big = new Budget(null);
    big.reserve("assembly", "assembly").settle(2);
    expect(big.estimate("assembly")).toBe(2.5);
    expect(new Budget(null).left()).toBeNull();
    // A failed call gives its reservation back.
    const f = new Budget(0.2);
    f.reserve("x", "subBuild").release();
    expect(() => f.reserve("y", "subBuild")).not.toThrow();
  });

  it("stops a tree run before the cap, saves what's valid, and resumes under a higher cap", async () => {
    const library = emptyLibrary();
    const events: GenerateEvent[] = [];
    let dir = "";
    const cap = 1.5;
    const err = await generateDesign({ text: "a town square", detail: "very_high" }, (e) => (events.push(e), e.type === "start" && (dir = e.debugDir)), { client: simulatedClient(), library, budget: cap }).catch((e) => e);
    dirs.push(dir);
    expect(err).toBeInstanceOf(BudgetExceeded);
    expect(err.message).toMatch(/Budget cap \$1\.50 reached/);
    expect(err.message).toMatch(/npm run gen -- --resume .* --budget 3/);
    // Never over the cap: every call that ran fits under it.
    const spent = sum(roundsIn(dir).map((r) => r.usage.cost));
    expect(spent).toBeLessThanOrEqual(cap);
    expect(spent).toBeGreaterThan(cap * 0.7);
    const stop = events.find((e) => e.type === "budget") as Extract<GenerateEvent, { type: "budget" }>;
    expect(stop.spent).toBeCloseTo(spent, 6);
    const stopped = JSON.parse(fs.readFileSync(path.join(dir, "stopped.json"), "utf8"));
    expect(stopped).toMatchObject({ reason: "budget", cap });
    expect(stopped.breakdown.total).toBeCloseTo(spent, 3);
    // The valid sub-builds designed before the stop are in the library.
    expect(stop.savedComponents).toBeGreaterThan(0);
    expect(loadLibrary(library).components.length).toBe(stop.savedComponents);

    // Resume: earlier spending counts toward the new cap, and only the rest is run.
    const second = simulatedClient();
    const r = await resumeDesign(dir, () => {}, { client: second, library, budget: 10 });
    expect(r.valid).toBe(true);
    expect(r.costBreakdown!.budget!.spent).toBeGreaterThan(spent);
    expect(r.costBreakdown!.budget!.spent).toBeLessThanOrEqual(10);
  });

  it("breaks the cost down by level, kind and new vs reused components", async () => {
    const r = await generateDesign({ text: "a town square", detail: "very_high" }, () => {}, { client: simulatedClient(), library: emptyLibrary() });
    dirs.push(r.debugDir);
    const b = r.costBreakdown!;
    expect(Object.keys(b.byLevel).sort()).toEqual(["0", "1", "2", "3"]);
    expect(sum(Object.values(b.byLevel).map((l) => l.cost))).toBeCloseTo(b.total, 3);
    expect(sum(Object.values(b.byKind))).toBeCloseTo(b.total, 3);
    expect(b.total).toBeCloseTo(r.usage.cost, 3);
    expect(b.byLevel["0"].calls).toBe(2); // plan + main assembly
    expect(b.components.new.count).toBe(r.compile!.stats.uniqueSubBuilds);
    expect(b.components.reused).toEqual({ count: 0, copies: 0, saved: 0 });
    expect(b.budget).toEqual({ cap: null, spent: expect.any(Number) });
    const summary = JSON.parse(fs.readFileSync(path.join(r.debugDir, "summary.json"), "utf8"));
    expect(summary.costBreakdown.byLevel).toEqual(b.byLevel);
  });

  it("the single pass stops before a call that would go over the cap", async () => {
    const client = simulatedClient();
    const err = await generateModel({ text: "a house" }, () => {}, { client, budget: 0.05 }).catch((e) => e);
    expect(err).toBeInstanceOf(BudgetExceeded);
    expect(client.requests).toHaveLength(0);
  });
});
