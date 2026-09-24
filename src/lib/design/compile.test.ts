import { describe, expect, it } from "vitest";
import { compileDesign, compileSubBuild, transformPlacement } from "./compile";
import { designFromModel, type BrickDesign, type SubBuild } from "./schema";
import { validate } from "../validate/validator";
import { worldStuds, footprint, footprintCells } from "../model/geometry";
import { getPart, PARTS } from "../parts/library";
import { P, SAMPLE_HOUSE, SAMPLE_STACK } from "../fixtures/samples";
import type { Placement, Rot } from "../model/schema";

const ROTS: Rot[] = [0, 90, 180, 270];
const sub = (id: string, parts: Placement[], uses: SubBuild["uses"] = [], name = id): SubBuild => ({ id, name, parts, uses });
const design = (subBuilds: SubBuild[], mainParts: Placement[], uses: BrickDesign["main"]["uses"]): BrickDesign => ({ name: "T", description: "", subBuilds, main: { parts: mainParts, uses } });

/** Rotate a world cell inside a W×D box the same way rotateCell does for part cells. */
function rotCell([x, z]: [number, number], W: number, D: number, rot: Rot): [number, number] {
  switch (rot) {
    case 0: return [x, z];
    case 90: return [D - 1 - z, x];
    case 180: return [W - 1 - x, D - 1 - z];
    case 270: return [z, W - 1 - x];
  }
}
const sortCells = (c: [number, number][]) => c.map((p) => p.join(",")).sort();

describe("design compiler: flat models", () => {
  it("a flat model compiles to exactly its own parts, with no copies and no errors", () => {
    const r = compileDesign(designFromModel(SAMPLE_HOUSE));
    expect(r.model.parts).toEqual(SAMPLE_HOUSE.parts);
    expect(r.origin.every((o) => o === -1)).toBe(true);
    expect(r.instances).toEqual([]);
    expect(r.errors).toEqual([]);
    expect(r.stats).toMatchObject({ pieces: 26, uniqueSubBuilds: 0, copies: 0, errors: 0 });
    expect(r.stats.sizeCm).toEqual({ w: 6.4, d: 4.8, h: 5.6 });
  });
});

describe("design compiler: rotation", () => {
  it("every part in every orientation, in every copy rotation, lands on the rotated cells and studs", () => {
    for (const def of PARTS) for (const prot of ROTS) for (const irot of ROTS) {
      // Offset local frame (5, 7) to check the box is normalised.
      const pl: Placement = { part: def.id, color: "red", x: 5, y: 0, z: 7, rot: prot };
      const box = { minX: 5, minZ: 7, maxX: 5 + footprint(pl, def).sx, maxZ: 7 + footprint(pl, def).sz, maxY: def.h };
      const W = box.maxX - box.minX, D = box.maxZ - box.minZ;
      const out = transformPlacement(pl, box, { x: 10, y: 3, z: 20, rot: irot });
      const local = (cells: [number, number][]) => cells.map(([x, z]) => rotCell([x - 5, z - 7], W, D, irot)).map(([x, z]) => [x + 10, z + 20] as [number, number]);
      expect(sortCells(footprintCells(footprint(out, def)))).toEqual(sortCells(local(footprintCells(footprint(pl, def)))));
      expect(sortCells(worldStuds(out, def))).toEqual(sortCells(local(worldStuds(pl, def))));
      expect(out.y).toBe(3);
    }
  });

  it("a rotated copy of the house has exactly the same stud connections as the original", () => {
    const ref = validate(SAMPLE_HOUSE).connections.map((c) => `${c.lower}>${c.upper}:${c.studs}`).sort();
    for (const rot of ROTS) {
      const r = compileDesign(design([sub("house", SAMPLE_HOUSE.parts)], [], [{ sub: "house", x: 3, y: 0, z: 4, rot }]));
      expect(r.errors).toEqual([]);
      expect(r.validation!.connections.map((c) => `${c.lower}>${c.upper}:${c.studs}`).sort()).toEqual(ref);
      const { sx, sz } = { sx: rot % 180 ? 6 : 8, sz: rot % 180 ? 8 : 6 };
      const xs = r.model.parts.map((p) => p.x), zs = r.model.parts.map((p) => p.z);
      expect([Math.min(...xs), Math.min(...zs)]).toEqual([3, 4]);
      expect(r.stats.sizeCm.w).toBeCloseTo(sx * 0.8);
      expect(r.stats.sizeCm.d).toBeCloseTo(sz * 0.8);
    }
  });
});

describe("design compiler: copies and nesting", () => {
  // A 2x2 post (two bricks); a "fence" = 2 posts joined by a plate; main = base plate + 2 fences.
  const post = sub("post", [P("brick_2x2", "tan", 0, 0, 0), P("brick_2x2", "tan", 0, 3, 0)], [], "Post");
  const fence = sub("fence", [P("plate_2x8", "reddish_brown", 0, 6, 0)], [{ sub: "post", x: 0, y: 0, z: 0, rot: 0 }, { sub: "post", x: 6, y: 0, z: 0, rot: 0 }], "Fence");
  // Base: two 4x8 plates tied together by a 2x2 plate across the seam (clear of the posts).
  const d = design([post, fence], [P("plate_4x8", "green", 0, 0, 0), P("plate_4x8", "green", 0, 0, 4), P("plate_2x2", "green", 2, 1, 3)], [
    { sub: "fence", x: 0, y: 1, z: 0, rot: 0 },
    { sub: "fence", x: 0, y: 1, z: 6, rot: 0 },
  ]);

  it("expands nested copies with paths, copy numbers and part ownership", () => {
    const r = compileDesign(d);
    expect(r.errors).toEqual([]);
    expect(r.model.parts).toHaveLength(3 + 2 * (1 + 2 * 2));
    expect(r.instances.map((i) => i.path)).toEqual(["Fence #1", "Fence #1 › Post #1", "Fence #1 › Post #2", "Fence #2", "Fence #2 › Post #3", "Fence #2 › Post #4"]);
    expect(r.instances[0].parts).toHaveLength(5);
    expect(r.instances[1].parts).toHaveLength(2);
    expect(r.origin[0]).toBe(-1);
    expect(r.subBuilds.map((s) => [s.id, s.parts, s.copies])).toEqual([["post", 2, 4], ["fence", 5, 2]]);
    expect(r.tree).toMatchObject({ sub: null, children: [{ sub: "fence", count: 2, parts: 5, children: [{ sub: "post", count: 2, parts: 2 }] }] });
    expect(r.stats).toMatchObject({ uniqueSubBuilds: 2, copies: 6 });
  });

  it("compiles a sub-build on its own at the origin", () => {
    const r = compileSubBuild(d, "fence");
    expect(r.errors).toEqual([]);
    expect(r.model.parts).toHaveLength(5);
    expect(Math.min(...r.model.parts.map((p) => p.x))).toBe(0);
  });
});

describe("design compiler: errors", () => {
  const brick = sub("b", [P("brick_2x2", "red", 0, 0, 0)]);

  it("reports unknown, duplicate, cyclic, too-deep and unused sub-builds", () => {
    expect(compileDesign(design([brick], [], [{ sub: "nope", x: 0, y: 0, z: 0, rot: 0 }])).errors.map((e) => e.code)).toContain("UNKNOWN_SUBBUILD");
    expect(compileDesign(design([brick, brick], [], [{ sub: "b", x: 0, y: 0, z: 0, rot: 0 }])).errors.map((e) => e.code)).toContain("DUPLICATE_SUBBUILD");
    const a = sub("a", [], [{ sub: "c", x: 0, y: 0, z: 0, rot: 0 }]);
    const c = sub("c", [P("brick_1x1", "red", 0, 0, 0)], [{ sub: "a", x: 0, y: 3, z: 0, rot: 0 }]);
    const cyc = compileDesign(design([a, c], [], [{ sub: "a", x: 0, y: 0, z: 0, rot: 0 }]));
    expect(cyc.errors.find((e) => e.code === "SUBBUILD_CYCLE")?.message).toMatch(/a → c → a|c → a → c/);
    const chainSubs = Array.from({ length: 7 }, (_, i) => sub(`s${i}`, [P("brick_1x1", "red", 0, 0, 0)], i < 6 ? [{ sub: `s${i + 1}`, x: 0, y: 3, z: 0, rot: 0 }] : []));
    expect(compileDesign(design(chainSubs, [], [{ sub: "s0", x: 0, y: 0, z: 0, rot: 0 }])).errors.map((e) => e.code)).toContain("TOO_DEEP");
    const unused = compileDesign(design([brick, sub("spare", [P("brick_1x1", "red", 0, 0, 0)])], [], [{ sub: "b", x: 0, y: 0, z: 0, rot: 0 }]));
    expect(unused.warnings.map((w) => w.code)).toEqual(["UNUSED_SUBBUILD"]);
  });

  it("flags a copy that isn't attached, instead of generic floating/disconnected errors", () => {
    const r = compileDesign(design([sub("stack", SAMPLE_STACK.parts, [], "Stack")], [], [
      { sub: "stack", x: 0, y: 0, z: 0, rot: 0 },
      { sub: "stack", x: 20, y: 0, z: 20, rot: 0 },
    ]));
    expect(r.errors.map((e) => e.code)).toEqual(["DETACHED_SUBBUILD", "DETACHED_SUBBUILD"]);
    expect(r.errors[0].message).toMatch(/Stack #1/);
  });

  it("flags a copy held only from above", () => {
    const r = compileDesign(design([sub("blk", [P("brick_2x2", "red", 0, 0, 0)], [], "Block")], [
      P("brick_2x2", "light_gray", 4, 0, 0),
      P("brick_2x2", "light_gray", 4, 3, 0),
      P("brick_2x8", "blue", 0, 6, 0),
    ], [{ sub: "blk", x: 0, y: 3, z: 0, rot: 0 }]));
    expect(r.errors.map((e) => e.code)).toContain("SUBBUILD_UNSUPPORTED");
  });

  it("flags interlocking copies", () => {
    // A: bricks at y0 and y6; B: a brick at y3 between them, offset so each clutches the other.
    const A = sub("aa", [P("brick_2x2", "red", 0, 0, 0), P("brick_2x2", "red", 0, 6, 0)], [], "A");
    const B = sub("bb", [P("brick_2x2", "blue", 0, 0, 0)], [], "B");
    const r = compileDesign(design([A, B], [], [{ sub: "aa", x: 0, y: 0, z: 0, rot: 0 }, { sub: "bb", x: 1, y: 3, z: 0, rot: 0 }]));
    expect(r.errors.map((e) => e.code)).toContain("INTERLOCKED");
  });

  it("names the copy in validator messages", () => {
    const bad = sub("bad", [P("brick_2x2", "red", 0, 0, 0), P("brick_2x2", "red", 0, 9, 0)], [], "Bad tower");
    const r = compileDesign(design([bad], [], [{ sub: "bad", x: 0, y: 0, z: 0, rot: 0 }]));
    expect(r.errors.find((e) => e.code === "FLOATING")?.message).toMatch(/\[in Bad tower #1\]/);
  });
});

describe("design compiler: scale", () => {
  it("compiles and validates a ~4,600-part nested design, error-free, well under a few seconds", async () => {
    const { benchDesign } = await import("./bench");
    const r = compileDesign(benchDesign(5));
    expect(r.errors).toEqual([]);
    expect(r.stats.pieces).toBeGreaterThan(4000);
    expect(r.stats.copies).toBe(25 + 25 * 16);
    // Loose bound so the suite isn't flaky on slow machines; `npm run bench` reports the real number.
    expect(r.stats.compileMs).toBeLessThan(5000);
  });
});
