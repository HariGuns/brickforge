import { describe, expect, it } from "vitest";
import { countParts, groupParts, modelStats } from "./stats";
import { SAMPLE_HOUSE } from "../fixtures/samples";

describe("model stats", () => {
  it("summarises the sample house", () => {
    expect(modelStats(SAMPLE_HOUSE)).toEqual({ pieces: 26, width: 8, depth: 6, heightPlates: 17, layers: 7, partTypes: 9, colors: 4 });
  });
  it("groups parts by category and the totals add up", () => {
    const groups = groupParts(SAMPLE_HOUSE);
    expect(groups.map((g) => g.name)).toEqual(["Bricks", "Plates", "Slopes & roof"]);
    expect(groups.reduce((s, g) => s + g.total, 0)).toBe(26);
    expect(groups.find((g) => g.name === "Slopes & roof")!.rows).toEqual([expect.objectContaining({ name: "Slope 45° 2×4", colorName: "Dark Bluish Gray", qty: 8 })]);
  });
  it("counts a subset of parts", () => {
    expect(countParts(SAMPLE_HOUSE, [0, 1])).toEqual([expect.objectContaining({ part: "plate_4x6", qty: 2 })]);
  });
});
