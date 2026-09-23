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
 */

export type PartCategory = "brick" | "plate" | "tile" | "slope";

export interface PartDef {
  id: string;
  name: string;
  category: PartCategory;
  w: number;
  d: number;
  h: number;
  /** Top cells with studs, local [cx, cz]. Undefined = all cells. */
  studs?: [number, number][];
  ldraw: {
    file: string;
    yaw: 0 | 90 | 180 | 270;
    /** Native LDraw coords (LDU) of our footprint's top-centre point, if the part's origin isn't there. */
    origin?: [number, number, number];
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

export const PARTS: PartDef[] = [
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
];

export const PART_MAP: ReadonlyMap<string, PartDef> = new Map(PARTS.map((p) => [p.id, p]));
export const PART_IDS = PARTS.map((p) => p.id) as [string, ...string[]];

export function getPart(id: string): PartDef | undefined {
  return PART_MAP.get(id);
}

/** Local top-stud cells of a part (resolves the "all cells" default). */
export function localStuds(p: PartDef): [number, number][] {
  if (p.studs) return p.studs;
  const out: [number, number][] = [];
  for (let cz = 0; cz < p.d; cz++) for (let cx = 0; cx < p.w; cx++) out.push([cx, cz]);
  return out;
}
