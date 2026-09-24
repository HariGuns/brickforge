import type { BrickDesign } from "./schema";

export interface DesignDiff {
  changed: string[];
  added: string[];
  removed: string[];
  mainChanged: boolean;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Which sub-builds (by name) a design edit added, removed or changed, and whether the main build changed. */
export function diffDesigns(before: BrickDesign, after: BrickDesign): DesignDiff {
  const old = new Map(before.subBuilds.map((s) => [s.id, s]));
  const now = new Map(after.subBuilds.map((s) => [s.id, s]));
  return {
    changed: after.subBuilds.filter((s) => old.has(s.id) && !same({ p: s.parts, u: s.uses }, { p: old.get(s.id)!.parts, u: old.get(s.id)!.uses })).map((s) => s.name),
    added: after.subBuilds.filter((s) => !old.has(s.id)).map((s) => s.name),
    removed: before.subBuilds.filter((s) => !now.has(s.id)).map((s) => s.name),
    mainChanged: !same(before.main, after.main),
  };
}

export function describeDesignDiff(d: DesignDiff): string {
  const bits: string[] = [];
  if (d.changed.length) bits.push(`changed ${d.changed.join(", ")}`);
  if (d.added.length) bits.push(`added ${d.added.join(", ")}`);
  if (d.removed.length) bits.push(`removed ${d.removed.join(", ")}`);
  bits.push(d.mainChanged ? "main build updated" : "main build unchanged");
  return bits.join("; ");
}
