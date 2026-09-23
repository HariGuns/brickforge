import type { BrickModel } from "../model/schema";
import type { Connection } from "../validate/validator";

export interface BuildStep {
  /** 1-based step number. */
  n: number;
  /** Indices into model.parts added in this step. */
  parts: number[];
  /** Layer (plate height) this step builds on. */
  y: number;
}

export interface StepOptions {
  /** Max parts per step. */
  maxPerStep?: number;
}

/**
 * Orders parts bottom-up so every part is placed after at least one part that
 * holds it from below (or it sits on the ground), then groups them into steps.
 *
 * Parts are layered by their bottom height `y`; anything a part rests on has a
 * lower `y`, so it is always in an earlier step. Within a layer, parts are sorted
 * back-to-front, left-to-right and split into balanced chunks, so each step
 * covers one area. Validity is the validator's job; `checkStepOrder` verifies
 * the ordering against the actual connections.
 */
export function buildSteps(model: BrickModel, opts: StepOptions = {}): BuildStep[] {
  const maxPerStep = opts.maxPerStep ?? 6;
  const parts = model.parts;

  const layers = new Map<number, number[]>();
  parts.forEach((p, i) => {
    const l = layers.get(p.y) ?? [];
    l.push(i);
    layers.set(p.y, l);
  });

  const steps: BuildStep[] = [];
  for (const y of [...layers.keys()].sort((a, b) => a - b)) {
    const layer = layers.get(y)!.sort((a, b) => parts[a].z - parts[b].z || parts[a].x - parts[b].x || a - b);
    for (const g of chunk(layer, maxPerStep)) steps.push({ n: steps.length + 1, parts: g, y });
  }
  return steps;
}

/** Split into balanced chunks of at most `max` items (7 with max 6 → 4 + 3, not 6 + 1). */
function chunk(items: number[], max: number): number[][] {
  const size = Math.ceil(items.length / Math.ceil(items.length / max));
  const out: number[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Checks the ordering invariant: each part above the ground has a supporter
 * (a part it rests on) placed in an earlier step. Returns offending part indices.
 */
export function checkStepOrder(model: BrickModel, connections: Connection[], steps: BuildStep[]): number[] {
  const placedAt = new Map<number, number>();
  for (const s of steps) for (const i of s.parts) placedAt.set(i, s.n);
  const bad: number[] = [];
  model.parts.forEach((p, i) => {
    if (!placedAt.has(i)) return bad.push(i);
    if (p.y === 0) return;
    const ok = connections.some((c) => c.upper === i && (placedAt.get(c.lower) ?? Infinity) < placedAt.get(i)!);
    if (!ok) bad.push(i);
  });
  return bad;
}
