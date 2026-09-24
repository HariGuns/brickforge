import { describe, expect, it } from "vitest";
import { validate } from "./validator";
import { analyzeStructure, partMass } from "./structure";
import { getPart } from "../parts/library";
import { P, SAMPLE_HOUSE } from "../fixtures/samples";
import { SAMPLE_VILLAGE } from "../fixtures/designs";
import { compileDesign } from "../design/compile";
import type { BrickModel, Placement } from "../model/schema";

const model = (...parts: Placement[]): BrickModel => ({ name: "t", description: "t", parts });
const structural = (m: BrickModel) => validate(m).warnings.filter((w) => w.code === "WEAK_JOINT" || w.code === "OVERSTRESSED");
const B24 = partMass(getPart("brick_2x4")!);

describe("structure: mass and load", () => {
  it("a 2×4 brick weighs about 2.3 g", () => {
    expect(B24).toBeCloseTo(2.32, 1);
  });
  it("load flows down a stack", () => {
    const m = model(P("brick_2x4", "red", 0, 0, 0), P("brick_2x4", "red", 0, 3, 0), P("brick_2x4", "red", 0, 6, 0));
    const v = validate(m);
    const r = analyzeStructure(m, v.connections);
    const load = (lower: number, upper: number) => r.joints.find((j) => j.lower === lower && j.upper === upper)!.loadG;
    expect(load(1, 2)).toBeCloseTo(B24, 1);
    expect(load(0, 1)).toBeCloseTo(2 * B24, 1);
    expect(r.parts[0].carriedG).toBeCloseTo(3 * B24, 1);
    expect(r.totalMassG).toBeCloseTo(3 * B24, 0);
  });
  it("a bridge splits its load between its supports by stud count", () => {
    const m = model(P("brick_2x2", "red", 0, 0, 0), P("brick_2x2", "red", 2, 0, 0), P("brick_2x4", "blue", 0, 3, 0));
    const r = analyzeStructure(m, validate(m).connections);
    expect(r.joints.map((j) => j.loadG)).toEqual([B24 / 2, B24 / 2].map((x) => Math.round(x * 100) / 100));
  });
});

describe("structure: weak joints and overhangs", () => {
  it("flags a tall 1×1 tower held by one stud, once, at its base", () => {
    const m = model(P("plate_2x2", "green", 0, 0, 0), ...[0, 1, 2, 3, 4].map((k) => P("brick_1x1", "red", 0, 1 + 3 * k, 0)));
    const w = structural(m);
    expect(w.map((x) => x.code)).toEqual(["WEAK_JOINT"]);
    expect(w[0].parts[0]).toBe(1);
    expect(w[0].message).toMatch(/stack 15 plates tall/);
  });
  it("doesn't flag a single-stud part that's tied in above (a bonded wall)", () => {
    // 1x1 at the base of a wall, capped by a brick that also rests on a neighbour.
    const m = model(P("brick_2x4", "red", 0, 0, 0), P("brick_1x1", "red", 0, 3, 0), P("brick_1x1", "red", 0, 6, 0), P("brick_1x1", "red", 0, 9, 0), P("brick_1x1", "red", 0, 12, 0),
      P("brick_2x2", "red", 2, 3, 0), P("brick_2x2", "red", 2, 6, 0), P("brick_2x2", "red", 2, 9, 0), P("brick_2x2", "red", 2, 12, 0), P("brick_2x4", "blue", 0, 15, 0));
    expect(structural(m)).toEqual([]);
  });
  it("doesn't flag a short trunk (a pine tree)", async () => {
    const r = compileDesign(SAMPLE_VILLAGE);
    expect(r.errors).toEqual([]);
    expect(r.warnings.filter((x) => x.code === "WEAK_JOINT" || x.code === "OVERSTRESSED")).toEqual([]);
  });
  it("flags a long overhang held at one end, but not the same beam balanced on its middle", () => {
    const end = structural(model(P("brick_1x1", "red", 0, 0, 0), P("brick_1x8", "blue", 0, 3, 0)));
    expect(end.map((x) => x.code)).toEqual(["OVERSTRESSED"]);
    expect(end[0].message).toMatch(/3 studs beyond the 1 stud/);
    expect(structural(model(P("brick_1x1", "red", 4, 0, 0), P("brick_1x8", "blue", 0, 3, 0)))).toEqual([]);
  });
  it("flags a heavy load on a single stud", () => {
    const m = model(P("brick_1x1", "red", 1, 0, 1), P("brick_2x4", "blue", 0, 3, 0), P("brick_2x4", "blue", 0, 6, 0), P("brick_2x4", "blue", 0, 9, 0));
    expect(structural(m).map((x) => x.code)).toContain("WEAK_JOINT");
  });
  it("a well-bonded house and a woven benchmark town pass", async () => {
    expect(structural(SAMPLE_HOUSE)).toEqual([]);
    const { benchDesign } = await import("../design/bench");
    const r = compileDesign(benchDesign(2));
    expect(r.errors).toEqual([]);
    expect(r.warnings.filter((x) => x.code === "WEAK_JOINT" || x.code === "OVERSTRESSED")).toEqual([]);
  });
  it("repair rounds can treat structural issues as errors", () => {
    const m = model(P("brick_1x1", "red", 0, 0, 0), P("brick_1x8", "blue", 0, 3, 0));
    expect(validate(m).valid).toBe(true);
    const strict = validate(m, { structure: "error" });
    expect(strict.valid).toBe(false);
    expect(strict.errors.map((e) => e.code)).toEqual(["OVERSTRESSED"]);
    expect(validate(m, { structure: "off" }).structure).toBeUndefined();
  });
  it("runs only once the basic checks pass", () => {
    const m = model(P("brick_2x2", "red", 0, 0, 0), P("brick_2x2", "red", 0, 9, 0));
    expect(validate(m).structure).toBeUndefined();
  });
});
