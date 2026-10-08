import { CONFIG } from "../config";
import type { Issue } from "../validate/validator";

/**
 * Repairs must fix, not delete. A repair round is compared with the loop's
 * first answer, container by container (a sub-build's parts, or an assembly's
 * parts and copies). It fails with FEATURE_REMOVED when:
 *  - a sub-build has fewer copies than in the first answer (or none);
 *  - a part type in the first answer is gone completely (a clock face
 *    swapped for a plain brick);
 *  - the container lost more parts than CONFIG.repair allows: more than
 *    maxPartLoss or more than maxPartLossShare of its parts, whichever is smaller.
 * Replacing a part keeps the count, so it isn't flagged. Every loss, flagged
 * or not, is recorded for the run summary.
 */

export interface FeatureContainer {
  /** "main", a sub-build id, or the loop's scope for a single model. */
  id: string;
  parts: { part: string }[];
  uses?: { sub: string }[];
}

export interface Removal {
  scope: string;
  round: number;
  container: string;
  /** Net parts lost against the first answer. */
  partsLost: number;
  /** Part types present in the first answer and gone now. */
  typesLost: string[];
  /** Copies lost per sub-build. */
  copiesLost: Record<string, number>;
  /** True when it counted as a failed repair (FEATURE_REMOVED). */
  rejected: boolean;
}

const countBy = <T>(xs: T[], key: (x: T) => string) => xs.reduce((m, x) => m.set(key(x), (m.get(key(x)) ?? 0) + 1), new Map<string, number>());

/** Most parts a container of `n` parts may lose in a repair. */
export const partLossLimit = (n: number) => Math.min(CONFIG.repair.maxPartLoss, n * CONFIG.repair.maxPartLossShare);

export function featureLoss(scope: string, round: number, first: FeatureContainer[], now: FeatureContainer[]): { issues: Issue[]; removals: Removal[] } {
  const issues: Issue[] = [];
  const removals: Removal[] = [];
  const nowById = new Map(now.map((c) => [c.id, c]));
  for (const a of first) {
    const b = nowById.get(a.id) ?? { id: a.id, parts: [], uses: [] };
    const partsLost = Math.max(0, a.parts.length - b.parts.length);
    const types = new Set(b.parts.map((p) => p.part));
    const typesLost = [...new Set(a.parts.map((p) => p.part))].filter((t) => !types.has(t));
    const after = countBy(b.uses ?? [], (u) => u.sub);
    const copiesLost: Record<string, number> = {};
    for (const [sub, n] of countBy(a.uses ?? [], (u) => u.sub)) if ((after.get(sub) ?? 0) < n) copiesLost[sub] = n - (after.get(sub) ?? 0);
    if (!partsLost && !typesLost.length && !Object.keys(copiesLost).length) continue;

    const where = a.id === scope || a.id === "main" ? "" : ` in "${a.id}"`;
    const why: string[] = [];
    for (const [sub, n] of Object.entries(copiesLost)) why.push(`${n} of ${(countBy(a.uses ?? [], (u) => u.sub).get(sub))} "${sub}" copies are gone`);
    if (typesLost.length) why.push(`part type${typesLost.length > 1 ? "s" : ""} ${typesLost.join(", ")} ${typesLost.length > 1 ? "are" : "is"} gone completely`);
    if (partsLost > partLossLimit(a.parts.length)) why.push(`${partsLost} of ${a.parts.length} parts were removed (at most ${Math.floor(partLossLimit(a.parts.length))} may go)`);
    const rejected = why.length > 0;
    removals.push({ scope, round, container: a.id, partsLost, typesLost, copiesLost, rejected });
    if (rejected)
      issues.push({
        code: "FEATURE_REMOVED",
        severity: "error",
        parts: [],
        message: `Your repair removed planned features${where}: ${why.join("; ")}. Compared with your first answer, put them back and fix the problem another way.`,
      });
  }
  return { issues, removals };
}

/** One line per removal, for the log and the CLI. */
export function formatRemoval(r: Removal): string {
  const what = [
    ...Object.entries(r.copiesLost).map(([s, n]) => `${n}× ${s}`),
    ...(r.typesLost.length ? [`types ${r.typesLost.join(", ")}`] : []),
    ...(r.partsLost ? [`${r.partsLost} parts`] : []),
  ].join(", ");
  return `${r.scope} round ${r.round}${r.container !== r.scope && r.container !== "main" ? ` (${r.container})` : ""}: removed ${what} — ${r.rejected ? "rejected (FEATURE_REMOVED)" : "accepted"}`;
}
