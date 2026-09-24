import type { BrickModel } from "../model/schema";
import { P } from "./samples";

/**
 * Every shaped part on one 16×8 base (four 4×8 plates, tied across both seams),
 * for the LeoCAD / viewer check of the extended library.
 */
export const PART_SHOWCASE: BrickModel = {
  name: "Part showcase",
  description: "Doors, windows, arches, roof pieces, round parts, cones, fences and flowers.",
  parts: [
    // base
    P("plate_4x8", "light_gray", 0, 0, 0),
    P("plate_4x8", "light_gray", 8, 0, 0),
    P("plate_4x8", "light_gray", 0, 0, 4),
    P("plate_4x8", "light_gray", 8, 0, 4),
    // back row (z 0): door, windows, arch with a plate stack inside its opening
    P("door_1x4x6", "reddish_brown", 0, 1, 0),
    P("window_1x2x3", "white", 5, 1, 0),
    P("window_1x2x2", "white", 8, 1, 0),
    P("arch_1x4", "tan", 11, 1, 0),
    P("plate_1x2", "blue", 12, 1, 0),
    P("plate_1x2", "yellow", 12, 2, 0),
    // middle: arch 1x6, roof pieces
    P("arch_1x6", "dark_red", 0, 1, 2),
    P("slope33_3x4", "dark_gray", 7, 1, 1),
    P("ridge45_2x2", "dark_gray", 11, 1, 1),
    P("ridge45_2x1", "dark_gray", 13, 1, 1),
    P("slope33_3x2", "dark_gray", 14, 1, 1),
    // front row (z 5+): fences, round parts, cones, flowers
    P("fence_1x4x1", "white", 0, 1, 5),
    P("fence_1x4x2", "white", 4, 1, 5),
    P("round_brick_2x2", "green", 8, 1, 5),
    P("cone_2x2x2", "dark_green", 8, 4, 5),
    P("round_brick_1x1", "reddish_brown", 10, 1, 5),
    P("cone_1x1", "orange", 10, 4, 5),
    P("flower_1x1", "pink", 10, 7, 5),
    P("round_plate_2x2", "medium_azure", 11, 1, 6),
    P("round_plate_1x1", "yellow", 13, 1, 5),
    P("round_tile_1x1", "red", 14, 1, 5),
    P("flower_1x1_tabs", "yellow", 15, 1, 5),
    // ties across the base seams
    P("plate_2x2", "light_gray", 2, 1, 3),
    P("plate_1x2", "light_gray", 7, 1, 7),
  ],
};
