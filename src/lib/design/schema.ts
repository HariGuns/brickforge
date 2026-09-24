import { z } from "zod";
import { PlacementSchema, RotSchema, type BrickModel } from "../model/schema";

/**
 * A design is a model described as a tree of sub-builds. Each unique sub-build
 * is defined once, in its own local frame; `uses` places copies of it. The
 * compiler (compile.ts) expands a design into a flat BrickModel.
 */

export const SUB_ID = /^[a-z][a-z0-9_]{0,47}$/;

export const InstanceSchema = z.object({
  /** Sub-build id. */
  sub: z.string(),
  /** Where the min corner of the copy's rotated footprint goes, in the parent's frame (studs). */
  x: z.number().int(),
  /** Added to the sub-build's local heights (plates). */
  y: z.number().int(),
  z: z.number().int(),
  rot: RotSchema,
  /**
   * Mirror image (left/right): the copy is flipped along the sub-build's own x
   * axis before it's turned by `rot`. Handed parts swap (wedge right ↔ left).
   */
  mirror: z.boolean().optional(),
});

export const SubBuildSchema = z.object({
  id: z.string().regex(SUB_ID, "lowercase letters, digits and _, starting with a letter"),
  /** Human label, e.g. "Pine tree". */
  name: z.string(),
  parts: z.array(PlacementSchema),
  uses: z.array(InstanceSchema).default([]),
});

export const BrickDesignSchema = z.object({
  name: z.string(),
  description: z.string(),
  subBuilds: z.array(SubBuildSchema).default([]),
  main: z.object({
    parts: z.array(PlacementSchema),
    uses: z.array(InstanceSchema).default([]),
  }),
});

export type Instance = z.infer<typeof InstanceSchema>;
export type SubBuild = z.infer<typeof SubBuildSchema>;
export type BrickDesign = z.infer<typeof BrickDesignSchema>;

/** A flat model as a design with no sub-builds (the single-pass path). */
export function designFromModel(model: BrickModel): BrickDesign {
  return { name: model.name, description: model.description, subBuilds: [], main: { parts: model.parts, uses: [] } };
}
