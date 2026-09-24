import { describe, expect, it } from "vitest";
import { flatSection, manualPages, sizeLabel } from "./pages";
import { buildSteps } from "../steps/steps";
import { designSteps } from "../design/steps";
import { SAMPLE_HOUSE } from "../fixtures/samples";
import { SAMPLE_VILLAGE } from "../fixtures/designs";

describe("manual pages", () => {
  it("labels part sizes by category", () => {
    expect(sizeLabel("brick_2x4")).toBe("2×4");
    expect(sizeLabel("plate_1x2")).toBe("1×2 plate");
    expect(sizeLabel("tile_2x2")).toBe("2×2 tile");
    expect(sizeLabel("slope45_2x4")).toBe("2×4 slope");
    expect(sizeLabel("slope45_2x1")).toBe("2×1 slope");
    expect(sizeLabel("ridge45_2x2")).toBe("2×2 ridge");
    expect(sizeLabel("window_1x2x3")).toBe("1×2×3 window");
    expect(sizeLabel("cone_2x2x2")).toBe("2×2×2 cone");
  });

  it("a flat model: one page per step, no labels, callouts add up", () => {
    const steps = buildSteps(SAMPLE_HOUSE);
    const pages = manualPages([flatSection(SAMPLE_HOUSE, steps)]);
    expect(pages.map((p) => p.n)).toEqual(steps.map((s) => s.n));
    expect(pages.every((p) => p.label === null && p.copies.length === 0)).toBe(true);
    for (const p of pages) expect(p.callout.reduce((s, c) => s + c.qty, 0)).toBe(p.pieces);
    expect(pages[0]).toMatchObject({ layer: 1, local: 1, callout: [expect.objectContaining({ size: "4×6 plate", qty: 2 })] });
  });

  it("a design: sub-build pages first with labels, then the main build with copy callouts", () => {
    const pages = manualPages(designSteps(SAMPLE_VILLAGE).sections);
    expect([...new Set(pages.map((p) => p.label))]).toEqual(["Sub-build · Hut ×2", "Sub-build · Pine tree ×4", "Sub-build · Grove", "Main build"]);
    const main = pages.filter((p) => p.label === "Main build");
    expect(main.flatMap((p) => p.copies.map((c) => c.name))).toEqual(["Pine tree", "Hut", "Grove"]);
    expect(main.at(-1)!.local).toBe(main.at(-1)!.localTotal);
    // Copy steps have no loose parts in their callout.
    expect(main.filter((p) => p.copies.length).every((p) => p.callout.length === 0)).toBe(true);
  });
});
