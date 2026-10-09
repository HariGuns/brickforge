import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { loadPartMeshes, partEdges, partGeometry, PLATE_H, setMeshReader } from "./brickGeometry";
import { getPart, PARTS, SNOT_PARTS } from "@/lib/parts/library";
import { P } from "@/lib/fixtures/samples";

const bounds = (g: THREE.BufferGeometry) => {
  g.computeBoundingBox();
  return g.boundingBox!;
};

// The viewer draws a model as soon as it arrives, while catalog meshes are still loading.
// This file runs in a fresh module, so no mesh has loaded until the last test loads them.
describe("viewer geometry before meshes load", () => {
  it("draws a scene on a baseplate without crashing", () => {
    const scene = [P("3811", "green", 0, 0, 0), P("brick_2x4", "red", 4, 0, 4), P("plate_4x4", "white", 10, 0, 10)];
    for (const pl of scene) {
      const geo = partGeometry(pl.part);
      expect(geo?.getAttribute("position").count, pl.part).toBeGreaterThan(0);
      expect(partEdges(pl.part), pl.part).not.toBeNull();
    }
  });

  it("shows a baseplate as its thin body under y = 0 across the whole footprint", () => {
    for (const id of ["3867", "3334", "3811", "3645", "4186"]) {
      const def = getPart(id)!;
      const b = bounds(partEdges(id)!);
      expect(b.min.y, id).toBeCloseTo(-0.5 * PLATE_H);
      expect(b.max.y, id).toBeCloseTo(0);
      expect(b.max.x - b.min.x, id).toBeGreaterThan(def.w - 0.1);
      expect(b.max.z - b.min.z, id).toBeGreaterThan(def.d - 0.1);
    }
  });

  it("gives every part a geometry", () => {
    for (const def of [...PARTS, ...SNOT_PARTS]) expect(() => partGeometry(def.id), def.id).not.toThrow();
  });

  it("swaps a baseplate's stand-in for its real mesh once loaded", async () => {
    const before = partGeometry("3811")!.getAttribute("position").count;
    setMeshReader(async (id) => {
      const buf = fs.readFileSync(path.resolve("public/parts", `${id}.bin`));
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    });
    expect(await loadPartMeshes(["3811"])).toBe(true);
    expect(partGeometry("3811")!.getAttribute("position").count).not.toBe(before);
  });
});
