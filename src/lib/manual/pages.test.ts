import { describe, expect, it } from "vitest";
import { manualPages, sizeLabel } from "./pages";
import { buildSteps } from "../steps/steps";
import { SAMPLE_HOUSE } from "../fixtures/samples";

describe("manual pages", () => {
  it("labels part sizes by category", () => {
    expect(sizeLabel("brick_2x4")).toBe("2×4");
    expect(sizeLabel("plate_1x2")).toBe("1×2 plate");
    expect(sizeLabel("tile_2x2")).toBe("2×2 tile");
    expect(sizeLabel("slope45_2x4")).toBe("2×4 slope");
    expect(sizeLabel("slope45_2x1")).toBe("2×1 slope");
  });

  it("makes one page per step whose callouts add up to the step's parts", () => {
    const steps = buildSteps(SAMPLE_HOUSE);
    const pages = manualPages(SAMPLE_HOUSE, steps);
    expect(pages.map((p) => p.n)).toEqual(steps.map((s) => s.n));
    for (const p of pages) expect(p.callout.reduce((s, c) => s + c.qty, 0)).toBe(p.pieces);
    expect(pages.reduce((s, p) => s + p.pieces, 0)).toBe(SAMPLE_HOUSE.parts.length);
    expect(pages[0]).toMatchObject({ layer: 1, layers: pages.at(-1)!.layers, callout: [expect.objectContaining({ size: "4×6 plate", qty: 2 })] });
  });
});
