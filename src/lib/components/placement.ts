import { footprint } from "../model/geometry";
import type { BrickModel, Placement } from "../model/schema";
import { getPart, PARTS } from "../parts/library";
import { baseplatesFor } from "../parts/baseplates";
import { validate, type Issue } from "../validate/validator";

/**
 * Test-place a sub-build the way an assembly will use it. On its own, a
 * sub-build stands on the ground, and the ground holds anything: a lamp post
 * that is one tall 1×1 part passes. In a model it stands on studs, and that
 * single stud has to hold the whole post. So it's checked twice:
 *  - on a baseplate: the smallest real one under its footprint (weak joints
 *    and overhangs: on a baseplate the ground no longer holds anything);
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
  // --- on a baseplate ---------------------------------------------------------------------
  // The smallest real baseplate under its footprint, added after its parts so their numbers
  // stay the same. It stands as it is (a baseplate has no height), so heights stay the same too.
  const b = bounds(model.parts);
  const base = model.parts.length;
  const [bp] = baseplatesFor({ x0: b.x0, z0: b.z0, w: b.w, d: b.d }, "green");
  let baseplate: PlacementResult;
  {
    const before = new Set(validate(model, { grid: FAR, maxParts: Infinity, structure: "error" }).errors.map(key));
    const placed = validate({ ...model, parts: [...model.parts, bp] }, { grid: FAR, maxParts: Infinity, structure: "error" });
    baseplate = {
      surface: "baseplate",
      plate: { id: bp.part, rot: bp.rot as 0 | 90 },
      issues: placed.errors
        .map((i) => ({ ...i, parts: i.parts.filter((k) => k !== base) }))
        .filter((i) => !before.has(key(i)))
        .map((i) => ({ ...i, message: `Standing on a baseplate (${getPart(bp.part)!.name}), as it will in the model: ${i.message}` })),
    };
  }

  // --- on a plate ------------------------------------------------------------------------------
  let plate: PlacementResult;
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

/**
 * The library gate: what keeps a compiled sub-build out of the library. Its
 * own structural warnings (a weak joint is only a warning after the last
 * repair round) plus what the placement check finds. Sideways panels mount on
 * side studs and are only checked for their own warnings.
 */
export function gateProblems(model: BrickModel, ownWarnings: Issue[], sideways = false): Issue[] {
  const own = ownWarnings.filter((w) => w.code === "WEAK_JOINT" || w.code === "OVERSTRESSED");
  return sideways ? own : [...own, ...placementCheck(model).errors];
}
