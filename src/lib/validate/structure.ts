import { CONFIG } from "../config";
import { describe, footprint, worldStuds } from "../model/geometry";
import { getPart, type PartDef } from "../parts/library";
import type { BrickModel } from "../model/schema";
import type { Connection, Issue } from "./validator";

/**
 * Structural estimate (not a physics simulation). Every part gets a mass from
 * its size; weight flows down from the top, and each part passes what it
 * carries to the parts holding it up, split by stud count. That gives a load on
 * every joint. For overhangs, the carried weight times its horizontal distance
 * from the studs holding it gives a leverage, shared by those studs.
 *
 * A joint only counts as weak when what it holds depends on it alone: if the
 * part above is also tied into the model some other way (bonded walls, spans
 * resting on other supports), it can't tip, so it isn't flagged.
 * Thresholds are in CONFIG.structure.
 */

export interface JointReport {
  lower: number;
  upper: number;
  studs: number;
  /** Estimated weight passing through this joint, grams. */
  loadG: number;
}

export interface PartReport {
  massG: number;
  /** Own mass + everything resting on it, grams. */
  carriedG: number;
  /** Horizontal centre of the carried weight, studs. */
  com: [number, number];
  /** Studs holding this part from below (0 = on the ground). */
  supportStuds: number;
  /** Leverage of the carried weight around its support area, gram·studs. */
  momentGS: number;
}

export interface StructureReport {
  joints: JointReport[];
  parts: PartReport[];
  issues: Issue[];
  totalMassG: number;
  maxJointLoadG: number;
}

export function partMass(def: PartDef): number {
  const s = CONFIG.structure;
  return def.w * def.d * def.h * s.gramsPerUnit * (def.category === "slope" ? s.slopeFactor : 1);
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export function analyzeStructure(model: BrickModel, connections: Connection[], severity: Issue["severity"] = "warning"): StructureReport {
  const cfg = CONFIG.structure;
  const defs = model.parts.map((p) => getPart(p.part));
  const fps = model.parts.map((p, i) => (defs[i] ? footprint(p, defs[i]!) : null));
  const below = new Map<number, Connection[]>(); // upper -> joints holding it
  const above = new Map<number, Connection[]>(); // lower -> joints resting on it
  for (const c of connections) {
    (below.get(c.upper) ?? below.set(c.upper, []).get(c.upper)!).push(c);
    (above.get(c.lower) ?? above.set(c.lower, []).get(c.lower)!).push(c);
  }

  const parts: PartReport[] = model.parts.map((_, i) => {
    const fp = fps[i];
    const massG = defs[i] ? partMass(defs[i]!) : 0;
    const com: [number, number] = fp ? [fp.x0 + fp.sx / 2, fp.z0 + fp.sz / 2] : [0, 0];
    return { massG, carriedG: massG, com, supportStuds: 0, momentGS: 0 };
  });
  // Weighted sums for the carried centre of mass.
  const sx = parts.map((p) => p.massG * p.com[0]);
  const sz = parts.map((p) => p.massG * p.com[1]);
  const jointLoad = new Map<Connection, number>();

  // Top-down: every part's supporters sit lower, so they're processed after it.
  const order = model.parts.map((_, i) => i).sort((a, b) => model.parts[b].y - model.parts[a].y);
  for (const i of order) {
    const p = parts[i];
    if (p.carriedG > 0) p.com = [sx[i] / p.carriedG, sz[i] / p.carriedG];
    const holds = below.get(i) ?? [];
    const studs = holds.reduce((s, c) => s + c.studs, 0);
    p.supportStuds = studs;
    if (!studs) continue; // on the ground, or unsupported (the validator reports that)

    // Leverage: how far the carried weight's centre lies outside the area of the studs holding it.
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const c of holds) {
      const lo = model.parts[c.lower], lodef = defs[c.lower], fp = fps[i]!;
      if (!lodef) continue;
      for (const [x, z] of worldStuds(lo, lodef)) {
        if (x < fp.x0 || x >= fp.x0 + fp.sx || z < fp.z0 || z >= fp.z0 + fp.sz) continue;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); z0 = Math.min(z0, z); z1 = Math.max(z1, z + 1);
      }
    }
    const dx = Math.max(x0 - p.com[0], 0, p.com[0] - x1);
    const dz = Math.max(z0 - p.com[1], 0, p.com[1] - z1);
    p.momentGS = p.carriedG * Math.hypot(dx, dz);

    // Pass the load down, split by stud count.
    for (const c of holds) {
      const share = (p.carriedG * c.studs) / studs;
      jointLoad.set(c, share);
      const lo = parts[c.lower];
      lo.carriedG += share;
      sx[c.lower] += share * p.com[0];
      sz[c.lower] += share * p.com[1];
    }
  }

  // --- issues -------------------------------------------------------------------------
  // Undirected joint graph, to tell whether a part depends on specific joints only.
  const adj = new Map<number, Connection[]>();
  for (const c of connections) {
    (adj.get(c.lower) ?? adj.set(c.lower, []).get(c.lower)!).push(c);
    (adj.get(c.upper) ?? adj.set(c.upper, []).get(c.upper)!).push(c);
  }
  /**
   * The side of the model reachable from `start` without crossing `cut`. It's
   * "held elsewhere" if that side reaches the ground or loops back to a part
   * below the cut, i.e. the cut joints aren't the only thing holding it up.
   */
  function sideOf(start: number, cut: Set<Connection>, below: Set<number>) {
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length) {
      const k = stack.pop()!;
      if (model.parts[k].y === 0 || below.has(k)) return { heldElsewhere: true, parts: seen };
      for (const c of adj.get(k) ?? []) {
        if (cut.has(c)) continue;
        const m = c.lower === k ? c.upper : c.lower;
        if (!seen.has(m)) (seen.add(m), stack.push(m));
      }
    }
    return { heldElsewhere: false, parts: seen };
  }

  const issues: Issue[] = [];
  const flagged = new Set<number>();
  // Bottom-up so a single-stud chain (e.g. a tall 1×1 tower) is reported once, at its weakest point.
  for (const i of [...order].reverse()) {
    const p = parts[i];
    if (!p.supportStuds) continue;
    const pl = model.parts[i];
    const holds = below.get(i)!;
    if (holds.some((c) => flagged.has(c.lower) && c.studs === 1 && p.supportStuds === 1)) {
      flagged.add(i); // above an already-reported weak joint in the same chain
      continue;
    }
    const perStud = p.momentGS / p.supportStuds;
    const single = p.supportStuds === 1;
    if (!single && perStud <= cfg.maxMomentPerStud) continue;

    const side = sideOf(i, new Set(holds), new Set(holds.map((c) => c.lower)));
    if (side.heldElsewhere) continue;
    const sideParts = [...side.parts];
    const sideMass = sideParts.reduce((s2, k) => s2 + parts[k].massG, 0);
    const stack = sideParts.reduce((m, k) => Math.max(m, fps[k]?.y1 ?? 0), 0) - pl.y;

    if (single && (stack > cfg.maxStackPlatesOnOneStud || sideMass > cfg.maxLoadOnOneStudG)) {
      flagged.add(i);
      issues.push({
        code: "WEAK_JOINT",
        severity,
        parts: [...sideParts, ...holds.map((c) => c.lower)],
        message: `${describe(pl, i)} and the ${sideParts.length - 1} part(s) above it hang on a single stud: ${round(sideMass)} g in a stack ${stack} plates tall. Clutch it with more studs (a wider part underneath) or tie the stack into the rest of the model.`,
      });
    } else if (perStud > cfg.maxMomentPerStud) {
      issues.push({
        code: "OVERSTRESSED",
        severity,
        parts: [i, ...holds.map((c) => c.lower)],
        message: `${describe(pl, i)} overhangs: the ${round(p.carriedG)} g it carries sits ${round(p.momentGS / p.carriedG)} studs beyond the ${p.supportStuds} stud(s) holding it (leverage ${round(perStud)} g·stud per stud, limit ${cfg.maxMomentPerStud}). Support it closer to its weight or hold it with more studs.`,
      });
    }
  }

  const joints: JointReport[] = connections.map((c) => ({ lower: c.lower, upper: c.upper, studs: c.studs, loadG: round(jointLoad.get(c) ?? 0, 2) }));
  return {
    joints,
    parts,
    issues,
    totalMassG: round(parts.reduce((s, p) => s + p.massG, 0), 1),
    maxJointLoadG: round(joints.reduce((m, j) => Math.max(m, j.loadG), 0), 1),
  };
}
