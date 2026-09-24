/**
 * BrickLink catalogue IDs for our parts and colours, for the wanted list
 * export. BrickLink numbers mostly match LDraw, but not always (e.g. LDraw
 * 6141 is BrickLink 4073), and its colour numbers are its own. Assemblies
 * that BrickLink sells as separate pieces (a window and its glass, a door and
 * its frame) list each piece.
 */

import { getPart } from "../parts/library";

export interface BrickLinkItem {
  /** BrickLink part number. */
  id: string;
  /** A fixed BrickLink colour (e.g. glass is always trans-clear); otherwise the placement's colour. */
  color?: number;
}

/** Our part id → the BrickLink items one placement needs. */
export const BRICKLINK_PARTS: Record<string, BrickLinkItem[]> = {
  brick_1x1: [{ id: "3005" }],
  brick_1x2: [{ id: "3004" }],
  brick_1x3: [{ id: "3622" }],
  brick_1x4: [{ id: "3010" }],
  brick_1x6: [{ id: "3009" }],
  brick_1x8: [{ id: "3008" }],
  brick_2x2: [{ id: "3003" }],
  brick_2x3: [{ id: "3002" }],
  brick_2x4: [{ id: "3001" }],
  brick_2x6: [{ id: "2456" }],
  brick_2x8: [{ id: "3007" }],
  plate_1x1: [{ id: "3024" }],
  plate_1x2: [{ id: "3023" }],
  plate_1x3: [{ id: "3623" }],
  plate_1x4: [{ id: "3710" }],
  plate_1x6: [{ id: "3666" }],
  plate_1x8: [{ id: "3460" }],
  plate_2x2: [{ id: "3022" }],
  plate_2x3: [{ id: "3021" }],
  plate_2x4: [{ id: "3020" }],
  plate_2x6: [{ id: "3795" }],
  plate_2x8: [{ id: "3034" }],
  plate_4x4: [{ id: "3031" }],
  plate_4x6: [{ id: "3032" }],
  plate_4x8: [{ id: "3035" }],
  tile_1x1: [{ id: "3070b" }],
  tile_1x2: [{ id: "3069b" }],
  tile_1x4: [{ id: "2431" }],
  tile_2x2: [{ id: "3068b" }],
  slope45_2x1: [{ id: "3040" }],
  slope45_2x2: [{ id: "3039" }],
  slope45_2x4: [{ id: "3037" }],
  slope33_3x2: [{ id: "3298" }],
  slope33_3x4: [{ id: "3297" }],
  ridge45_2x1: [{ id: "3044c" }],
  ridge45_2x2: [{ id: "3043" }],
  round_brick_1x1: [{ id: "3062b" }],
  round_brick_2x2: [{ id: "3941" }],
  round_plate_1x1: [{ id: "4073" }],
  round_plate_2x2: [{ id: "4032" }],
  round_tile_1x1: [{ id: "98138" }],
  cone_1x1: [{ id: "4589" }],
  cone_2x2x2: [{ id: "3942c" }],
  fence_1x4x1: [{ id: "3633" }],
  fence_1x4x2: [{ id: "33303" }],
  arch_1x4: [{ id: "3659" }],
  arch_1x6: [{ id: "3455" }],
  window_1x2x2: [{ id: "60592" }, { id: "60601", color: 12 }],
  window_1x2x3: [{ id: "60593" }, { id: "60602", color: 12 }],
  door_1x4x6: [{ id: "60596" }, { id: "60616a" }],
  flower_1x1: [{ id: "24866" }],
  flower_1x1_tabs: [{ id: "33291" }],
};

/**
 * BrickLink items for any part: the table above for core parts; for catalog
 * parts their own list (wheels = rim + tyre) or, by default, the LDraw
 * number, which BrickLink uses for the great majority of parts.
 */
export function bricklinkFor(partId: string): BrickLinkItem[] | null {
  if (BRICKLINK_PARTS[partId]) return BRICKLINK_PARTS[partId];
  const def = getPart(partId);
  if (!def) return null;
  return def.bricklink ?? [{ id: def.ldraw.file.replace(/\.dat$/i, "") }];
}

/** Our colour id → BrickLink colour number. */
export const BRICKLINK_COLORS: Record<string, number> = {
  white: 1,
  black: 11,
  red: 5,
  dark_red: 59,
  orange: 4,
  yellow: 3,
  lime: 34,
  green: 6,
  dark_green: 80,
  blue: 7,
  dark_blue: 63,
  medium_azure: 156,
  light_gray: 86,
  dark_gray: 85,
  tan: 2,
  dark_tan: 69,
  reddish_brown: 88,
  pink: 104,
  purple: 89,
  trans_clear: 12,
  trans_blue: 15,
};
