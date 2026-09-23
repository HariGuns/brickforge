import type { BrickModel, Placement } from "./schema";

export interface ModelDiff {
  added: number;
  removed: number;
  kept: number;
}

const key = (p: Placement) => `${p.part}|${p.color}|${p.x}|${p.y}|${p.z}|${p.rot}`;

/**
 * Compare two models as multisets of placements. A moved or recoloured part
 * counts as one removed plus one added.
 */
export function diffModels(before: BrickModel, after: BrickModel): ModelDiff {
  const pool = new Map<string, number>();
  for (const p of before.parts) pool.set(key(p), (pool.get(key(p)) ?? 0) + 1);
  let kept = 0;
  for (const p of after.parts) {
    const n = pool.get(key(p)) ?? 0;
    if (n > 0) {
      kept++;
      pool.set(key(p), n - 1);
    }
  }
  return { added: after.parts.length - kept, removed: before.parts.length - kept, kept };
}

export function describeDiff(d: ModelDiff): string {
  if (!d.added && !d.removed) return "no parts changed";
  const bits = [];
  if (d.added) bits.push(`${d.added} part${d.added === 1 ? "" : "s"} added`);
  if (d.removed) bits.push(`${d.removed} removed`);
  return `${bits.join(", ")}; ${d.kept} unchanged`;
}
