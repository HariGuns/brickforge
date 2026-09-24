import { describe, expect, it } from "vitest";
import { getPart, PARTS } from "../parts/library";
import { footprint, rotateCell, worldStuds } from "./geometry";

describe("part library", () => {
  it("has unique ids", () => {
    expect(new Set(PARTS.map((p) => p.id)).size).toBe(PARTS.length);
  });
  it("stud cells lie inside the footprint", () => {
    for (const p of PARTS) for (const [cx, cz] of p.studs ?? []) {
      expect(cx).toBeGreaterThanOrEqual(0); expect(cx).toBeLessThan(p.w);
      expect(cz).toBeGreaterThanOrEqual(0); expect(cz).toBeLessThan(p.d);
    }
  });
});

describe("geometry", () => {
  const b14 = getPart("brick_1x4")!;
  it("rotates footprint dims", () => {
    expect(footprint({ part: "brick_1x4", color: "red", x: 0, y: 0, z: 0, rot: 90 }, b14)).toMatchObject({ sx: 1, sz: 4 });
  });
  it("rotated cells stay inside the rotated footprint", () => {
    for (const p of PARTS) for (const rot of [0, 90, 180, 270] as const) {
      const sx = rot % 180 ? p.d : p.w, sz = rot % 180 ? p.w : p.d;
      const seen = new Set<string>();
      for (let cz = 0; cz < p.d; cz++) for (let cx = 0; cx < p.w; cx++) {
        const [x, z] = rotateCell(cx, cz, p, rot);
        expect(x >= 0 && x < sx && z >= 0 && z < sz).toBe(true);
        seen.add(`${x},${z}`);
      }
      expect(seen.size).toBe(p.w * p.d);
    }
  });
  it("slope studs follow rotation (rot 0 back row is z=0, rot 90 moves it to max x)", () => {
    const s = getPart("slope45_2x2")!;
    expect(worldStuds({ part: s.id, color: "red", x: 0, y: 0, z: 0, rot: 0 }, s)).toEqual([[0, 0, 3], [1, 0, 3]]);
    expect(worldStuds({ part: s.id, color: "red", x: 0, y: 0, z: 0, rot: 90 }, s)).toEqual([[1, 0, 3], [1, 1, 3]]);
    expect(worldStuds({ part: s.id, color: "red", x: 0, y: 0, z: 0, rot: 180 }, s).sort()).toEqual([[0, 1, 3], [1, 1, 3]]);
    expect(worldStuds({ part: s.id, color: "red", x: 0, y: 0, z: 0, rot: 270 }, s).sort()).toEqual([[0, 0, 3], [0, 1, 3]]);
  });
});
