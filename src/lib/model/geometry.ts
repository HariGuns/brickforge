import { getPart, localStuds, type PartDef } from "../parts/library";
import type { Placement, Rot } from "./schema";

/**
 * Coordinate system (shared by the validator, viewer and LDraw export):
 *   x = studs to the right, z = studs toward the front, y = plates up.
 * Rotation `rot` turns the part about the vertical axis so that local +x points
 * toward world +z at rot 90 (clockwise when viewed from above with +z at the
 * bottom of the screen). The placement (x, z) is always the min corner of the
 * rotated footprint, so rotation never moves the part out of its bounding box.
 */

export interface Footprint {
  x0: number;
  z0: number;
  /** Size along world x / z after rotation. */
  sx: number;
  sz: number;
  y0: number;
  /** Exclusive top in plates. */
  y1: number;
}

export function rotatedSize(p: PartDef, rot: Rot): { sx: number; sz: number } {
  return rot === 90 || rot === 270 ? { sx: p.d, sz: p.w } : { sx: p.w, sz: p.d };
}

/** Map a local cell to its offset inside the rotated footprint. */
export function rotateCell(cx: number, cz: number, p: PartDef, rot: Rot): [number, number] {
  switch (rot) {
    case 0:
      return [cx, cz];
    case 90:
      return [p.d - 1 - cz, cx];
    case 180:
      return [p.w - 1 - cx, p.d - 1 - cz];
    case 270:
      return [cz, p.w - 1 - cx];
  }
}

export function footprint(pl: Placement, def: PartDef): Footprint {
  const { sx, sz } = rotatedSize(def, pl.rot);
  return { x0: pl.x, z0: pl.z, sx, sz, y0: pl.y, y1: pl.y + def.h };
}

/** World cells [x, z] covered by the footprint. */
export function footprintCells(fp: Footprint): [number, number][] {
  const out: [number, number][] = [];
  for (let dz = 0; dz < fp.sz; dz++) for (let dx = 0; dx < fp.sx; dx++) out.push([fp.x0 + dx, fp.z0 + dz]);
  return out;
}

/** World cells [x, z] that carry a stud on top of the part. */
export function worldStuds(pl: Placement, def: PartDef): [number, number][] {
  return localStuds(def).map(([cx, cz]) => {
    const [ox, oz] = rotateCell(cx, cz, def, pl.rot);
    return [pl.x + ox, pl.z + oz];
  });
}

/** Resolved placement: definition plus geometry, or null if the part id is unknown. */
export interface Resolved {
  index: number;
  pl: Placement;
  def: PartDef;
  fp: Footprint;
}

export function resolve(parts: Placement[]): (Resolved | null)[] {
  return parts.map((pl, index) => {
    const def = getPart(pl.part);
    return def ? { index, pl, def, fp: footprint(pl, def) } : null;
  });
}

/** Human-readable part reference used in errors and prompts, e.g. `#12 brick_2x4 @(3,6,0) rot90`. */
export function describe(pl: Placement, index: number): string {
  return `#${index} ${pl.part} @(x=${pl.x},y=${pl.y},z=${pl.z}) rot${pl.rot}`;
}
