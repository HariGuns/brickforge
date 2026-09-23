import { describe, expect, it } from "vitest";
import { importLdr } from "./import";
import { exportLdr, exportMpd } from "./export";
import { buildSteps } from "../steps/steps";
import { PARTS } from "../parts/library";
import { SAMPLE_HOUSE } from "../fixtures/samples";
import type { BrickModel, Placement } from "../model/schema";

const key = (p: Placement) => `${p.part}|${p.color}|${p.x}|${p.y}|${p.z}|${p.rot}`;

describe("LDraw import", () => {
  it("round-trips the sample house through .ldr and .mpd", () => {
    for (const text of [exportLdr(SAMPLE_HOUSE, buildSteps(SAMPLE_HOUSE)), exportMpd(SAMPLE_HOUSE, buildSteps(SAMPLE_HOUSE))]) {
      const { model, skipped } = importLdr(text);
      expect(skipped).toEqual([]);
      expect(model.name).toBe(SAMPLE_HOUSE.name);
      expect(model.description).toBe(SAMPLE_HOUSE.description);
      expect(model.parts.map(key).sort()).toEqual(SAMPLE_HOUSE.parts.map(key).sort());
    }
  });

  it("round-trips every library part in every rotation", () => {
    const parts: Placement[] = PARTS.flatMap((p, i) => ([0, 90, 180, 270] as const).map((rot) => ({ part: p.id, color: "blue", x: 3 + i, y: 2 * i, z: 5, rot })));
    const m: BrickModel = { name: "All", description: "", parts };
    const { model, skipped } = importLdr(exportLdr(m, buildSteps(m)));
    expect(skipped).toEqual([]);
    expect(model.parts.map(key).sort()).toEqual(parts.map(key).sort());
  });

  it("skips parts it can't map, with a reason", () => {
    const text = ["0 Odd", "1 4 0 -24 0 1 0 0 0 1 0 0 0 1 99999.dat", "1 4 0 -24 0 1 0 0 0 0 -1 0 1 0 3001.dat", "1 4 5 -24 0 1 0 0 0 1 0 0 0 1 3001.dat"].join("\n");
    const { skipped, model } = importLdr(text);
    expect(model.parts).toHaveLength(0);
    expect(skipped.map((s) => s.reason)).toEqual(["unknown part 99999.dat", "part is tilted or mirrored", "part is off the stud grid"]);
  });
});
