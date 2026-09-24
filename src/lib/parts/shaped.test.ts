import { describe, expect, it } from "vitest";
import { validate } from "../validate/validator";
import { P } from "../fixtures/samples";
import { PART_SHOWCASE } from "../fixtures/showcase";
import { exportLdr } from "../ldraw/export";
import { importLdr } from "../ldraw/import";
import { buildSteps } from "../steps/steps";
import type { BrickModel, Placement } from "../model/schema";

const model = (...parts: Placement[]): BrickModel => ({ name: "t", description: "t", parts });
const codes = (m: BrickModel) => validate(m).errors.map((e) => e.code).sort();
const key = (p: Placement) => `${p.part}|${p.color}|${p.x}|${p.y}|${p.z}|${p.rot}`;

describe("shaped parts", () => {
  it("the showcase of every new part is valid", () => {
    const v = validate(PART_SHOWCASE);
    expect(v.errors).toEqual([]);
  });

  it("an arch leaves a 2-plate opening that doesn't connect", () => {
    const base = [P("plate_1x4", "red", 0, 0, 0), P("arch_1x4", "tan", 0, 1, 0)];
    // Two plates fit inside the opening, standing on the base.
    expect(codes(model(...base, P("plate_1x2", "blue", 1, 1, 0), P("plate_1x2", "blue", 1, 2, 0)))).toEqual([]);
    // A third one hits the arch's top.
    expect(codes(model(...base, P("plate_1x2", "blue", 1, 1, 0), P("plate_1x2", "blue", 1, 2, 0), P("plate_1x2", "blue", 1, 3, 0)))).toContain("OVERLAP");
    // The arch's span doesn't take studs: an arch resting only on a middle pillar floats.
    expect(codes(model(P("brick_1x2", "red", 1, 0, 0), P("arch_1x4", "tan", 0, 3, 0)))).toContain("FLOATING");
  });

  it("rotated arches keep their legs at the ends", () => {
    const m = model(P("plate_1x4", "red", 0, 0, 0, 90), P("arch_1x4", "tan", 0, 1, 0, 90));
    expect(validate(m).connections).toEqual([{ lower: 0, upper: 1, studs: 2, kind: "stud" }]);
  });

  it("the door takes studs on its two middle cells only", () => {
    const door = [P("plate_1x4", "red", 0, 0, 0), P("door_1x4x6", "reddish_brown", 0, 1, 0)];
    expect(codes(model(...door, P("plate_1x1", "red", 1, 19, 0)))).toEqual([]);
    expect(codes(model(...door, P("plate_1x1", "red", 0, 19, 0)))).toContain("FLOATING");
  });

  it("nothing attaches to the top of a 2×2×2 cone", () => {
    expect(codes(model(P("cone_2x2x2", "green", 0, 0, 0), P("plate_2x2", "red", 0, 6, 0)))).toContain("FLOATING");
  });

  it("the door exports as frame + door and imports back as one part", () => {
    const m = model(P("plate_1x4", "red", 0, 0, 0), P("door_1x4x6", "reddish_brown", 0, 1, 0, 90));
    const ldr = exportLdr(m, buildSteps(m));
    expect(ldr.split(/\r\n/).filter((l) => l.startsWith("1 "))).toHaveLength(3);
    expect(ldr).toContain("60616a.dat");
    const back = importLdr(ldr);
    expect(back.skipped).toEqual([]);
    expect(back.model.parts.map(key).sort()).toEqual(m.parts.map(key).sort());
  });
});
