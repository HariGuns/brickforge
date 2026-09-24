import { getPart } from "../parts/library";
import { worldBottom, worldSolidCells, worldStuds } from "../model/geometry";
import type { BrickModel } from "../model/schema";

export interface SurfaceMaps {
  w: number;
  d: number;
  h: number;
  /** Rows z = 0..d-1; each cell is its top height in plates, "*" if a usable stud is there, "." if empty. */
  top: string[];
  /** Rows z = 0..d-1; "o" where the underside at y = 0 takes a stud, "." otherwise. */
  bottom: string[];
  /** Usable top studs, grouped by height: "12: (0,0) (1,0)". */
  studsByHeight: string[];
}

/**
 * Describe a sub-build's outside for the assembly stage: its footprint, what
 * its top looks like (and where studs can take parts), and where its underside
 * can sit on studs. Assumes the sub-build starts at x = z = 0 (min corner).
 */
export function surfaceMaps(model: BrickModel): SurfaceMaps {
  let w = 0, d = 0, h = 0;
  const colTop = new Map<string, number>();
  const studTop = new Map<string, number>();
  const bottom = new Set<string>();
  for (const pl of model.parts) {
    const def = getPart(pl.part);
    if (!def) continue;
    for (const [x, y, z] of worldSolidCells(pl, def)) {
      w = Math.max(w, x + 1);
      d = Math.max(d, z + 1);
      h = Math.max(h, y + 1);
      const k = `${x},${z}`;
      colTop.set(k, Math.max(colTop.get(k) ?? 0, y + 1));
    }
    for (const [x, z] of worldStuds(pl, def)) {
      const k = `${x},${z}`;
      studTop.set(k, Math.max(studTop.get(k) ?? 0, pl.y + def.h));
    }
    if (pl.y === 0) for (const [x, z] of worldBottom(pl, def)) bottom.add(`${x},${z}`);
  }
  const top: string[] = [];
  const bot: string[] = [];
  const byHeight = new Map<number, string[]>();
  for (let z = 0; z < d; z++) {
    const row: string[] = [];
    const brow: string[] = [];
    for (let x = 0; x < w; x++) {
      const k = `${x},${z}`;
      const t = colTop.get(k);
      const usable = t !== undefined && studTop.get(k) === t;
      row.push(t === undefined ? "." : `${t}${usable ? "*" : ""}`);
      brow.push(bottom.has(k) ? "o" : ".");
      if (usable) (byHeight.get(t!) ?? byHeight.set(t!, []).get(t!)!).push(`(${x},${z})`);
    }
    top.push(row.join(" "));
    bot.push(brow.join(" "));
  }
  const studsByHeight = [...byHeight].sort((a, b) => b[0] - a[0]).map(([y, cells]) => `${y}: ${cells.join(" ")}`);
  return { w, d, h, top, bottom: bot, studsByHeight };
}
