/**
 * How placements and copies are written in Claude's output and in the
 * listings we show it. One codec per format; the rest of the app always works
 * with Placement / Instance objects.
 */
import { COLOR_IDS } from "../parts/colors";
import { PlacementSchema, type Placement } from "../model/schema";
import { InstanceSchema, type Instance } from "../design/schema";

export interface Codec {
  name: string;
  placementSchema: Record<string, unknown>;
  instanceSchema: Record<string, unknown>;
  parsePlacement: (v: unknown) => Placement | string;
  parseInstance: (v: unknown) => Instance | string;
  formatPlacement: (p: Placement) => string;
  formatInstance: (u: Instance) => string;
}

const zodError = (e: { issues: { path: PropertyKey[]; message: string }[] }) => e.issues.map((i) => `${i.path.map(String).join(".") || "value"}: ${i.message}`).join("; ");

/** JSON objects: {"part":"brick_2x4","color":"red","x":0,"y":0,"z":0,"rot":0}. */
export const jsonCodec: Codec = {
  name: "json",
  placementSchema: {
    type: "object",
    properties: {
      part: { type: "string" },
      color: { type: "string", enum: COLOR_IDS },
      x: { type: "integer" },
      y: { type: "integer" },
      z: { type: "integer" },
      rot: { type: "integer", enum: [0, 90, 180, 270] },
    },
    required: ["part", "color", "x", "y", "z", "rot"],
    additionalProperties: false,
  },
  instanceSchema: {
    type: "object",
    properties: { sub: { type: "string" }, x: { type: "integer" }, y: { type: "integer" }, z: { type: "integer" }, rot: { type: "integer", enum: [0, 90, 180, 270] }, mirror: { type: "boolean" } },
    required: ["sub", "x", "y", "z", "rot", "mirror"],
    additionalProperties: false,
  },
  parsePlacement: (v) => {
    const r = PlacementSchema.safeParse(v);
    return r.success ? r.data : zodError(r.error);
  },
  parseInstance: (v) => {
    const r = InstanceSchema.safeParse(v);
    return r.success ? r.data : zodError(r.error);
  },
  formatPlacement: (p) => JSON.stringify(p),
  formatInstance: (u) => JSON.stringify(u),
};
