import type { Placement, Rot } from "../model/schema";
import { footprint } from "../model/geometry";
import { getPart, PARTS } from "./library";

/** Baseplates in the catalog, smallest first: [w, d, id]. */
export const BASEPLATES = PARTS.filter((p) => p.category === "baseplate")
  .map((p) => [p.w, p.d, p.id] as [number, number, string])
  .sort((a, b) => a[0] * a[1] - b[0] * b[1]);

export interface Rect {
  x0: number;
  z0: number;
  w: number;
  d: number;
}

/** The ground footprint of a model's upright parts (baseplates and exact-frame parts left out), or null if it has none. */
export function groundFootprint(parts: Placement[]): Rect | null {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of parts) {
    const def = getPart(p.part);
    if (!def || p.frame || def.category === "baseplate") continue;
    const f = footprint(p, def);
    x0 = Math.min(x0, f.x0); z0 = Math.min(z0, f.z0); x1 = Math.max(x1, f.x0 + f.sx); z1 = Math.max(z1, f.z0 + f.sz);
  }
  return x0 === Infinity ? null : { x0, z0, w: x1 - x0, d: z1 - z0 };
}

/**
 * Baseplates under a footprint. The smallest single baseplate that covers it
 * (turned if that's the way it fits), kept inside the build area when one is
 * given. If none covers it, a grid of equal square tiles (16, 32 or 48: fewest
 * tiles, then least area). Each tile is its own ground: sections on different
 * tiles connect only through parts that bridge the seam.
 */
export function baseplatesFor(fp: Rect, color: string, grid?: { x: number; z: number }): Placement[] {
  for (const [w, d, id] of BASEPLATES)
    for (const rot of [0, 90] as Rot[]) {
      const [W, D] = rot ? [d, w] : [w, d];
      if (W < fp.w || D < fp.d) continue;
      const x = grid ? Math.max(0, Math.min(fp.x0, grid.x - W)) : fp.x0;
      const z = grid ? Math.max(0, Math.min(fp.z0, grid.z - D)) : fp.z0;
      if (grid && (x + W > grid.x || z + D > grid.z)) continue;
      return [{ part: id, color, x, y: 0, z, rot }];
    }
  const squares = BASEPLATES.filter(([w, d]) => w === d);
  const best = squares
    .map(([s, , id]) => ({ s, id, nx: Math.ceil(fp.w / s), nz: Math.ceil(fp.d / s) }))
    .sort((a, b) => a.nx * a.nz - b.nx * b.nz || a.s - b.s)[0];
  const out: Placement[] = [];
  for (let i = 0; i < best.nx; i++) for (let k = 0; k < best.nz; k++) out.push({ part: best.id, color, x: fp.x0 + i * best.s, y: 0, z: fp.z0 + k * best.s, rot: 0 });
  return out;
}
