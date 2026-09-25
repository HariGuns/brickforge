import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONFIG } from "../config";
import { compileDesign } from "../design/compile";
import type { BrickDesign } from "../design/schema";
import { P } from "../fixtures/samples";
import { getPart } from "../parts/library";
import { worldBoxes, worldConnectors } from "./frame";
import { buildSteps, checkStepOrder } from "../steps/steps";

beforeAll(() => void (CONFIG.sideways.enabled = true));
afterAll(() => void (CONFIG.sideways.enabled = false));

// A 4×4 base with a brick that has a stud on its +z side (87087), and a 2×2 plate "panel"
// mounted on that stud: its top faces +z, its bottom cell [0, 1] clips onto the stud.
const design = (mount: Partial<{ part: number; stud: number; at: [number, number]; spin: 0 | 90 | 180 | 270 }> = {}, extra: object[] = []): BrickDesign => ({
  name: "Side panel",
  description: "",
  subBuilds: [{ id: "panel", name: "Panel", parts: [P("plate_2x2", "red", 0, 0, 0)], uses: [] }],
  main: { parts: [P("plate_4x4", "green", 0, 0, 0), P("87087", "white", 1, 1, 1)], uses: [{ sub: "panel", x: 0, y: 0, z: 0, rot: 0, mount: { part: 1, stud: 0, at: [0, 1], spin: 0, ...mount } }, ...(extra as BrickDesign["main"]["uses"])] },
});

describe("sideways copies", () => {
  it("mount on a side stud: the copy's anti-stud lands on the stud, its top faces the stud's way", () => {
    const c = compileDesign(design());
    expect(c.errors).toEqual([]);
    const panel = c.model.parts[2];
    expect(panel.frame).toBeDefined();
    const def = getPart(panel.part)!;
    // The carrier's side stud: x = 1.5 studs, y = 1 + 1.75 plates, z = 2 studs, pointing +z.
    const stud = worldConnectors(c.model.parts[1], getPart("87087")!).studs.find((s) => s.side)!;
    expect(stud.p).toEqual([30, 22, 40]);
    const anti = worldConnectors(panel, def).anti;
    expect(anti.some((a) => a.p.every((v, k) => Math.abs(v - stud.p[k]) < 1e-9) && a.d[2] === -1)).toBe(true);
    // The plate sits outside the brick's face (z 40–48), hanging from the stud: x 20–60, y 12–52.
    expect(worldBoxes(panel, def)).toEqual([[20, 12, 40, 60, 52, 48]]);
    // Valid, with the side connection, and the panel goes on after the upright build.
    const v = c.validation!;
    expect(v.errors).toEqual([]);
    expect(v.connections).toContainEqual({ lower: 1, upper: 2, studs: 1, kind: "side" });
    const steps = buildSteps(c.model);
    expect(steps.at(-1)!.parts).toEqual([2]);
    expect(checkStepOrder(c.model, v.connections, steps)).toEqual([]);
  });

  it("explains a wrong mount", () => {
    const msg = (m: object) => compileDesign(design(m)).errors.map((e) => `${e.code}: ${e.message}`).join(" ");
    expect(msg({ part: 0 })).toMatch(/MOUNT_INVALID: .*has no side studs\. Parts with side studs here: #1 87087/);
    expect(msg({ stud: 3 })).toMatch(/MOUNT_INVALID: .*has 1 side stud\(s\)/);
    expect(msg({ at: [5, 0] })).toMatch(/MOUNT_INVALID: .*outside the sub-build's 2×2 footprint/);
  });

  it("finds collisions exactly: a second panel on the same stud overlaps the first", () => {
    const c = compileDesign(design({}, [{ sub: "panel", x: 0, y: 0, z: 0, rot: 0, mount: { part: 1, stud: 0, at: [1, 1], spin: 0 } }]));
    expect(c.validation!.errors.map((e) => e.code)).toContain("OVERLAP");
  });

  it("turns with spin inside the face", () => {
    const c = compileDesign(design({ spin: 90 }));
    const box = worldBoxes(c.model.parts[2], getPart("plate_2x2")!)[0];
    expect(box[5] - box[2]).toBe(8); // still a plate's thickness out from the face
    expect(c.validation!.connections).toContainEqual({ lower: 1, upper: 2, studs: 1, kind: "side" });
  });

  it("leaves upright models exactly as before (no sideways pass without sideways parts)", () => {
    const upright = compileDesign({ name: "u", description: "", subBuilds: [], main: { parts: [P("plate_4x4", "green", 0, 0, 0), P("brick_2x2", "red", 0, 1, 0)], uses: [] } });
    expect(upright.validation!.connections).toEqual([{ lower: 0, upper: 1, studs: 4, kind: "stud" }]);
  });
});

import { exportDesignMpd, exportLdr } from "../ldraw/export";
import { importLdr } from "../ldraw/import";
import { designSteps } from "../design/steps";
import { manualPages } from "../manual/pages";
import { renderModel } from "../render/render";
import type { Placement } from "../model/schema";

const same = (a: Placement[], b: Placement[]) => {
  const k = (p: Placement) => `${p.part}|${p.color}|${p.frame ? `${p.frame.m.join(",")}|${p.frame.t.map((v) => v.toFixed(2)).join(",")}` : `${p.x},${p.y},${p.z},${p.rot}`}`;
  return a.map(k).sort().join("\n") === b.map(k).sort().join("\n");
};

describe("sideways copies: export, mirror, render, manual", () => {
  it("round-trips through .ldr and the design .mpd (the mounted copy is a turned submodel)", () => {
    const d = design({ spin: 90 });
    const c = compileDesign(d);
    const flat = importLdr(exportLdr(c.model, buildSteps(c.model)));
    expect(flat.skipped).toEqual([]);
    expect(same(flat.model.parts, c.model.parts)).toBe(true);
    const mpd = exportDesignMpd(d, c);
    expect(mpd).toMatch(/0 FILE sub_panel\.ldr/);
    const back = importLdr(mpd);
    expect(back.skipped).toEqual([]);
    expect(same(back.model.parts, c.model.parts)).toBe(true);
  });

  it("skips turned parts on import while sideways building is off (as before)", () => {
    const c = compileDesign(design());
    const text = exportLdr(c.model, buildSteps(c.model));
    CONFIG.sideways.enabled = false;
    try {
      expect(importLdr(text).skipped.map((s) => s.reason)).toContain("part is tilted or mirrored");
    } finally {
      CONFIG.sideways.enabled = true;
    }
  });

  it("a mirrored sideways copy on the opposite side is the mirror image (handed parts swapped)", () => {
    // Carrier with studs on both sides (+z and −z); a handed panel: a plate and a right wedge plate.
    const d: BrickDesign = {
      name: "Both sides",
      description: "",
      subBuilds: [{ id: "side", name: "Side", parts: [P("plate_2x4", "red", 0, 0, 0, 90), P("41769b", "red", 0, 1, 0)], uses: [] }],
      main: {
        parts: [P("plate_4x4", "green", 0, 0, 0), P("47905", "white", 1, 1, 1)],
        uses: [
          // Anchored by their bottom row (local z runs top to bottom), so they stand above the base.
          { sub: "side", x: 0, y: 0, z: 0, rot: 0, mount: { part: 1, stud: 0, at: [0, 3], spin: 0 } },
          { sub: "side", x: 0, y: 0, z: 0, rot: 0, mirror: true, mount: { part: 1, stud: 1, at: [1, 3], spin: 0 } },
        ],
      },
    };
    const c = compileDesign(d);
    expect(c.errors).toEqual([]);
    const [a, b] = c.instances;
    const ids = (i: typeof a) => i.parts.map((k) => c.model.parts[k].part);
    expect(ids(a)).toEqual(["plate_2x4", "41769b"]);
    expect(ids(b)).toEqual(["plate_2x4", "41770b"]);
    // Mirror plane: the carrier's centre (z = 1.5 studs = 30 LDU).
    const boxes = (i: typeof a) => i.parts.flatMap((k) => worldBoxes(c.model.parts[k], getPart(c.model.parts[k].part)!)).map(([x0, y0, z0, x1, y1, z1]) => [x0, y0, z0, x1, y1, z1].join(",")).sort();
    const reflect = (i: typeof a) => i.parts.flatMap((k) => worldBoxes(c.model.parts[k], getPart(c.model.parts[k].part)!)).map(([x0, y0, z0, x1, y1, z1]) => [x0, y0, 60 - z1, x1, y1, 60 - z0].join(",")).sort();
    expect(reflect(b)).toEqual(boxes(a));
    // One side-stud joint per side on the carrier (#1); the plate and wedge inside each copy are joined too.
    expect(c.validation!.connections.filter((x) => x.lower === 1 && x.kind === "side")).toHaveLength(2);
    expect(c.validation!.valid).toBe(true);
  });

  it("renders sideways parts in place", async () => {
    const c = compileDesign(design());
    const zlib = await import("node:zlib");
    const png = await renderModel(c.model, { azimuth: 0, elevation: 5 }, { width: 120, height: 120 });
    const w = png.readUInt32BE(16);
    let o = 8;
    const idat: Buffer[] = [];
    while (o < png.length) {
      const len = png.readUInt32BE(o);
      if (png.subarray(o + 4, o + 8).toString() === "IDAT") idat.push(png.subarray(o + 8, o + 8 + len));
      o += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    let red = 0;
    for (let y = 0; y < 120; y++) for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3;
      if (raw[i] > 90 && raw[i] > 2.5 * raw[i + 1] && raw[i] > 2.5 * raw[i + 2]) red++;
    }
    expect(red).toBeGreaterThan(500); // the red panel faces the camera
  });

  it("builds the panel in its own manual section, upright, then attaches it after the base", () => {
    const d = design();
    const c = compileDesign(d);
    const sections = designSteps(d, c).sections;
    expect(sections.map((s) => s.sub)).toEqual(["panel", null]);
    expect(sections[0].model.parts[0].frame).toBeUndefined(); // built flat
    const pages = manualPages(sections);
    expect(pages.at(-1)!.copies.map((x) => x.sub)).toEqual(["panel"]);
  });
});
