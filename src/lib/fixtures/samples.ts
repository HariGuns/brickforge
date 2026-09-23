import type { BrickModel, Placement } from "../model/schema";

export const P = (part: string, color: string, x: number, y: number, z: number, rot: Placement["rot"] = 0): Placement => ({
  part,
  color,
  x,
  y,
  z,
  rot,
});

/**
 * Small hand-built house (8×6 studs): two base plates tied together by the walls,
 * running-bond walls with a door gap, and a two-row slope roof with a ridge plate.
 */
export const SAMPLE_HOUSE: BrickModel = {
  name: "Tiny house",
  description: "An 8×6 house with a door, running-bond walls and a sloped roof.",
  parts: [
    // base (y=0): two 4×6 plates side by side
    P("plate_4x6", "dark_green", 0, 0, 0, 90),
    P("plate_4x6", "dark_green", 4, 0, 0, 90),
    // walls layer A (y=1); the back wall ties the two base plates together
    P("brick_1x8", "red", 0, 1, 0),
    P("brick_1x3", "red", 0, 1, 5),
    P("brick_1x3", "red", 5, 1, 5),
    P("brick_1x4", "red", 0, 1, 1, 90),
    P("brick_1x4", "red", 7, 1, 1, 90),
    // walls layer B (y=4), joints offset from layer A
    P("brick_1x6", "red", 1, 4, 0),
    P("brick_1x6", "white", 0, 4, 0, 90),
    P("brick_1x6", "white", 7, 4, 0, 90),
    P("brick_1x2", "red", 1, 4, 5),
    P("brick_1x2", "red", 5, 4, 5),
    // walls layer C (y=7): lintel over the door
    P("brick_1x8", "red", 0, 7, 0),
    P("brick_1x8", "red", 0, 7, 5),
    P("brick_1x4", "red", 0, 7, 1, 90),
    P("brick_1x4", "red", 7, 7, 1, 90),
    // roof row 1 (y=10)
    P("slope45_2x4", "dark_gray", 0, 10, 4, 0),
    P("slope45_2x4", "dark_gray", 4, 10, 4, 0),
    P("slope45_2x4", "dark_gray", 0, 10, 0, 180),
    P("slope45_2x4", "dark_gray", 4, 10, 0, 180),
    P("brick_2x8", "dark_gray", 0, 10, 2),
    // roof row 2 (y=13)
    P("slope45_2x4", "dark_gray", 0, 13, 3, 0),
    P("slope45_2x4", "dark_gray", 4, 13, 3, 0),
    P("slope45_2x4", "dark_gray", 0, 13, 1, 180),
    P("slope45_2x4", "dark_gray", 4, 13, 1, 180),
    // ridge (y=16)
    P("plate_2x8", "dark_gray", 0, 16, 2),
  ],
};

/** Minimal valid model: two bricks stacked with an offset. */
export const SAMPLE_STACK: BrickModel = {
  name: "Stack",
  description: "Two bricks",
  parts: [P("brick_2x4", "red", 0, 0, 0), P("brick_2x4", "blue", 2, 3, 0)],
};
