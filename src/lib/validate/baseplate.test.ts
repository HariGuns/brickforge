import { describe, expect, it } from "vitest";
import { validate } from "./validator";
import { P } from "../fixtures/samples";
import { buildSteps, checkStepOrder } from "../steps/steps";
import { exportLdr } from "../ldraw/export";
import { importLdr } from "../ldraw/import";
import { getPart } from "../parts/library";
import type { Placement } from "../model/schema";

const m = (parts: Placement[]) => ({ name: "scene", description: "", parts });
const codes = (parts: Placement[], structure: "off" | "error" = "off") => validate(m(parts), { structure }).errors.map((e) => e.code);
// Two small walls, each a 2×4 brick with a 2×4 plate on top.
const wall = (x: number, z: number) => [P("brick_2x4", "red", x, 0, z), P("plate_2x4", "white", x, 3, z)];

describe("baseplates", () => {
  it("are a ground layer: height 0, studs on top only, nothing underneath", () => {
    const b = getPart("3811")!;
    expect([b.category, b.w, b.d, b.h]).toEqual(["baseplate", 32, 32, 0]);
    // Sections standing on the same baseplate are connected through its studs.
    expect(codes([...wall(2, 2), ...wall(20, 20)])).toEqual(["DISCONNECTED"]);
    expect(codes([P("3811", "green", 0, 0, 0), ...wall(2, 2), ...wall(20, 20)])).toEqual([]);
    const v = validate(m([P("3811", "green", 0, 0, 0), ...wall(2, 2)]));
    expect(v.connections).toContainEqual({ lower: 0, upper: 1, studs: 8, kind: "stud" });
  });

  it("must lie on the ground, not raised, stacked or overlapping", () => {
    expect(codes([P("brick_2x2", "red", 0, 0, 0), P("3867", "green", 0, 3, 0)])).toContain("BASEPLATE_NOT_ON_GROUND");
    expect(codes([P("3867", "green", 0, 0, 0), P("3867", "green", 8, 0, 0), P("brick_2x4", "red", 9, 0, 1)])).toEqual(["OVERLAP"]);
  });

  it("treats each tile as its own ground: sections connect across tiles only through a bridge", () => {
    const tiles = [P("3867", "green", 0, 0, 0), P("3867", "green", 16, 0, 0)];
    const scene = [...tiles, ...wall(2, 2), ...wall(20, 2)];
    expect(codes(scene)).toEqual(["DISCONNECTED"]);
    // A 2×8 plate across the seam (x 12–19) stands on both tiles and ties them together.
    expect(codes([...scene, P("plate_2x8", "dark_gray", 12, 0, 10)])).toEqual([]);
  });

  it("flags a single-stud post standing on a baseplate, which the ground used to hold", () => {
    const post = [P("43888", "black", 4, 0, 4), P("round_brick_1x1", "yellow", 4, 18, 4)];
    expect(codes(post, "error")).toEqual([]);
    expect(codes([P("3867", "green", 0, 0, 0), ...post], "error")).toEqual(["WEAK_JOINT"]);
  });

  it("goes in the first step, alone, and exports and imports at y = 0", () => {
    const scene = [...wall(2, 2), P("3811", "green", 0, 0, 0), ...wall(20, 20)];
    const steps = buildSteps(m(scene));
    expect(steps[0]).toMatchObject({ n: 1, parts: [2], y: 0 });
    expect(checkStepOrder(m(scene), validate(m(scene)).connections, steps)).toEqual([]);
    const ldr = exportLdr(m(scene), steps);
    // Top surface at LDraw Y 0, centred on its 32×32 footprint (16 studs = 320 LDU from the corner).
    expect(ldr).toMatch(/^1 \d+ 320 0 -320 1 0 0 0 1 0 0 0 1 3811\.dat$/m);
    const back = importLdr(ldr);
    expect(back.model.parts.find((p) => p.part === "3811")).toMatchObject({ x: 0, y: 0, z: 0, rot: 0 });
  });
});
