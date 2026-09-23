import { describe, expect, it } from "vitest";
import { describeDiff, diffModels } from "./diff";
import { P, SAMPLE_HOUSE } from "../fixtures/samples";

describe("model diff", () => {
  it("counts added, removed and kept parts, including duplicates", () => {
    const after = { ...SAMPLE_HOUSE, parts: [...SAMPLE_HOUSE.parts.slice(1), P("brick_1x1", "white", 0, 17, 0), P("brick_1x1", "white", 0, 20, 0)] };
    expect(diffModels(SAMPLE_HOUSE, after)).toEqual({ added: 2, removed: 1, kept: 25 });
    expect(describeDiff(diffModels(SAMPLE_HOUSE, after))).toBe("2 parts added, 1 removed; 25 unchanged");
  });
  it("treats a moved part as removed + added", () => {
    const moved = { ...SAMPLE_HOUSE, parts: SAMPLE_HOUSE.parts.map((p, i) => (i === 0 ? { ...p, x: p.x + 1 } : p)) };
    expect(diffModels(SAMPLE_HOUSE, moved)).toEqual({ added: 1, removed: 1, kept: 25 });
  });
  it("identical models have no changes", () => {
    expect(describeDiff(diffModels(SAMPLE_HOUSE, SAMPLE_HOUSE))).toBe("no parts changed");
  });
});
