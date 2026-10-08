import type { BrickModel } from "../model/schema";
import { getPart } from "../parts/library";
import { validate } from "../validate/validator";
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

  // Wheel holders hanging under a chassis go on with the part they hang from, in its step.
  const hang = parts.some((p) => getPart(p.part)?.pins?.length) ? hangers(model, validate(model, { structure: "off" }).connections) : new Map<number, number>();
  const withHangers = new Map<number, number[]>();
  for (const [h, upper] of hang) (withHangers.get(upper) ?? withHangers.set(upper, []).get(upper)!).push(h);

  const layers = new Map<number, number[]>();
  const baseplates: number[] = [];
  const wheels: number[] = [];
  const sideways: number[] = [];
  parts.forEach((p, i) => {
    // Sideways parts go on after the upright build (they clip onto its side studs).
    if (p.frame) return void sideways.push(i);
    // Baseplates are laid first, in a step of their own.
    if (getPart(p.part)?.category === "baseplate") return void baseplates.push(i);
    // Wheels go on last, once their holders are in place (they hang below them).
    if (getPart(p.part)?.hub) return void wheels.push(i);
    if (hang.has(i)) return;
    const l = layers.get(p.y) ?? [];
    l.push(i);
    layers.set(p.y, l);
  });

  const steps: BuildStep[] = [];
  if (baseplates.length) steps.push({ n: 1, parts: baseplates.sort((a, b) => parts[a].z - parts[b].z || parts[a].x - parts[b].x || a - b), y: 0 });
  for (const y of [...layers.keys()].sort((a, b) => a - b)) {
    const layer = layers.get(y)!.sort((a, b) => parts[a].z - parts[b].z || parts[a].x - parts[b].x || a - b);
    const units = layer.map((i) => [i, ...(withHangers.get(i) ?? [])]);
    for (const g of chunkUnits(units, maxPerStep)) steps.push({ n: steps.length + 1, parts: g, y });
  }
  if (sideways.length) for (const g of chunk(sideways, maxPerStep)) steps.push({ n: steps.length + 1, parts: g, y: Math.min(...g.map((i) => parts[i].y)) });
  if (wheels.length) {
    wheels.sort((a, b) => parts[a].z - parts[b].z || parts[a].x - parts[b].x || a - b);
    for (const g of chunk(wheels, maxPerStep)) steps.push({ n: steps.length + 1, parts: g, y: Math.min(...g.map((i) => parts[i].y)) });
  }
  return steps;
}

/**
 * Pin-held parts (wheel holders) that hang under a part instead of sitting on
 * one: holder index → the part above it that it's built together with.
 */
export function hangers(model: BrickModel, connections: Connection[]): Map<number, number> {
  const onStuds = new Set(connections.filter((c) => c.kind !== "pin").map((c) => c.upper));
  const out = new Map<number, number>();
  for (const c of connections) {
    if (c.kind !== "pin") continue;
    const h = c.upper;
    if (model.parts[h].y === 0 || onStuds.has(h) || out.has(h)) continue;
    const above = connections.filter((d) => d.kind !== "pin" && d.lower === h).map((d) => d.upper);
    if (above.length) out.set(h, above.sort((a, b) => model.parts[a].y - model.parts[b].y || a - b)[0]);
  }
  return out;
}

/** Balanced chunks of whole units (a part plus the holders hanging from it stay together). */
export function chunkUnits(units: number[][], max: number): number[][] {
  const total = units.reduce((n, u) => n + u.length, 0);
  if (!total) return [];
  const size = Math.ceil(total / Math.ceil(total / max));
  const out: number[][] = [];
  let cur: number[] = [];
  for (const u of units) {
    if (cur.length && cur.length + u.length > size) (out.push(cur), (cur = []));
    cur.push(...u);
  }
  if (cur.length) out.push(cur);
  return out;
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
    if (p.y === 0 || p.frame) return; // sideways parts hang on their mount
    // Wheels and their holders hold each other through the pin; wheels go on last.
    if (connections.some((c) => c.kind === "pin" && (c.lower === i || c.upper === i))) return;
    // Held from below by an earlier part, or by a pinned holder attached in the same step.
    const pinned = (k: number) => connections.some((c) => c.kind === "pin" && c.upper === k);
    const ok = connections.some((c) => c.upper === i && ((placedAt.get(c.lower) ?? Infinity) < placedAt.get(i)! || (placedAt.get(c.lower) === placedAt.get(i) && pinned(c.lower))));
    if (!ok) bad.push(i);
  });
  return bad;
}
