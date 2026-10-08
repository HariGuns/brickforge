import { footprint, worldBottom } from "../model/geometry";
import type { BrickModel, Placement } from "../model/schema";
import { getPart, PARTS } from "../parts/library";
import { analyzeStructure } from "../validate/structure";
import { validate, type Issue } from "../validate/validator";

/**
 * Test-place a sub-build the way an assembly will use it. On its own, a
 * sub-build stands on the ground, and the ground holds anything: a lamp post
 * that is one tall 1×1 part passes. In a model it stands on studs, and that
 * single stud has to hold the whole post. So it's checked twice:
 *  - on a baseplate: a virtual studded surface joined to every part standing
 *    at y = 0 through its underside (weak joints and overhangs, any size);
 *  - on a plate: a real plate under its footprint, compiled with the
 *    validator (parts that don't take studs, joints, overhangs). Skipped when
 *    the footprint is larger than the biggest plate, or for exact-frame parts.
 * Only problems it doesn't have on its own are reported. Sideways panels mount
 * on side studs, so callers skip them.
 */

const FAR = { x: 1000, z: 1000, y: 1000 };
const key = (i: Issue) => `${i.code}|${[...i.parts].sort((a, b) => a - b).join(",")}`;

/** Plain rectangular plates, smallest first: [w, d, id]. */
const PLATES = PARTS.filter((p) => p.category === "plate" && p.h === 1 && /^Plate \d+×\d+$/.test(p.name))
  .map((p) => [p.w, p.d, p.id] as [number, number, string])
  .sort((a, b) => a[0] * a[1] - b[0] * b[1]);

function bounds(parts: Placement[]) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of parts) {
    const def = getPart(p.part);
    if (!def) continue;
    const f = footprint(p, def);
    x0 = Math.min(x0, f.x0); z0 = Math.min(z0, f.z0); x1 = Math.max(x1, f.x0 + f.sx); z1 = Math.max(z1, f.z0 + f.sz);
  }
  return { x0, z0, w: x1 - x0, d: z1 - z0 };
}

export interface PlacementResult {
  surface: "baseplate" | "plate";
  issues: Issue[];
  /** Why the test didn't run. */
  skipped?: string;
  /** The plate it stood on, and its turn. */
  plate?: { id: string; rot: 0 | 90 };
}

export function placementCheck(model: BrickModel): { errors: Issue[]; results: PlacementResult[] } {
  const own = validate(model, { grid: FAR, maxParts: Infinity, structure: "off" });
  const ownStructure = new Set(analyzeStructure(model, own.connections.filter((c) => c.kind !== "side"), "error").issues.map(key));

  // --- on a baseplate ---------------------------------------------------------------------
  const base = model.parts.length;
  const joins = model.parts.flatMap((p, i) => {
    const def = getPart(p.part);
    if (!def || p.y !== 0 || p.frame) return [];
    const studs = worldBottom(p, def).filter(([, , y]) => y === 0).length;
    return studs ? [{ lower: base, upper: i, studs, kind: "stud" as const }] : [];
  });
  const onBase = analyzeStructure(
    { ...model, parts: [...model.parts, { part: "__baseplate__", color: "black", x: 0, y: 0, z: 0, rot: 0 }] },
    [...own.connections.filter((c) => c.kind !== "side"), ...joins],
    "error",
    { anchors: new Set([base]) },
  ).issues.filter((i) => !ownStructure.has(key({ ...i, parts: i.parts.filter((k) => k !== base) })));
  const baseplate: PlacementResult = {
    surface: "baseplate",
    issues: onBase.map((i) => ({ ...i, parts: i.parts.filter((k) => k !== base), message: `Standing on a baseplate, as it will in the model: ${i.message}` })),
  };

  // --- on a plate ------------------------------------------------------------------------------
  let plate: PlacementResult;
  const b = bounds(model.parts);
  // The smallest plate that covers the footprint, turned 90° if only that way fits.
  const fit = PLATES.map(([w, d, id]) => (w >= b.w && d >= b.d ? { w, d, id, rot: 0 as const } : d >= b.w && w >= b.d ? { w: d, d: w, id, rot: 90 as const } : null)).find((x) => x);
  if (model.parts.some((p) => p.frame)) plate = { surface: "plate", issues: [], skipped: "it has exact-frame (sideways) parts" };
  else if (!fit) plate = { surface: "plate", issues: [], skipped: `${b.w}×${b.d} is larger than the biggest plate` };
  else {
    const { id, rot } = fit;
    const lifted = model.parts.map((p) => ({ ...p, y: p.y + 1 }));
    const placed = validate({ ...model, parts: [...lifted, { part: id, color: "dark_gray", x: b.x0, y: 0, z: b.z0, rot }] }, { grid: FAR, maxParts: Infinity, structure: "error" });
    const before = new Set(validate(model, { grid: FAR, maxParts: Infinity, structure: "error" }).errors.map(key));
    const pi = model.parts.length;
    plate = {
      surface: "plate",
      plate: { id, rot },
      issues: placed.errors
        .map((i) => ({ ...i, parts: i.parts.filter((k) => k !== pi) }))
        .filter((i) => !before.has(key(i)))
        .map((i) => ({ ...i, message: `Standing on a plate (${getPart(id)!.name}; heights here are one plate up): ${i.message}` })),
    };
  }

  // One report per problem: the plate test repeats the baseplate's joint findings.
  const seen = new Set(baseplate.issues.map(key));
  const errors = [...baseplate.issues, ...plate.issues.filter((i) => !seen.has(key(i)))];
  return { errors, results: [baseplate, plate] };
}
