import { describe, expect, it } from "vitest";
import { importLdr } from "./import";
import { CONFIG } from "../config";
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
    const text = ["0 Odd", "1 4 0 -24 0 1 0 0 0 1 0 0 0 1 99999.dat", "1 4 0 -24 0 1 0 0 0 1 0 0 0 -1 3001.dat", "1 4 5 -24 0 1 0 0 0 1 0 0 0 1 3001.dat"].join("\n");
    const { skipped, model } = importLdr(text);
    expect(model.parts).toHaveLength(0);
    expect(skipped.map((s) => s.reason)).toEqual(["unknown part 99999.dat", "part is tilted or mirrored", "part is off the stud grid"]);
  });

  it("imports tilted parts only while sideways building is on", () => {
    const text = "1 4 0 -24 0 1 0 0 0 0 -1 0 1 0 3001.dat";
    expect(importLdr(text).skipped.map((s) => s.reason)).toEqual(["part is tilted or mirrored"]);
    CONFIG.sideways.enabled = true;
    try {
      expect(importLdr(text).model.parts[0].frame).toBeDefined();
    } finally {
      CONFIG.sideways.enabled = false;
    }
  });
});

describe("LDraw import: design .mpd with submodels", () => {
  it("expands nested, rotated sub-build copies back to exactly the compiled parts", async () => {
    const { SAMPLE_VILLAGE } = await import("../fixtures/designs");
    const { compileDesign } = await import("../design/compile");
    const { exportDesignMpd, submodelFile } = await import("./export");
    const compiled = compileDesign(SAMPLE_VILLAGE);
    expect(compiled.errors).toEqual([]);
    const mpd = exportDesignMpd(SAMPLE_VILLAGE, compiled);
    // One submodel per unique sub-build, copies as references.
    expect(mpd.match(/^0 FILE /gm)).toHaveLength(1 + SAMPLE_VILLAGE.subBuilds.length);
    expect(mpd.split(/\r\n/).filter((l) => l.startsWith("1 ") && l.endsWith(submodelFile("pine_tree")))).toHaveLength(4);
    const { model, skipped } = importLdr(mpd);
    expect(skipped).toEqual([]);
    expect(model.name).toBe("Tiny village");
    expect(model.parts.map(key).sort()).toEqual(compiled.model.parts.map(key).sort());
  });

  it("guards against a submodel that includes itself", () => {
    const text = ["0 FILE main.ldr", "1 16 0 0 0 1 0 0 0 1 0 0 0 1 loop.ldr", "0 NOFILE", "0 FILE loop.ldr", "1 16 0 0 0 1 0 0 0 1 0 0 0 1 loop.ldr", "0 NOFILE"].join("\n");
    expect(importLdr(text).skipped.map((s) => s.reason)).toEqual(["submodel loop.ldr includes itself"]);
  });
});

describe("LDraw round trip with catalog parts", () => {
  it("exports and re-imports curved slopes, wedges, windscreens and wheels in every rotation", async () => {
    const { exportLdr } = await import("./export");
    const { buildSteps } = await import("../steps/steps");
    const { P } = await import("../fixtures/samples");
    const { mountsFor } = await import("../parts/wheels");
    const holder = P("4600", "black", 20, 3, 20);
    const parts = [
      P("11477", "red", 0, 0, 0),
      P("41769b", "blue", 4, 0, 0, 90),
      P("41770b", "blue", 10, 0, 0, 180),
      P("3823", "trans_clear", 0, 0, 10, 270),
      P("3933", "white", 10, 0, 10, 90),
      P("54200", "red", 30, 0, 0),
      holder,
      ...mountsFor(holder, "4624c01").map((m) => ({ ...P("4624c01", "yellow", 0, 0, 0), ...m.at })),
    ];
    const model = { name: "Catalog", description: "", parts };
    const back = importLdr(exportLdr(model, buildSteps(model)));
    expect(back.skipped).toEqual([]);
    const key = (p: (typeof parts)[number]) => `${p.part}|${p.color}|${p.x},${p.y},${p.z}|${p.rot}`;
    expect(back.model.parts.map(key).sort()).toEqual(parts.map(key).sort());
  });
});
