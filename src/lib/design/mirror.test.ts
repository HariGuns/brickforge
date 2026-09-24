import { describe, expect, it } from "vitest";
import { compileDesign } from "./compile";
import { designSteps } from "./steps";
import type { BrickDesign } from "./schema";
import { P } from "../fixtures/samples";
import { rotateCell, worldBottom, worldStuds } from "../model/geometry";
import { getPart, type PartDef } from "../parts/library";
import { mirrorOf, mirrorPlacement } from "../parts/mirror";
import { exportDesignMpd } from "../ldraw/export";
import { importLdr } from "../ldraw/import";
import type { Rot } from "../model/schema";

// A handed side piece: plate, a right-hand wedge plate (studs only on its x = 1 column), a brick on the wedge's
// studs, a slope, and a nested handed detail — so a mirror image is genuinely different from the original.
const design = (rot: Rot): BrickDesign => ({
  name: "Mirror test",
  description: "",
  subBuilds: [
    { id: "fin", name: "Fin", parts: [P("41769b", "blue", 0, 0, 0)], uses: [] },
    {
      id: "side",
      name: "Side",
      parts: [P("plate_2x4", "red", 0, 0, 0, 90), P("41769b", "red", 0, 1, 0), P("brick_1x2", "white", 1, 2, 0, 90), P("slope45_2x1", "white", 1, 5, 0, 90)],
      uses: [{ sub: "fin", x: 0, y: 2, z: 2, rot: 0 }],
    },
  ],
  main: {
    // One base plate under both copies: 8 × 4 for rot 0 (copies side by side in x), 4 × 8 for rot 90.
    parts: [P("plate_4x8", "dark_gray", 0, 0, 0, rot === 0 ? 0 : 90)],
    uses: [
      { sub: "side", x: 0, y: 1, z: 0, rot },
      { sub: "side", x: rot === 0 ? 4 : 0, y: 1, z: rot === 0 ? 0 : 4, rot, mirror: true },
    ],
  },
});

/** Each stud joint inside a copy, as (lower local index, upper local index, contact cells in the copy's own frame). */
function joints(d: BrickDesign, copy: number, flip: boolean) {
  const c = compileDesign(d);
  expect(c.errors).toEqual([]);
  const inst = c.instances.filter((i) => i.parent === -1)[copy];
  const use = d.main.uses[copy];
  const box = c.boxes[use.sub];
  const W = box.maxX - box.minX, D = box.maxZ - box.minZ;
  const pseudo = { w: W, d: D } as PartDef;
  // World cell → the copy's own (unrotated) frame, flipped back for the mirrored copy.
  const toLocal = (x: number, z: number) => {
    for (let cz = 0; cz < D; cz++)
      for (let cx = 0; cx < W; cx++) {
        const [ox, oz] = rotateCell(cx, cz, pseudo, use.rot);
        if (use.x + ox === x && use.z + oz === z) return `${flip ? W - 1 - cx : cx},${cz}`;
      }
    throw new Error("cell outside the copy");
  };
  const local = new Map(inst.parts.map((p, k) => [p, k]));
  const out: string[] = [];
  for (const j of c.validation!.connections) {
    if (!local.has(j.lower) || !local.has(j.upper)) continue;
    const lo = c.model.parts[j.lower], up = c.model.parts[j.upper];
    const bottoms = new Set(worldBottom(up, getPart(up.part)!).map((b) => b.join(",")));
    const cells = worldStuds(lo, getPart(lo.part)!).filter((s) => bottoms.has(s.join(","))).map(([x, z, y]) => `${toLocal(x, z)},${y - lo.y}`);
    out.push(`${local.get(j.lower)}→${local.get(j.upper)} [${cells.sort().join(" ")}]`);
  }
  return { list: out.sort(), parts: inst.parts.map((i) => c.model.parts[i].part), compiled: c };
}

describe("mirrored sub-build copies", () => {
  it("knows each part's mirror image from its connection data", () => {
    expect(mirrorOf("41769b")).toEqual({ id: "41770b", rot: 0 });
    expect(mirrorOf("brick_2x4")).toEqual({ id: "brick_2x4", rot: 0 });
    expect(mirrorOf("4624c01")?.id).toBe("4624c01"); // a wheel turns to face the other way
    expect(mirrorPlacement(P("slope45_2x1", "red", 1, 0, 0, 90), 0, 4)).toEqual(P("slope45_2x1", "red", 1, 0, 0, 270));
  });

  for (const rot of [0, 90] as Rot[]) {
    it(`a mirrored copy (rot ${rot}) has exactly the mirror image of the original's connections`, () => {
      const original = joints(design(rot), 0, false);
      const mirrored = joints(design(rot), 1, true);
      expect(original.list.length).toBeGreaterThanOrEqual(4);
      expect(mirrored.list).toEqual(original.list);
      // Handed parts are swapped, symmetric ones kept.
      expect(original.parts).toEqual(["plate_2x4", "41769b", "brick_1x2", "slope45_2x1", "41769b"]);
      expect(mirrored.parts).toEqual(["plate_2x4", "41770b", "brick_1x2", "slope45_2x1", "41770b"]);
      expect(original.compiled.validation?.valid).toBe(true);
    });
  }

  it("builds mirrored copies as their own manual section and exports them as their own submodel", () => {
    const d = design(0);
    const c = compileDesign(d);
    const sections = designSteps(d, c).sections.map((s) => `${s.sub}|${s.name}|${s.copies}`);
    expect(sections).toEqual(["fin|Fin|1", "fin~m|Fin (mirrored)|1", "side|Side|1", "side~m|Side (mirrored)|1", "null|Mirror test|1"]);
    const mpd = exportDesignMpd(d, c);
    expect(mpd).toContain("0 FILE sub_side_mirrored.ldr");
    expect(mpd).toContain("0 FILE sub_fin_mirrored.ldr");
    const back = importLdr(mpd);
    const key = (p: { part: string; x: number; y: number; z: number; rot: number }) => `${p.part}|${p.x},${p.y},${p.z}|${p.rot}`;
    expect(back.model.parts.map(key).sort()).toEqual(c.model.parts.map(key).sort());
  });

  it("reports parts with no mirror image", () => {
    const d = design(0);
    d.subBuilds[1].parts.push(P("57783", "trans_clear", 0, 2, 2));
    expect(mirrorOf("57783")).toBeNull();
    expect(compileDesign(d).errors.map((e) => e.code)).toContain("MIRROR_UNSUPPORTED");
  });
});
