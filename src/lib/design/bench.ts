import type { BrickDesign } from "./schema";
import type { Placement } from "../model/schema";
import { P } from "../fixtures/samples";

/** A run of 2-wide plates covering 0..n along one axis; `offset` starts with a 2×4 so seams shift by 4. */
function run(n: number, offset: boolean, place: (at: number, part: "plate_2x4" | "plate_2x8") => Placement): Placement[] {
  const out: Placement[] = [];
  let at = 0;
  if (offset) (out.push(place(0, "plate_2x4")), (at = 4));
  for (; at + 8 <= n; at += 8) out.push(place(at, "plate_2x8"));
  if (at < n) out.push(place(at, "plate_2x4"));
  return out;
}

/**
 * Two plate layers that are always one connected piece: rows of plates in
 * running bond (every other row offset by 4 studs), then running-bond columns
 * on top, so every seam is bridged. `n` must be a multiple of 8.
 */
function woven(n: number, y: number, color: string): Placement[] {
  const out: Placement[] = [];
  for (let z = 0, i = 0; z < n; z += 2, i++) out.push(...run(n, i % 2 === 1, (x, part) => P(part, color, x, y, z)));
  for (let x = 0, i = 0; x < n; x += 2, i++) out.push(...run(n, i % 2 === 0, (z, part) => P(part, color, x, y + 1, z, 90)));
  return out;
}

const HUT: Placement[] = [
  P("brick_1x4", "tan", 0, 0, 0),
  P("brick_1x4", "tan", 0, 0, 3),
  P("brick_1x2", "tan", 0, 0, 1, 90),
  P("brick_1x2", "tan", 3, 0, 1, 90),
  P("plate_4x4", "dark_red", 0, 3, 0),
  P("slope45_2x4", "dark_red", 0, 4, 0, 180),
  P("slope45_2x4", "dark_red", 0, 4, 2, 0),
];

/**
 * Large valid design for compile benchmarks: a woven main base carrying
 * `side × side` blocks; each block is its own woven 16×16 base with 16 hut
 * copies (two rotations). side = 5 gives ~4,600 parts, nested two deep.
 */
export function benchDesign(side = 5): BrickDesign {
  const huts = [];
  for (let z = 0; z < 16; z += 4) for (let x = 0; x < 16; x += 4) huts.push({ sub: "hut", x, y: 2, z, rot: ((x / 4 + z / 4) % 2 ? 90 : 0) as 0 | 90 });
  const blocks = [];
  for (let bz = 0; bz < side; bz++) for (let bx = 0; bx < side; bx++) blocks.push({ sub: "block", x: bx * 16, y: 2, z: bz * 16, rot: 0 as const });
  return {
    name: "Bench town",
    description: "Synthetic benchmark design",
    subBuilds: [
      { id: "hut", name: "Hut", parts: HUT, uses: [] },
      { id: "block", name: "Block", parts: woven(16, 0, "light_gray"), uses: huts },
    ],
    main: { parts: woven(side * 16, 0, "green"), uses: blocks },
  };
}
