import { describe, expect, it } from "vitest";
import { buildSteps, checkStepOrder } from "./steps";
import { validate } from "../validate/validator";
import { P, SAMPLE_HOUSE } from "../fixtures/samples";
import type { BrickModel } from "../model/schema";

describe("build steps", () => {
  it("orders the sample house bottom-up with every part supported by an earlier step", () => {
    const v = validate(SAMPLE_HOUSE);
    const steps = buildSteps(SAMPLE_HOUSE);
    expect(checkStepOrder(SAMPLE_HOUSE, v.connections, steps)).toEqual([]);
    expect(steps.flatMap((s) => s.parts).sort((a, b) => a - b)).toEqual(SAMPLE_HOUSE.parts.map((_, i) => i));
    const ys = steps.map((s) => s.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });

  it("handles parts listed top-down in the input", () => {
    const m: BrickModel = {
      name: "t",
      description: "t",
      parts: [P("brick_2x2", "red", 0, 6, 0), P("brick_2x2", "red", 0, 3, 0), P("brick_2x2", "red", 0, 0, 0)],
    };
    const steps = buildSteps(m);
    expect(steps.map((s) => s.parts)).toEqual([[2], [1], [0]]);
    expect(checkStepOrder(m, validate(m).connections, steps)).toEqual([]);
  });

  it("splits big layers into balanced steps", () => {
    const parts = Array.from({ length: 7 }, (_, i) => P("brick_1x1", "red", i, 0, 0));
    const steps = buildSteps({ name: "t", description: "t", parts }, { maxPerStep: 6 });
    expect(steps.map((s) => s.parts.length)).toEqual([4, 3]);
  });

  it("checkStepOrder catches a part placed before its support", () => {
    const m: BrickModel = { name: "t", description: "t", parts: [P("brick_2x2", "red", 0, 0, 0), P("brick_2x2", "red", 0, 3, 0)] };
    const conns = validate(m).connections;
    expect(checkStepOrder(m, conns, [{ n: 1, parts: [1], y: 3 }, { n: 2, parts: [0], y: 0 }])).toEqual([1]);
  });
});
