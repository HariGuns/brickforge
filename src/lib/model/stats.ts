import { COLOR_MAP } from "../parts/colors";
import { getPart, PARTS, type PartCategory } from "../parts/library";
import { footprint } from "./geometry";
import type { BrickModel } from "./schema";

export interface PartCount {
  part: string;
  name: string;
  ldraw: string;
  color: string;
  colorName: string;
  hex: string;
  qty: number;
}

const ORDER = new Map(PARTS.map((p, i) => [p.id, i]));
const CATEGORY_LABEL: Record<PartCategory, string> = {
  brick: "Bricks",
  plate: "Plates",
  tile: "Tiles",
  slope: "Slopes & roof",
  round: "Round parts",
  cone: "Cones",
  arch: "Arches",
  window: "Windows",
  door: "Doors",
  fence: "Fences",
  flower: "Flowers",
  curved: "Curved slopes",
  wedge: "Wedges",
  windscreen: "Windscreens",
  panel: "Panels",
  holder: "Wheel holders",
  wheel: "Wheels",
  vehicle: "Vehicle parts",
  technic: "Technic bricks",
  other: "Other",
};

/** Part × colour counts for the given part indices (default: all), in library order. */
export function countParts(model: BrickModel, indices?: number[]): PartCount[] {
  const counts = new Map<string, PartCount>();
  for (const i of indices ?? model.parts.map((_, i) => i)) {
    const p = model.parts[i];
    const k = `${p.part}|${p.color}`;
    let e = counts.get(k);
    if (!e) {
      const def = getPart(p.part);
      const c = COLOR_MAP.get(p.color);
      e = { part: p.part, name: def?.name ?? p.part, ldraw: def?.ldraw.file ?? "?", color: p.color, colorName: c?.name ?? p.color, hex: c?.hex ?? "#ff00ff", qty: 0 };
      counts.set(k, e);
    }
    e.qty++;
  }
  return [...counts.values()].sort((a, b) => (ORDER.get(a.part) ?? 999) - (ORDER.get(b.part) ?? 999) || b.qty - a.qty);
}

/** Counts grouped by part category (Bricks, Plates, Tiles, Slopes), empty groups omitted. */
export function groupParts(model: BrickModel): { name: string; total: number; rows: PartCount[] }[] {
  const rows = countParts(model);
  return (Object.keys(CATEGORY_LABEL) as PartCategory[])
    .map((cat) => {
      const r = rows.filter((x) => getPart(x.part)?.category === cat);
      return { name: CATEGORY_LABEL[cat], total: r.reduce((s, x) => s + x.qty, 0), rows: r };
    })
    .filter((g) => g.rows.length > 0);
}

export interface ModelStats {
  pieces: number;
  /** Footprint in studs (x × z) and height in plates. */
  width: number;
  depth: number;
  heightPlates: number;
  layers: number;
  partTypes: number;
  colors: number;
}

export function modelStats(model: BrickModel): ModelStats {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y1 = 0;
  const layers = new Set<number>();
  for (const pl of model.parts) {
    const def = getPart(pl.part);
    if (!def) continue;
    const fp = footprint(pl, def);
    x0 = Math.min(x0, fp.x0); x1 = Math.max(x1, fp.x0 + fp.sx);
    z0 = Math.min(z0, fp.z0); z1 = Math.max(z1, fp.z0 + fp.sz);
    y1 = Math.max(y1, fp.y1);
    layers.add(pl.y);
  }
  const empty = !Number.isFinite(x0);
  return {
    pieces: model.parts.length,
    width: empty ? 0 : x1 - x0,
    depth: empty ? 0 : z1 - z0,
    heightPlates: y1,
    layers: layers.size,
    partTypes: new Set(model.parts.map((p) => p.part)).size,
    colors: new Set(model.parts.map((p) => p.color)).size,
  };
}
