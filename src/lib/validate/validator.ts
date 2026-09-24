import { CONFIG } from "../config";
import { COLOR_MAP } from "../parts/colors";
import { describe, pinKey, resolve, worldBottom, worldHub, worldPins, worldSolidCells, worldStuds, type Resolved, type WorldPin } from "../model/geometry";
import { oppositeDir } from "../parts/library";
import { wheelMount } from "../parts/wheels";
import { searchParts } from "../parts/search";
import type { BrickModel } from "../model/schema";
import { analyzeStructure, type StructureReport } from "./structure";

/** Issue codes from the structural estimate (they're warnings unless a repair round asks for errors). */
export const STRUCTURAL_CODES = ["WEAK_JOINT", "OVERSTRESSED"] as const;

export type IssueCode =
  | "UNKNOWN_PART"
  | "UNKNOWN_COLOR"
  | "BAD_ROTATION"
  | "OUT_OF_BOUNDS"
  | "TOO_MANY_PARTS"
  | "EMPTY_MODEL"
  | "INVALID_OUTPUT"
  | "OVERLAP"
  | "FLOATING"
  | "UNSUPPORTED"
  | "DISCONNECTED"
  | "WEAK_CONNECTION"
  // wheels
  | "LOOSE_WHEEL"
  | "PIN_TAKEN"
  // structural estimate
  | "WEAK_JOINT"
  | "OVERSTRESSED"
  // design / sub-build compiler
  | "UNKNOWN_SUBBUILD"
  | "DUPLICATE_SUBBUILD"
  | "SUBBUILD_CYCLE"
  | "TOO_DEEP"
  | "EMPTY_SUBBUILD"
  | "UNUSED_SUBBUILD"
  | "DETACHED_SUBBUILD"
  | "SUBBUILD_UNSUPPORTED"
  | "INTERLOCKED";

export interface Issue {
  code: IssueCode;
  severity: "error" | "warning";
  /** Indices into model.parts. */
  parts: number[];
  message: string;
}

/**
 * A connection: `upper` sits on `lower` and is clutched by `studs` studs. For a
 * wheel on a pin (kind "pin"), `lower` is the wheel and `upper` its holder
 * (the wheel holds the holder up), counted as 2 studs.
 */
export interface Connection {
  lower: number;
  upper: number;
  studs: number;
  kind?: "stud" | "pin";
}

/** Strength a wheel-on-pin joint counts as, in studs. */
export const PIN_STUDS = 2;

export interface ValidationResult {
  valid: boolean;
  errors: Issue[];
  warnings: Issue[];
  connections: Connection[];
  /** Connected groups of part indices, largest first (only parts that resolved). */
  components: number[][];
  /** Load estimate per joint and part (absent when structure checks are off or the model has hard errors). */
  structure?: StructureReport;
}

export interface ValidateOptions {
  grid?: { x: number; z: number; y: number };
  maxParts?: number;
  /** Structural checks: "warn" (default), "error" (for repair rounds) or "off". */
  structure?: "off" | "warn" | "error";
}

const key3 = (x: number, y: number, z: number) => `${x},${y},${z}`;
const key2 = (x: number, z: number) => `${x},${z}`;

/**
 * Checks a model for physical buildability:
 *  - every part/colour/rotation is known and inside the build area
 *  - no two parts occupy the same volume
 *  - every part is clutched by at least one stud connection (FLOATING otherwise)
 *  - every part above the ground rests on studs of a part below it (UNSUPPORTED),
 *    which guarantees a bottom-up build order exists
 *  - all parts form a single connected structure (DISCONNECTED otherwise)
 * Sitting on the ground supports a part but does not connect it to anything.
 */
export function validate(model: BrickModel, opts: ValidateOptions = {}): ValidationResult {
  const grid = opts.grid ?? CONFIG.grid;
  const maxParts = opts.maxParts ?? CONFIG.maxParts;
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const parts = model.parts;

  if (parts.length === 0) {
    errors.push({ code: "EMPTY_MODEL", severity: "error", parts: [], message: "The model has no parts." });
    return { valid: false, errors, warnings, connections: [], components: [] };
  }
  if (parts.length > maxParts) {
    errors.push({
      code: "TOO_MANY_PARTS",
      severity: "error",
      parts: [],
      message: `The model has ${parts.length} parts; the limit is ${maxParts}. Simplify or use larger parts.`,
    });
  }

  // --- per-part checks -------------------------------------------------------
  const resolved = resolve(parts);
  const ok: Resolved[] = [];
  resolved.forEach((r, i) => {
    const pl = parts[i];
    if (!r) {
      const like = searchParts(pl.part.replace(/[_-]/g, " "), { limit: 3 }).map((p) => `${p.id} (${p.name})`);
      errors.push({ code: "UNKNOWN_PART", severity: "error", parts: [i], message: `${describe(pl, i)}: unknown part id "${pl.part}".${like.length ? ` Similar: ${like.join(", ")}.` : ""} Use ids from the part table or search_parts.` });
      return;
    }
    if (!COLOR_MAP.has(pl.color)) {
      errors.push({ code: "UNKNOWN_COLOR", severity: "error", parts: [i], message: `${describe(pl, i)}: unknown color "${pl.color}".` });
    }
    if (![0, 90, 180, 270].includes(pl.rot)) {
      errors.push({ code: "BAD_ROTATION", severity: "error", parts: [i], message: `${describe(pl, i)}: rot must be 0, 90, 180 or 270.` });
      return;
    }
    const { fp } = r;
    if (fp.x0 < 0 || fp.z0 < 0 || fp.y0 < 0 || fp.x0 + fp.sx > grid.x || fp.z0 + fp.sz > grid.z || fp.y1 > grid.y) {
      errors.push({
        code: "OUT_OF_BOUNDS",
        severity: "error",
        parts: [i],
        message: `${describe(pl, i)} spans x ${fp.x0}..${fp.x0 + fp.sx - 1}, z ${fp.z0}..${fp.z0 + fp.sz - 1}, y ${fp.y0}..${fp.y1 - 1}; allowed is x 0..${grid.x - 1}, z 0..${grid.z - 1}, y 0..${grid.y - 1}.`,
      });
    }
    ok.push(r);
  });

  // --- overlaps (voxel occupancy) --------------------------------------------
  const occupancy = new Map<string, number>();
  const overlapPairs = new Map<string, { a: number; b: number; cells: number }>();
  for (const r of ok) {
    for (const [x, y, z] of worldSolidCells(r.pl, r.def)) {
      {
        const k = key3(x, y, z);
        const other = occupancy.get(k);
        if (other === undefined) {
          occupancy.set(k, r.index);
        } else {
          const pk = `${other}:${r.index}`;
          const e = overlapPairs.get(pk) ?? { a: other, b: r.index, cells: 0 };
          e.cells++;
          overlapPairs.set(pk, e);
        }
      }
    }
  }
  for (const { a, b, cells } of overlapPairs.values()) {
    errors.push({
      code: "OVERLAP",
      severity: "error",
      parts: [a, b],
      message: `${describe(parts[a], a)} and ${describe(parts[b], b)} overlap in ${cells} unit cell(s) (1 stud × 1 stud × 1 plate).`,
    });
  }

  // --- stud connections -------------------------------------------------------
  // Index every anti-stud by (height, cell); a stud at the same height and cell clutches it.
  const underside = new Map<string, number>(); // "y|x,z" -> part index
  for (const r of ok) {
    for (const [x, z, y] of worldBottom(r.pl, r.def)) underside.set(`${y}|${key2(x, z)}`, r.index);
  }
  const connCount = new Map<string, Connection>();
  for (const r of ok) {
    for (const [x, z, y] of worldStuds(r.pl, r.def)) {
      const upper = underside.get(`${y}|${key2(x, z)}`);
      if (upper === undefined || upper === r.index) continue;
      const ck = `${r.index}:${upper}`;
      const c = connCount.get(ck) ?? { lower: r.index, upper, studs: 0, kind: "stud" as const };
      c.studs++;
      connCount.set(ck, c);
    }
  }
  const connections = [...connCount.values()];

  // --- wheels on pins ------------------------------------------------------------
  // A wheel attaches only if its hub sits exactly on a free pin of its kind, facing it.
  const pins = new Map<string, { holder: number; pin: WorldPin }>();
  for (const r of ok) for (const pin of worldPins(r.pl, r.def)) pins.set(pinKey(pin.kind, pin.at, pin.dir), { holder: r.index, pin });
  const pinned = new Set<number>();
  const usedPins = new Map<string, number>();
  for (const r of ok) {
    const hub = worldHub(r.pl, r.def);
    if (!hub) continue;
    const k = pinKey(hub.kind, hub.at, oppositeDir(hub.dir));
    const hit = pins.get(k);
    if (hit && hit.holder !== r.index) {
      const other = usedPins.get(k);
      if (other !== undefined) {
        errors.push({ code: "PIN_TAKEN", severity: "error", parts: [r.index, other], message: `${describe(r.pl, r.index)} and ${describe(parts[other], other)} are on the same pin of ${describe(parts[hit.holder], hit.holder)}.` });
        continue;
      }
      usedPins.set(k, r.index);
      connections.push({ lower: r.index, upper: hit.holder, studs: PIN_STUDS, kind: "pin" });
      pinned.add(r.index).add(hit.holder);
      continue;
    }
    errors.push({ code: "LOOSE_WHEEL", severity: "error", parts: [r.index], message: `${describe(r.pl, r.index)} is not on a pin. ${wheelHint(r, [...pins.values()].filter((p) => !usedPins.has(pinKey(p.pin.kind, p.pin.at, p.pin.dir))), parts)}` });
  }

  const adj = new Map<number, Set<number>>(ok.map((r) => [r.index, new Set<number>()]));
  const supportedFromBelow = new Set<number>();
  for (const c of connections) {
    adj.get(c.lower)!.add(c.upper);
    adj.get(c.upper)!.add(c.lower);
    supportedFromBelow.add(c.upper);
  }
  for (const i of pinned) supportedFromBelow.add(i); // wheels and their holders hold each other

  // --- connected components ---------------------------------------------------
  const seen = new Set<number>();
  const components: number[][] = [];
  for (const r of ok) {
    if (seen.has(r.index)) continue;
    const comp: number[] = [];
    const stack = [r.index];
    seen.add(r.index);
    while (stack.length) {
      const n = stack.pop()!;
      comp.push(n);
      for (const m of adj.get(n)!) if (!seen.has(m)) (seen.add(m), stack.push(m));
    }
    components.push(comp.sort((a, b) => a - b));
  }
  // Main structure = largest group; ties go to a group touching the ground, then lowest index.
  const touchesGround = (c: number[]) => c.some((i) => parts[i].y === 0);
  components.sort((a, b) => b.length - a.length || Number(touchesGround(b)) - Number(touchesGround(a)) || a[0] - b[0]);
  const mainSize = components[0]?.length ?? 0;

  // --- floating / disconnected (everything outside the main structure) ----------
  const floating = new Set<number>();
  for (const comp of components.slice(1)) {
    if (comp.length === 1) {
      const i = comp[0];
      floating.add(i);
      const where = parts[i].y === 0 ? "sits on the ground but no stud connects it to the rest of the model" : "is not attached to any part by studs (it floats)";
      errors.push({ code: "FLOATING", severity: "error", parts: [i], message: `${describe(parts[i], i)} ${where}.` });
    } else {
      const lowest = Math.min(...comp.map((i) => parts[i].y));
      errors.push({
        code: "DISCONNECTED",
        severity: "error",
        parts: comp,
        message: `A separate section of ${comp.length} parts (${comp.slice(0, 8).map((i) => `#${i}`).join(", ")}${comp.length > 8 ? ", …" : ""}; lowest y=${lowest}) is not connected to the main structure of ${mainSize} parts. Connect it with stud connections (e.g. a plate or brick bridging both).`,
      });
    }
  }
  if (components.length === 1 && ok.length === 1 && ok[0].fp.y0 > 0) {
    const i = ok[0].index;
    floating.add(i);
    errors.push({ code: "FLOATING", severity: "error", parts: [i], message: `${describe(parts[i], i)} is in the air with nothing under it.` });
  }

  // --- unsupported: attached only from above -----------------------------------
  for (const r of ok) {
    if (r.fp.y0 > 0 && !supportedFromBelow.has(r.index) && !floating.has(r.index)) {
      errors.push({
        code: "UNSUPPORTED",
        severity: "error",
        parts: [r.index],
        message: `${describe(r.pl, r.index)} is only attached to parts above it; nothing below holds it (no stud under its bottom at y=${r.fp.y0}). Every part above the ground must sit on studs of a part below it.`,
      });
    }
  }

  // --- weak connections (warning only) ------------------------------------------
  const studTotal = new Map<number, number>();
  for (const c of connections) {
    if (c.kind === "pin") continue;
    studTotal.set(c.upper, (studTotal.get(c.upper) ?? 0) + c.studs);
    studTotal.set(c.lower, (studTotal.get(c.lower) ?? 0) + c.studs);
  }
  for (const r of ok) {
    if (r.fp.y0 === 0 || floating.has(r.index) || r.fp.sx * r.fp.sz < 2 || pinned.has(r.index)) continue;
    const total = studTotal.get(r.index) ?? 0;
    if (total === 1) {
      warnings.push({
        code: "WEAK_CONNECTION",
        severity: "warning",
        parts: [r.index],
        message: `${describe(r.pl, r.index)} is held by a single stud and may rotate or fall off.`,
      });
    }
  }

  // --- structural estimate (only once the basic checks pass) --------------------------
  let structure: StructureReport | undefined;
  const mode = opts.structure ?? "warn";
  if (mode !== "off" && errors.length === 0) {
    structure = analyzeStructure(model, connections, mode === "error" ? "error" : "warning");
    for (const issue of structure.issues) (issue.severity === "error" ? errors : warnings).push(issue);
  }

  return { valid: errors.length === 0, errors, warnings, connections, components, structure };
}

/** "The nearest free wheel pin is … : place it at …" for a wheel that isn't on a pin. */
function wheelHint(r: Resolved, free: { holder: number; pin: WorldPin }[], parts: BrickModel["parts"]): string {
  const hub = r.def.hub!;
  const kindName = hub.kind === "wpin" ? "wheel pin" : "Technic pin";
  const options = free
    .map((f) => ({ f, at: wheelMount(f.pin, r.def) }))
    .filter((o): o is { f: (typeof free)[number]; at: NonNullable<ReturnType<typeof wheelMount>> } => !!o.at)
    .map((o) => ({ ...o, dist: Math.hypot(o.at.x - r.pl.x, o.at.y - r.pl.y, o.at.z - r.pl.z) + (o.at.rot === r.pl.rot ? 0 : 0.5) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 3);
  if (!options.length) {
    const otherKind = free.some((f) => f.pin.kind !== hub.kind);
    return `This wheel needs a ${kindName} and there's no free one${otherKind ? " (the model's free pins are the other kind)" : ""}. Add a holder with ${kindName}s (e.g. ${hub.kind === "wpin" ? "4600 plate 2×2 with wheel pins" : "6249 brick 2×4 with pins"}).`;
  }
  const holderName = (i: number) => `#${i} ${parts[i].part}`;
  return `Wheels sit with their hub exactly on a ${kindName}. Nearest free: ${options.map((o) => `${holderName(o.f.holder)}'s ${o.f.pin.dir} pin → place it at x=${o.at.x}, y=${o.at.y}, z=${o.at.z}, rot=${o.at.rot}`).join("; ")}.`;
}

