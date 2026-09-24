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

const ROT = new Set([0, 90, 180, 270]);
const int = (s: string | undefined) => (s !== undefined && /^-?\d+$/.test(s) ? Number(s) : NaN);

/**
 * Compact strings: a part is "brick_2x4 red 3 0 5 90" (part colour x y z rot),
 * a copy is "pine_tree 4 1 0 270" (sub x y z rot) with " m" for a mirror image.
 * About a third of the tokens of the JSON objects.
 */
export const compactCodec: Codec = {
  name: "compact",
  placementSchema: { type: "string", description: 'One part: "<part id> <color> <x> <y> <z> <rot>", e.g. "brick_2x4 red 3 0 5 90".' },
  instanceSchema: { type: "string", description: 'One copy: "<sub-build id> <x> <y> <z> <rot>", plus " m" for a mirror image, e.g. "pine_tree 4 1 0 270" or "side_panel 0 1 0 0 m".' },
  // Objects are accepted too (the JSON format), so either form parses.
  parsePlacement: (v) => {
    if (v && typeof v === "object") return jsonCodec.parsePlacement(v);
    if (typeof v !== "string") return `expected a string like "brick_2x4 red 3 0 5 90", got ${JSON.stringify(v)}`;
    const t = v.trim().split(/\s+/);
    const [part, color] = t;
    const [x, y, z, rot] = t.slice(2).map(int);
    if (t.length !== 6 || !part || !color || [x, y, z, rot].some(Number.isNaN)) return `"${v}" isn't "<part id> <color> <x> <y> <z> <rot>" with whole numbers`;
    if (!ROT.has(rot)) return `"${v}": rot must be 0, 90, 180 or 270`;
    return { part, color, x, y, z, rot: rot as Placement["rot"] };
  },
  parseInstance: (v) => {
    if (v && typeof v === "object") return jsonCodec.parseInstance(v);
    if (typeof v !== "string") return `expected a string like "pine_tree 4 1 0 270", got ${JSON.stringify(v)}`;
    const t = v.trim().split(/\s+/);
    const mirror = t.at(-1) === "m";
    if (mirror) t.pop();
    const [sub] = t;
    const [x, y, z, rot] = t.slice(1).map(int);
    if (t.length !== 5 || !sub || [x, y, z, rot].some(Number.isNaN)) return `"${v}" isn't "<sub-build id> <x> <y> <z> <rot>" (plus " m" for a mirror image)`;
    if (!ROT.has(rot)) return `"${v}": rot must be 0, 90, 180 or 270`;
    return { sub, x, y, z, rot: rot as Instance["rot"], ...(mirror ? { mirror: true } : {}) };
  },
  formatPlacement: (p) => `${p.part} ${p.color} ${p.x} ${p.y} ${p.z} ${p.rot}`,
  formatInstance: (u) => `${u.sub} ${u.x} ${u.y} ${u.z} ${u.rot}${u.mirror ? " m" : ""}`,
};

/**
 * Turn codec-formatted `parts` / `uses` arrays (anywhere in Claude's answer:
 * model, assembly, design sub-builds and main build) into objects before the
 * usual schema check. Returns the problems found, if any.
 */
export function decodeAnswer(json: unknown, c: Codec): { json: unknown; problems: string[] } {
  const problems: string[] = [];
  const walk = (v: unknown, path: string): unknown => {
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}.${i}`));
    if (!v || typeof v !== "object") return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if ((k === "parts" || k === "uses") && Array.isArray(x)) {
        out[k] = x.map((item, i) => {
          if (typeof item !== "string") return item;
          const r = k === "parts" ? c.parsePlacement(item) : c.parseInstance(item);
          if (typeof r === "string") problems.push(`${path ? `${path}.` : ""}${k}.${i}: ${r}`);
          return r;
        });
      } else out[k] = walk(x, path ? `${path}.${k}` : k);
    }
    return out;
  };
  const decoded = walk(json, "");
  return { json: decoded, problems };
}
