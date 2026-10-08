import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { placementCheck } from "./placement";
import { loadLibrary, makeComponent } from "./library";
import { P } from "../fixtures/samples";
import { SAMPLE_VILLAGE } from "../fixtures/designs";
import { validate } from "../validate/validator";
import { generateDesign } from "../claude/subbuilds";
import { simulatedClient } from "../claude/simulated";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "brickforge-lib-"));
  dirs.push(d);
  return d;
};

// A lamp post like run 1's: one tall round 1×1 brick with a lamp on top.
const lamp = [P("43888", "black", 0, 0, 0), P("round_brick_1x1", "yellow", 0, 18, 0), P("round_plate_1x1", "black", 0, 21, 0)];
const sub = (id: string, parts: ReturnType<typeof P>[]) => [{ id, name: "Lamp post", parts, uses: [] }];

describe("placement check", () => {
  it("passes a single-stud post standing alone, and fails it on a baseplate and on a plate", () => {
    expect(validate({ name: "l", description: "", parts: lamp }, { structure: "error" }).valid).toBe(true);
    const r = placementCheck({ name: "l", description: "", parts: lamp });
    expect(r.results.map((x) => [x.surface, x.issues.map((i) => i.code)])).toEqual([
      ["baseplate", ["WEAK_JOINT"]],
      ["plate", ["WEAK_JOINT"]],
    ]);
    // Reported once, with the original part numbers.
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].message).toMatch(/^Standing on a baseplate, as it will in the model: #0 43888 @\(x=0,y=0,z=0\)/);
  });

  it("passes the same post on a 2×2 round plate, and leaves sound sub-builds alone", () => {
    const fixed = [P("round_plate_2x2", "black", 0, 0, 0), ...lamp.map((p) => ({ ...p, y: p.y + 1 }))];
    expect(placementCheck({ name: "l", description: "", parts: fixed }).errors).toEqual([]);
    for (const s of SAMPLE_VILLAGE.subBuilds.filter((x) => !x.uses.length)) expect(placementCheck({ name: s.id, description: "", parts: s.parts }).errors).toEqual([]);
  });

  it("turns the test plate to fit the footprint (catalog plates list width and depth the other way round)", () => {
    // A 2×10 plate lying along z: only Plate 2×10 turned 90° covers it.
    const r = placementCheck({ name: "strip", description: "", parts: [P("3832", "red", 0, 0, 0, 90)] });
    expect(r.results[1]).toMatchObject({ surface: "plate", plate: { id: "3832", rot: 90 }, issues: [] });
  });

  it("keeps a component that only passes on its own out of the library, with the reason", () => {
    let why = "";
    expect(makeComponent(sub("lamp_post", lamp), "lamp_post", { rejected: (w) => (why = w) })).toBeNull();
    expect(why).toMatch(/fails when placed: WEAK_JOINT/);
    expect(makeComponent(sub("lamp_post", [P("round_plate_2x2", "black", 0, 0, 0), ...lamp.map((p) => ({ ...p, y: p.y + 1 }))]), "lamp_post", {})).not.toBeNull();
  });

  it("makes a sub-build repair a single-stud base during its own design (simulated Claude)", async () => {
    const library = tmp();
    const r = await generateDesign({ text: "a town square", detail: "very_high" }, () => {}, { client: simulatedClient({ weakFirst: ["Tower wall block"] }), library });
    dirs.push(r.debugDir);
    expect(r.valid).toBe(true);
    const block = r.rounds.filter((x) => x.scope === "sub:tower_wall_block");
    expect(block.map((x) => x.errorCodes)).toEqual([{ WEAK_JOINT: 1 }, {}]);
    expect(r.repairRemovals).toEqual([]);
    const saved = loadLibrary(library).components.find((c) => c.name === "Tower wall block")!;
    expect(saved.subBuilds[0].parts[0].part).toBe("brick_2x2");
  });
});
