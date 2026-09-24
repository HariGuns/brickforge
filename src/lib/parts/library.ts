/**
 * Part library.
 *
 * Every part is described in its own local frame on the stud grid:
 *   - `w` = size along x (studs), `d` = size along z (studs), `h` = height in plates
 *     (1 brick = 3 plates).
 *   - Local cell (0,0) is the min-x / min-z corner.
 *   - Convention: at rot 0 the long side runs along x (e.g. brick_1x4 is w=4, d=1).
 *     Slopes are named depth×width like the real parts (slope45_2x4 is w=4, d=2).
 *   - `studs` lists which top cells carry a stud. Omit it to mean "every cell";
 *     use [] for no studs (tiles).
 *   - The underside of every part accepts a stud in every footprint cell.
 *
 * `ldraw` maps the local frame onto the official LDraw part:
 *   - `file`: LDraw part file.
 *   - `yaw`: extra rotation (degrees about vertical, same sense as placement `rot`)
 *     that turns our local frame into the LDraw part's native orientation.
 *   - `origin`: where our footprint's top-centre sits in the part's native LDraw
 *     coordinates. Defaults to [0, 0, 0] (true for bricks/plates/tiles).
 *   - `scripts/verify-ldraw.ts` checks all of this against the real LDraw library.
 *
 * To add a part: add an entry here, run `npm run verify-ldraw`, and it becomes
 * available to Claude automatically (the prompt lists the library).
 *
 * The extended catalog (catalog.json, ~900 parts) is generated from the LDraw
 * library and LDCad's shadow library by scripts/build-catalog.ts. Catalog
 * parts can have studs and anti-studs at several heights, wheel pins and hubs,
 * and render from real LDraw meshes (public/parts/<id>.bin). Claude sees the
 * core menu (core.ts) in its prompt and finds the rest with the search_parts tool.
 */

import catalogJson from "./catalog.json";
import { CONFIG } from "../config";
import type { CatalogEntry, ConnectorCell, Dir, PinDef } from "./catalogTypes";

export type { ConnectorCell, Dir, PinDef, PinKind } from "./catalogTypes";

export type PartCategory =
  | "brick"
  | "plate"
  | "tile"
  | "slope"
  | "curved"
  | "wedge"
  | "round"
  | "cone"
  | "arch"
  | "window"
  | "windscreen"
  | "door"
  | "panel"
  | "fence"
  | "flower"
  | "holder"
  | "wheel"
  | "vehicle"
  | "technic"
  | "other";

/** How the 3D viewer draws the part (LDraw export always uses the real part). */
export type PartShape = "box" | "slope" | "ridge" | "round" | "cone" | "fence" | "arch" | "window" | "door" | "flower";

/** A solid region in local cells and plates: x0..x1, z0..z1 (exclusive), y0..y1 (exclusive). */
export type Solid = [number, number, number, number, number, number];

export interface PartDef {
  id: string;
  name: string;
  category: PartCategory;
  w: number;
  d: number;
  h: number;
  /** Studs, local [cx, cz] on top, or [cx, cz, level] at `level` plates above the bottom. Undefined = every top cell. */
  studs?: ConnectorCell[];
  /** Anti-studs (take a stud from below), local [cx, cz] at the bottom or [cx, cz, level]. Undefined = every cell at the bottom. */
  bottom?: ConnectorCell[];
  /** Wheel pins sticking out of the part (wheel holders). */
  pins?: PinDef[];
  /** A wheel's hub: it attaches only by sitting exactly on a free pin of its kind. */
  hub?: PinDef;
  /** Left/right counterpart (for mirrored sub-builds). */
  mirror?: string;
  /** "core": hand-made, always in Claude's prompt. "catalog": generated, found with search_parts. */
  source?: "core" | "catalog";
  /** Rendered from its LDraw mesh (public/parts/<id>.bin) rather than a hand-made shape. */
  mesh?: boolean;
  /** Anti-studs inferred from geometry (the shadow library has none for this part). */
  inferred?: boolean;
  /** BrickLink items when they differ from the LDraw number. */
  bricklink?: { id: string; color?: number }[];
  /** Studs on the part's sides (a carrier for sideways building): base point and outward direction. */
  sideStuds?: { at: [number, number, number]; dir: Dir }[];
  /** Body outside the grid box (a bracket's flange), LDU boxes [x0, y0, z0, x1, y1, z1] in the local frame. */
  fine?: [number, number, number, number, number, number][];
  /** A side-stud part (only loaded when CONFIG.sideways.enabled). */
  snot?: boolean;
  /** Space the part fills, for collisions. Undefined = its whole box. */
  solids?: Solid[];
  shape?: PartShape;
  /** Fraction of the box that's material, for the mass estimate (default 1; slopes 0.75). */
  massFactor?: number;
  ldraw: {
    file: string;
    yaw: 0 | 90 | 180 | 270;
    /** Native LDraw coords (LDU) of our footprint's top-centre point, if the part's origin isn't there. */
    origin?: [number, number, number];
    /** Extra LDraw parts written with this one (e.g. a door in its frame), at native offsets (LDU). */
    extra?: { file: string; offset: [number, number, number] }[];
    /** Verification: tabs may rise up to one stud height above the top face. */
    topTabs?: boolean;
    /** Verification: bounding-box tolerance in LDU (default 1). */
    slack?: number;
    /** Verification: the real part has a stud between grid cells (unusable on the grid, so not modelled). */
    offGridStud?: boolean;
  };
  /** One-line hint shown to Claude. */
  hint?: string;
}

const BRICK = 3;
const PLATE = 1;

/** Conventional "small x large" name, e.g. dims(4, 1) = "1x4". */
function dims(w: number, d: number, sep = "x"): string {
  return `${Math.min(w, d)}${sep}${Math.max(w, d)}`;
}

function brick(w: number, d: number, file: string, yaw: PartDef["ldraw"]["yaw"] = 0): PartDef {
  return { id: `brick_${dims(w, d)}`, name: `Brick ${dims(w, d, "×")}`, category: "brick", w, d, h: BRICK, ldraw: { file, yaw } };
}
function plate(w: number, d: number, file: string, yaw: PartDef["ldraw"]["yaw"] = 0): PartDef {
  return { id: `plate_${dims(w, d)}`, name: `Plate ${dims(w, d, "×")}`, category: "plate", w, d, h: PLATE, ldraw: { file, yaw } };
}
function tile(w: number, d: number, file: string, yaw: PartDef["ldraw"]["yaw"] = 0): PartDef {
  return {
    id: `tile_${dims(w, d)}`,
    name: `Tile ${dims(w, d, "×")}`,
    category: "tile",
    w,
    d,
    h: PLATE,
    studs: [],
    ldraw: { file, yaw },
    hint: "smooth top, nothing can attach on top",
  };
}
/**
 * 45° slope. Local frame: the studded (flat) row is z = 0, the slope descends
 * toward +z. So at rot 0 the slope faces +z ("front").
 */
function slope(w: number, file: string): PartDef {
  const studs: [number, number][] = [];
  for (let cx = 0; cx < w; cx++) studs.push([cx, 0]);
  return {
    id: `slope45_2x${w}`,
    name: `Slope 45° 2×${w}`,
    category: "slope",
    w,
    d: 2,
    h: BRICK,
    studs,
    // LDraw slopes put their origin under the stud row, 10 LDU behind the footprint centre.
    ldraw: { file, yaw: 0, origin: [0, 0, -10] },
    hint: "brick height; studs only on the back row (local z=0); slope face descends toward local +z",
  };
}

export const CORE_PARTS: PartDef[] = [
  brick(1, 1, "3005.dat"),
  brick(2, 1, "3004.dat"),
  brick(3, 1, "3622.dat"),
  brick(4, 1, "3010.dat"),
  brick(6, 1, "3009.dat"),
  brick(8, 1, "3008.dat"),
  brick(2, 2, "3003.dat"),
  brick(3, 2, "3002.dat"),
  brick(4, 2, "3001.dat"),
  brick(6, 2, "2456.dat"),
  brick(8, 2, "3007.dat"),

  plate(1, 1, "3024.dat"),
  plate(2, 1, "3023b.dat"),
  plate(3, 1, "3623.dat"),
  plate(4, 1, "3710.dat"),
  plate(6, 1, "3666.dat"),
  plate(8, 1, "3460.dat"),
  plate(2, 2, "3022.dat"),
  plate(3, 2, "3021.dat"),
  plate(4, 2, "3020.dat"),
  plate(6, 2, "3795.dat"),
  plate(8, 2, "3034.dat"),
  plate(4, 4, "3031.dat"),
  plate(6, 4, "3032.dat"),
  plate(8, 4, "3035.dat"),

  tile(1, 1, "3070b.dat"),
  tile(2, 1, "3069b.dat"),
  tile(4, 1, "2431.dat"),
  tile(2, 2, "3068b.dat"),

  slope(1, "3040b.dat"),
  slope(2, "3039.dat"),
  slope(4, "3037.dat"),

  // Roof: 33° slopes (3 deep) and 45° ridges.
  slope33(2, "3298.dat"),
  slope33(4, "3297.dat"),
  ridge(1, "3044b.dat"),
  ridge(2, "3043.dat"),

  // Round bricks, plates and tiles.
  round("round_brick_1x1", "Round brick 1×1", 1, BRICK, "3062b.dat"),
  round("round_brick_2x2", "Round brick 2×2", 2, BRICK, "3941.dat"),
  round("round_plate_1x1", "Round plate 1×1", 1, PLATE, "6141.dat"),
  round("round_plate_2x2", "Round plate 2×2", 2, PLATE, "4032b.dat"),
  { ...round("round_tile_1x1", "Round tile 1×1", 1, PLATE, "98138.dat"), category: "tile", studs: [], hint: "smooth round top, nothing attaches on top" },

  // Cones.
  { id: "cone_1x1", name: "Cone 1×1", category: "cone", shape: "cone", w: 1, d: 1, h: BRICK, massFactor: 0.5, ldraw: { file: "4589.dat", yaw: 0 }, hint: "tapers to a single stud on top" },
  {
    id: "cone_2x2x2",
    name: "Cone 2×2×2",
    category: "cone",
    shape: "cone",
    w: 2,
    d: 2,
    h: 2 * BRICK,
    studs: [], // its one stud is centred between cells, so nothing on the grid attaches to it
    massFactor: 0.45,
    ldraw: { file: "3942c.dat", yaw: 0, offGridStud: true },
    hint: "2 bricks tall, tapers to a point; nothing attaches on top",
  },

  // Fences (1 stud deep, no studs on top).
  fence("fence_1x4x1", "Fence 1×4×1 (lattice)", BRICK, "3633.dat"),
  fence("fence_1x4x2", "Fence 1×4×2 (picket)", 2 * BRICK, "33303.dat"),

  // Arches: open underneath between the legs.
  arch(4, "3659.dat"),
  arch(6, "3455.dat"),

  // Windows (with glass) and a door in its frame.
  window("window_1x2x2", "Window 1×2×2", 2 * BRICK, "60592c01.dat"),
  window("window_1x2x3", "Window 1×2×3", 3 * BRICK, "60593c01.dat"),
  {
    id: "door_1x4x6",
    name: "Door 1×4×6 (frame + door)",
    category: "door",
    shape: "door",
    w: 4,
    d: 1,
    h: 6 * BRICK,
    studs: [
      [1, 0],
      [2, 0],
    ],
    massFactor: 0.35,
    // The door goes 32 LDU across and 5 LDU deep in the frame (per the LDraw part's own notes).
    ldraw: { file: "60596.dat", yaw: 0, topTabs: true, extra: [{ file: "60616a.dat", offset: [-32, 0, 5] }] },
    hint: "6 bricks tall; studs only on the two middle cells on top",
  },

  // Flowers (sit on a stud; petals overhang very slightly).
  { id: "flower_1x1", name: "Flower plate 1×1 (5 petals)", category: "flower", shape: "flower", w: 1, d: 1, h: PLATE, massFactor: 0.6, ldraw: { file: "24866.dat", yaw: 0 }, hint: "a flower head; has a stud on top" },
  { id: "flower_1x1_tabs", name: "Flower plate 1×1 (4 petals)", category: "flower", shape: "flower", w: 1, d: 1, h: PLATE, massFactor: 0.6, ldraw: { file: "33291.dat", yaw: 0, slack: 2.5 }, hint: "a four-petal flower; has a stud on top" },
];

/** 33° slope, 3 deep: flat stud row at local z = 0, slope descends toward +z over 2 studs. */
function slope33(w: number, file: string): PartDef {
  const studs: [number, number][] = [];
  for (let cx = 0; cx < w; cx++) studs.push([cx, 0]);
  return {
    id: `slope33_3x${w}`,
    name: `Slope 33° 3×${w}`,
    category: "slope",
    shape: "slope",
    w,
    d: 3,
    h: BRICK,
    studs,
    ldraw: { file, yaw: 0, origin: [0, 0, -20] },
    hint: "gentle roof slope; studs only on the back row (local z=0); slope descends toward local +z over 2 studs",
  };
}

/** 45° double slope (roof ridge): 2 deep, peak runs along x; no studs. */
function ridge(w: number, file: string): PartDef {
  return {
    id: `ridge45_2x${w}`,
    name: `Ridge 45° 2×${w}`,
    category: "slope",
    shape: "ridge",
    w,
    d: 2,
    h: BRICK,
    studs: [],
    ldraw: { file, yaw: 0 },
    hint: "roof ridge: slopes down on both sides (±z at rot 0), no studs; caps the top of two opposed slopes",
  };
}

function round(id: string, name: string, size: number, h: number, file: string): PartDef {
  return { id, name, category: "round", shape: "round", w: size, d: size, h, massFactor: 0.8, ldraw: { file, yaw: 0 } };
}

function fence(id: string, name: string, h: number, file: string): PartDef {
  return { id, name, category: "fence", shape: "fence", w: 4, d: 1, h, studs: [], massFactor: 0.3, ldraw: { file, yaw: 0 }, hint: "thin see-through fence; nothing attaches on top" };
}

/** Arch 1×w: legs are the end cells (full height, the only underside connectors); the span in between is only the top plate. */
function arch(w: number, file: string): PartDef {
  return {
    id: `arch_1x${w}`,
    name: `Arch 1×${w}`,
    category: "arch",
    shape: "arch",
    w,
    d: 1,
    h: BRICK,
    bottom: [
      [0, 0],
      [w - 1, 0],
    ],
    solids: [
      [0, 0, 1, 1, 0, BRICK],
      [w - 1, 0, w, 1, 0, BRICK],
      [1, 0, w - 1, 1, BRICK - 1, BRICK],
    ],
    massFactor: 0.7,
    ldraw: { file, yaw: 0 },
    hint: `opening under the middle ${w - 2} studs is 2 plates tall; only the two end cells connect underneath`,
  };
}

function window(id: string, name: string, h: number, file: string): PartDef {
  return { id, name, category: "window", shape: "window", w: 2, d: 1, h, massFactor: 0.4, ldraw: { file, yaw: 0 }, hint: `frame with clear glass, ${h / BRICK} bricks tall; 2 studs on top` };
}

for (const p of CORE_PARTS) p.source = "core";

const toDef = (e: CatalogEntry): PartDef => ({
  id: e.id,
  name: e.name,
  category: e.cat as PartCategory,
  w: e.w,
  d: e.d,
  h: e.h,
  ...(e.studs ? { studs: e.studs } : {}),
  ...(e.bottom ? { bottom: e.bottom } : {}),
  ...(e.solids ? { solids: e.solids } : {}),
  ...(e.pins ? { pins: e.pins } : {}),
  ...(e.hub ? { hub: e.hub } : {}),
  ...(e.mirror ? { mirror: e.mirror } : {}),
  ...(e.bricklink ? { bricklink: e.bricklink } : {}),
  ...(e.inferred ? { inferred: true } : {}),
  ...(e.hint ? { hint: e.hint } : {}),
  massFactor: e.mass,
  ldraw: { file: e.ldraw.file, yaw: e.ldraw.yaw, origin: e.ldraw.origin },
  source: "catalog",
  mesh: true,
  ...(e.snot ? { snot: true, sideStuds: e.sideStuds ?? [], ...(e.fine ? { fine: e.fine } : {}) } : {}),
});
const catalogEntries = (catalogJson as unknown as { parts: CatalogEntry[] }).parts;

/** Side-stud parts (carriers for sideways building); in PARTS only when CONFIG.sideways.enabled. */
export const SNOT_PARTS: PartDef[] = catalogEntries.filter((e) => e.snot).map(toDef);

/** Extended catalog, generated from LDraw + LDCad shadow data (see scripts/build-catalog.ts). */
export const CATALOG_PARTS: PartDef[] = [...catalogEntries.filter((e) => !e.snot).map(toDef), ...(CONFIG.sideways.enabled ? SNOT_PARTS : [])];

/** Every part: the hand-made core first, then the catalog. */
export const PARTS: PartDef[] = [...CORE_PARTS, ...CATALOG_PARTS];

export const PART_MAP: ReadonlyMap<string, PartDef> = new Map(PARTS.map((p) => [p.id, p]));
export const PART_IDS = PARTS.map((p) => p.id) as [string, ...string[]];

export function getPart(id: string): PartDef | undefined {
  return PART_MAP.get(id);
}

/** Local anti-studs [cx, cz, level] (resolves the "every cell at the bottom" default). */
export function localBottom(p: PartDef): [number, number, number][] {
  if (p.bottom) return p.bottom.map(([x, z, l]) => [x, z, l ?? 0]);
  const out: [number, number, number][] = [];
  for (let cz = 0; cz < p.d; cz++) for (let cx = 0; cx < p.w; cx++) out.push([cx, cz, 0]);
  return out;
}

/** Solid regions of a part (resolves the "whole box" default). */
export function localSolids(p: PartDef): Solid[] {
  return p.solids ?? [[0, 0, p.w, p.d, 0, p.h]];
}

/** Local studs [cx, cz, level] (resolves the "every top cell" default; level = plates above the bottom). */
export function localStuds(p: PartDef): [number, number, number][] {
  if (p.studs) return p.studs.map(([x, z, l]) => [x, z, l ?? p.h]);
  const out: [number, number, number][] = [];
  for (let cz = 0; cz < p.d; cz++) for (let cx = 0; cx < p.w; cx++) out.push([cx, cz, p.h]);
  return out;
}

/** Direction after turning a part by `rot` (local +x → world +z at rot 90). */
export function rotateDir(dir: Dir, rot: 0 | 90 | 180 | 270): Dir {
  const order: Dir[] = ["+x", "+z", "-x", "-z"];
  return order[(order.indexOf(dir) + rot / 90) % 4];
}

export const oppositeDir = (d: Dir): Dir => rotateDir(d, 180);
