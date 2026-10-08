import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CONFIG } from "../config";
import { generateDesign } from "./subbuilds";
import { simulatedClient } from "./simulated";
import { planJsonSchema } from "../prompts/subbuilds";
import { designSteps } from "../design/steps";
import { compileDesign } from "../design/compile";
import { manualPages } from "../manual/pages";
import { groupParts } from "../model/stats";
import { wantedItems } from "../bricklink/wantedList";
import { exportDesignMpd } from "../ldraw/export";
import { baseplatesFor } from "../parts/baseplates";
import { validate } from "../validate/validator";
import { P } from "../fixtures/samples";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const lib = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "brickforge-lib-"));
  dirs.push(d);
  return d;
};

describe("scenes stand on a baseplate (simulated Claude)", () => {
  it("lays the baseplate under the town square, lists it, and puts it on manual page 1", async () => {
    const r = await generateDesign({ text: "a town square", detail: "very_high" }, () => {}, { client: simulatedClient(), library: lib() });
    dirs.push(r.debugDir);
    expect(r.valid).toBe(true);
    const main = r.design!.main.parts;
    const bp = main.filter((p) => p.part === "4186");
    expect(bp).toEqual([{ part: "4186", color: "green", x: 0, y: 0, z: 0, rot: 0 }]);
    // After the assembly's own parts, so its part numbers are unchanged.
    expect(main.at(-1)!.part).toBe("4186");
    expect(r.model!.parts.length).toBe(407);

    const compiled = compileDesign(r.design!);
    const steps = designSteps(r.design!, compiled);
    expect(steps.sections[0]).toMatchObject({ kind: "baseplate", name: "Baseplate", steps: [{ n: 1 }] });
    const bpIndex = steps.sections[0].steps[0].parts;
    expect(bpIndex.map((i) => compiled.model.parts[i].part)).toEqual(["4186"]);
    const mainSec = steps.sections.at(-1)!;
    expect(mainSec.base).toEqual(bpIndex);
    expect(mainSec.steps.flatMap((s) => s.parts)).not.toContain(bpIndex[0]);
    expect(steps.mainSteps[0].parts).toEqual(bpIndex);
    const pages = manualPages(steps.sections);
    expect(pages[0]).toMatchObject({ n: 1, label: "Baseplate", callout: [expect.objectContaining({ part: "4186", qty: 1 })] });
    expect(pages[1].label).toMatch(/^Sub-build/);

    expect(groupParts(r.model!).find((g) => g.name === "Baseplates")?.total).toBe(1);
    expect(wantedItems(r.model!).some((w) => w.id === "4186")).toBe(true);
    expect(exportDesignMpd(r.design!, compiled)).toMatch(/ 4186\.dat$/m);
  });

  it("is off with CONFIG.baseplates off: no scene field, no baseplate", async () => {
    CONFIG.baseplates.enabled = false;
    try {
      expect(Object.keys((planJsonSchema({ tree: true }).properties as object))).not.toContain("scene");
      const r = await generateDesign({ text: "a town square", detail: "very_high" }, () => {}, { client: simulatedClient(), library: lib() });
      dirs.push(r.debugDir);
      expect(r.model!.parts.length).toBe(406);
      expect(r.design!.main.parts.some((p) => p.part === "4186")).toBe(false);
    } finally {
      CONFIG.baseplates.enabled = true;
    }
  });

  it("tiles a scene too large for one baseplate: tiles connect only through a bridge", () => {
    const tiles = baseplatesFor({ x0: 0, z0: 0, w: 64, d: 32 }, "green");
    expect(tiles.map((t) => `${t.part}@${t.x}`)).toEqual(["3811@0", "3811@32"]);
    const grid = { x: 64, z: 32, y: 96 };
    const scene = [...tiles, P("brick_2x4", "red", 4, 0, 4), P("brick_2x4", "blue", 40, 0, 4)];
    expect(validate({ name: "s", description: "", parts: scene }, { grid }).errors.map((e) => e.code)).toEqual(["DISCONNECTED"]);
    const bridged = [...scene, P("plate_2x8", "dark_gray", 28, 0, 20)];
    expect(validate({ name: "s", description: "", parts: bridged }, { grid }).errors).toEqual([]);
  });
});
