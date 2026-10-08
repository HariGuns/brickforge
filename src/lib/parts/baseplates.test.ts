import { describe, expect, it } from "vitest";
import { baseplatesFor } from "./baseplates";

const ids = (ps: { part: string; x: number; z: number; rot: number }[]) => ps.map((p) => `${p.part}@${p.x},${p.z}${p.rot ? " r90" : ""}`);

describe("baseplates under a footprint", () => {
  it("picks the smallest single baseplate that covers it, turned if needed", () => {
    expect(ids(baseplatesFor({ x0: 2, z0: 3, w: 10, d: 12 }, "green"))).toEqual(["3867@2,3"]);
    expect(ids(baseplatesFor({ x0: 0, z0: 0, w: 20, d: 14 }, "green"))).toEqual(["3334@0,0"]); // 24×16
    expect(ids(baseplatesFor({ x0: 0, z0: 0, w: 14, d: 20 }, "green"))).toEqual(["3334@0,0 r90"]);
    expect(ids(baseplatesFor({ x0: 0, z0: 0, w: 30, d: 30 }, "green"))).toEqual(["3811@0,0"]);
    expect(ids(baseplatesFor({ x0: 0, z0: 0, w: 46, d: 40 }, "green"))).toEqual(["4186@0,0"]);
  });

  it("keeps it inside the build area", () => {
    // A 30×30 scene starting at x 20 in a 48-wide area: the 32×32 baseplate moves back to x 16.
    expect(ids(baseplatesFor({ x0: 20, z0: 0, w: 28, d: 30 }, "green", { x: 48, z: 48 }))).toEqual(["3811@16,0"]);
  });

  it("tiles equal squares when no single baseplate covers it", () => {
    expect(ids(baseplatesFor({ x0: 0, z0: 0, w: 64, d: 32 }, "tan"))).toEqual(["3811@0,0", "3811@32,0"]);
    expect(baseplatesFor({ x0: 0, z0: 0, w: 96, d: 96 }, "tan")).toHaveLength(4);
  });
});
