import { describe, expect, it, vi } from "vitest";
import { getPart, PARTS, SNOT_PARTS } from "./library";
import { searchParts } from "./search";
import { worldSideStuds } from "../model/geometry";
import { CONFIG } from "../config";
// Sideways building is off by default; these tests load the side-stud parts.
vi.hoisted(() => void (process.env.NEXT_PUBLIC_BRICKFORGE_SIDEWAYS = "1"));


const snot = (id: string) => SNOT_PARTS.find((p) => p.id === id)!;

describe("side-stud parts (sideways building, phase 1)", () => {
  it("are in the app only while sideways building is enabled", () => {
    expect(SNOT_PARTS.length).toBeGreaterThanOrEqual(35);
    expect(PARTS.some((p) => p.snot)).toBe(true);
    expect(getPart("87087")?.snot).toBe(true);
    expect(searchParts("brick with studs on side").some((p) => p.snot)).toBe(true);
    CONFIG.sideways.enabled = false;
    try {
      expect(getPart("87087")).toBeUndefined();
    } finally {
      CONFIG.sideways.enabled = true;
    }
  });

  it("record side studs at the face, on stud centres, at quarter-plate heights", () => {
    expect(snot("87087").sideStuds).toEqual([{ at: [0.5, 1.75, 1], dir: "+z" }]);
    expect(snot("4733").sideStuds!.map((s) => s.dir).sort()).toEqual(["+x", "+z", "-x", "-z"]);
    expect(snot("32952").sideStuds!.map((s) => s.at[1]).sort()).toEqual([1.25, 3.75]); // 2.5-plate stud pitch sideways
    for (const p of SNOT_PARTS)
      for (const s of p.sideStuds!) {
        expect(Number.isInteger(s.at[1] * 4), `${p.id} height`).toBe(true);
        const along = s.dir.endsWith("x") ? s.at[2] : s.at[0];
        expect(Number.isInteger(along - 0.5), `${p.id} along the face`).toBe(true);
      }
  });

  it("frame brackets by their plate, with the flange as an extension box", () => {
    const b = snot("99781");
    expect([b.w, b.d, b.h]).toEqual([2, 1, 1]);
    expect(b.sideStuds!.map((s) => s.at)).toEqual(expect.arrayContaining([[0.5, -0.25, 1.2], [1.5, -0.25, 1.2]]));
    expect(b.fine).toEqual([[0, -12, 20, 40, 8, 24]]); // 1.5 plates below the plate, 4 LDU in front
  });

  it("turn side studs with the part", () => {
    const p = snot("87087");
    expect(worldSideStuds({ part: "87087", color: "red", x: 2, y: 3, z: 4, rot: 90 }, p)).toEqual([{ at: [2, 4.75, 4.5], dir: "-x" }]);
  });
});
