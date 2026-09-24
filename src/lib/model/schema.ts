import { z } from "zod";
import { COLOR_IDS } from "../parts/colors";

/** Rotation about the vertical axis, degrees (see geometry.ts for the exact sense). */
export const RotSchema = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);

export const PlacementSchema = z.object({
  /** A part id (core or catalog); unknown ids are reported by the validator. */
  part: z.string().min(1),
  color: z.enum(COLOR_IDS),
  /** Min-x corner of the rotated footprint, in studs. */
  x: z.number().int(),
  /** Bottom of the part, in plate heights above the ground (0 = on the ground). */
  y: z.number().int(),
  /** Min-z corner of the rotated footprint, in studs. */
  z: z.number().int(),
  rot: RotSchema,
});

export const BrickModelSchema = z.object({
  name: z.string(),
  description: z.string(),
  parts: z.array(PlacementSchema),
});

export type Rot = z.infer<typeof RotSchema>;
export type Placement = z.infer<typeof PlacementSchema>;
export type BrickModel = z.infer<typeof BrickModelSchema>;
