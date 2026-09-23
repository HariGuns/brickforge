import { describe, expect, it } from "vitest";
import { validate } from "./validator";
import { P, SAMPLE_HOUSE, SAMPLE_STACK } from "../fixtures/samples";
import type { BrickModel, Placement } from "../model/schema";

const model = (...parts: Placement[]): BrickModel => ({ name: "t", description: "t", parts });
const codes = (m: BrickModel) => validate(m).errors.map((e) => e.code).sort();

describe("validator: valid models", () => {
  it("accepts the sample house", () => {
    const r = validate(SAMPLE_HOUSE);
    expect(r.errors).toEqual([]);
    expect(r.components).toHaveLength(1);
  });
  it("accepts an offset stack and counts studs", () => {
    const r = validate(SAMPLE_STACK);
    expect(r.valid).toBe(true);
    expect(r.connections).toEqual([{ lower: 0, upper: 1, studs: 4 }]);
  });
  it("accepts a single part on the ground", () => {
    expect(validate(model(P("brick_2x2", "red", 0, 0, 0))).valid).toBe(true);
  });
  it("accepts a bridge between two pillars", () => {
    const m = model(P("brick_1x1", "red", 0, 0, 0), P("brick_1x1", "red", 3, 0, 0), P("plate_1x4", "red", 0, 3, 0));
    expect(validate(m).valid).toBe(true);
  });
  it("respects rotation when connecting", () => {
    // 1x4 rotated 90 occupies x=0, z=0..3; a 1x1 on top at z=3 connects.
    const m = model(P("brick_1x4", "red", 0, 0, 0, 90), P("brick_1x1", "blue", 0, 3, 3));
    expect(validate(m).valid).toBe(true);
  });
});

describe("validator: overlaps", () => {
  it("detects two parts in the same space", () => {
    const m = model(P("brick_2x4", "red", 0, 0, 0), P("brick_2x2", "blue", 2, 1, 0));
    const r = validate(m);
    expect(r.errors.find((e) => e.code === "OVERLAP")?.parts).toEqual([0, 1]);
  });
  it("detects overlap caused by rotation", () => {
    const m = model(P("brick_1x4", "red", 0, 0, 0), P("brick_1x4", "red", 1, 0, 0, 90));
    expect(codes(m)).toContain("OVERLAP");
  });
  it("touching side by side is not an overlap", () => {
    const m = model(P("brick_2x2", "red", 0, 0, 0), P("brick_2x2", "red", 2, 0, 0), P("plate_2x4", "red", 0, 3, 0));
    expect(validate(m).valid).toBe(true);
  });
  it("slopes occupy their full bounding box", () => {
    const m = model(P("slope45_2x2", "red", 0, 0, 0), P("plate_1x2", "red", 0, 2, 1));
    expect(codes(m)).toContain("OVERLAP");
  });
});

describe("validator: floating and disconnected", () => {
  it("flags a part hovering in the air", () => {
    const m = model(P("brick_2x2", "red", 0, 0, 0), P("brick_2x2", "red", 0, 5, 0));
    const r = validate(m);
    expect(r.errors.map((e) => e.code)).toEqual(["FLOATING"]);
    expect(r.errors[0].parts).toEqual([1]);
  });
  it("flags a part that is merely adjacent (no stud connection)", () => {
    const m = model(P("brick_2x2", "red", 0, 0, 0), P("brick_2x2", "red", 0, 3, 0), P("brick_1x1", "red", 2, 3, 0));
    const r = validate(m);
    expect(r.errors.find((e) => e.code === "FLOATING")?.parts).toEqual([2]);
  });
  it("two separate groups on the ground are disconnected", () => {
    const m = model(
      P("brick_2x2", "red", 0, 0, 0), P("brick_2x2", "red", 0, 3, 0), P("brick_2x2", "red", 0, 6, 0),
      P("brick_2x2", "blue", 5, 0, 5), P("brick_2x2", "blue", 5, 3, 5),
    );
    const r = validate(m);
    expect(r.errors.map((e) => e.code)).toEqual(["DISCONNECTED"]);
    expect(r.errors[0].parts).toEqual([3, 4]);
    expect(r.components.map((c) => c.length)).toEqual([3, 2]);
  });
  it("a lone part on the ground next to a structure is floating", () => {
    const m = model(P("brick_2x2", "red", 0, 0, 0), P("brick_2x2", "red", 0, 3, 0), P("brick_2x2", "red", 4, 0, 0));
    expect(codes(m)).toEqual(["FLOATING"]);
  });
  it("tiles have no studs: a part on a tile is floating", () => {
    const m = model(P("tile_2x2", "red", 0, 0, 0), P("brick_2x2", "red", 0, 1, 0));
    expect(codes(m)).toContain("FLOATING");
  });
  it("slopes only connect on the studded row", () => {
    // slope45_2x2 rot 0: studs at z=0. A 1x1 on the sloped row (z=1) has nothing to grab.
    const onFace = model(P("slope45_2x2", "red", 0, 0, 0), P("brick_1x1", "red", 0, 3, 1));
    expect(codes(onFace)).toContain("FLOATING");
    const onStud = model(P("slope45_2x2", "red", 0, 0, 0), P("brick_1x1", "red", 0, 3, 0));
    expect(validate(onStud).valid).toBe(true);
    // rot 180 moves the studded row to z=1
    const rotated = model(P("slope45_2x2", "red", 0, 0, 0, 180), P("brick_1x1", "red", 0, 3, 1));
    expect(validate(rotated).valid).toBe(true);
  });
  it("flags a part that only hangs from a part above it", () => {
    // plate under a beam, attached from above only: not buildable bottom-up
    const m = model(
      P("brick_1x1", "red", 0, 0, 0), P("brick_1x1", "red", 3, 0, 0),
      P("plate_1x4", "red", 0, 3, 0),
      P("plate_1x1", "red", 1, 2, 0), // hangs below the beam, top touches the beam underside
    );
    // plate_1x1 at y=2 has top at y=3 == beam bottom, so its stud plugs into the beam
    expect(codes(m)).toEqual(["UNSUPPORTED"]);
  });
});

describe("validator: bounds and ids", () => {
  it("flags out-of-bounds parts", () => {
    expect(codes(model(P("brick_2x4", "red", -1, 0, 0)))).toContain("OUT_OF_BOUNDS");
    expect(codes(model(P("brick_2x4", "red", 46, 0, 0)))).toContain("OUT_OF_BOUNDS");
    expect(codes(model(P("brick_2x4", "red", 0, 0, 46, 90)))).toContain("OUT_OF_BOUNDS");
  });
  it("flags unknown parts and colours", () => {
    const m = model({ part: "brick_9x9", color: "red", x: 0, y: 0, z: 0, rot: 0 }, { part: "brick_2x2", color: "mauve", x: 0, y: 3, z: 0, rot: 0 });
    expect(codes(m)).toEqual(expect.arrayContaining(["UNKNOWN_PART", "UNKNOWN_COLOR"]));
  });
  it("flags empty and oversized models", () => {
    expect(codes(model())).toEqual(["EMPTY_MODEL"]);
    const many = Array.from({ length: 5 }, (_, i) => P("brick_1x1", "red", 0, i * 3, 0));
    expect(validate(model(...many), { maxParts: 4 }).errors.map((e) => e.code)).toEqual(["TOO_MANY_PARTS"]);
  });
});

describe("validator: warnings", () => {
  it("warns about a part held by one stud", () => {
    const m = model(P("brick_1x1", "red", 0, 0, 0), P("brick_2x4", "red", 0, 3, 0));
    const r = validate(m);
    expect(r.valid).toBe(true);
    expect(r.warnings.map((w) => w.code)).toEqual(["WEAK_CONNECTION"]);
  });
});
