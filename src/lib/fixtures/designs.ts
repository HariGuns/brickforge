import type { BrickDesign } from "../design/schema";
import { P } from "./samples";

/**
 * Small village with a nested sub-build tree, used by tests and the LeoCAD
 * check. 8×8 studs on two base plates, which hut #1 ties together by standing
 * across their seam. Copies use all four rotations, and "grove" contains two
 * pine trees (one rotated), so nesting is exercised too.
 */
export const SAMPLE_VILLAGE: BrickDesign = {
  name: "Tiny village",
  description: "Two huts and a few pine trees on a green base.",
  subBuilds: [
    {
      id: "pine_tree",
      name: "Pine tree",
      // 2×2 footprint: trunk in the back-left corner, crown plate, slope, tip.
      parts: [
        P("brick_1x1", "reddish_brown", 0, 0, 0),
        P("brick_1x1", "reddish_brown", 0, 3, 0),
        P("plate_2x2", "dark_green", 0, 6, 0),
        P("slope45_2x2", "dark_green", 0, 7, 0),
        P("plate_1x1", "dark_green", 0, 10, 0),
      ],
      uses: [],
    },
    {
      id: "grove",
      name: "Grove",
      parts: [P("plate_2x4", "green", 0, 0, 0)],
      uses: [
        { sub: "pine_tree", x: 0, y: 1, z: 0, rot: 0 },
        { sub: "pine_tree", x: 2, y: 1, z: 0, rot: 90 },
      ],
    },
    {
      id: "hut",
      name: "Hut",
      // 4×4: walls, a roof plate, then two slopes meeting at the ridge.
      parts: [
        P("brick_1x4", "tan", 0, 0, 0),
        P("brick_1x4", "tan", 0, 0, 3),
        P("brick_1x2", "tan", 0, 0, 1, 90),
        P("brick_1x2", "tan", 3, 0, 1, 90),
        P("plate_4x4", "dark_red", 0, 3, 0),
        P("slope45_2x4", "dark_red", 0, 4, 0, 180),
        P("slope45_2x4", "dark_red", 0, 4, 2, 0),
      ],
      uses: [],
    },
  ],
  main: {
    parts: [P("plate_4x8", "green", 0, 0, 0), P("plate_4x8", "green", 0, 0, 4)],
    uses: [
      { sub: "hut", x: 0, y: 1, z: 2, rot: 0 },
      { sub: "hut", x: 4, y: 1, z: 4, rot: 90 },
      { sub: "grove", x: 0, y: 1, z: 6, rot: 0 },
      { sub: "pine_tree", x: 4, y: 1, z: 0, rot: 270 },
      { sub: "pine_tree", x: 6, y: 1, z: 0, rot: 180 },
    ],
  },
};
