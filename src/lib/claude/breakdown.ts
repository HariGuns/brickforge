import fs from "node:fs";
import path from "node:path";
import type { RoundSummary } from "./loop";

/**
 * Where a sub-build run's cost went: by level of the tree (0 = the main build:
 * photo analysis, top plan, main assembly, photo comparison; 1 = sub-builds the
 * main build places, and so on), by kind of call, and new components against
 * ones reused from the library.
 */
export interface CostBreakdown {
  total: number;
  byLevel: Record<string, { cost: number; calls: number }>;
  byKind: Record<"analysis" | "planning" | "design" | "assembly" | "repair" | "comparison", number>;
  components: {
    /** Sub-builds planned, designed or assembled in this run, and what that cost. */
    new: { count: number; cost: number };
    /** Components reused from the library, their copies, and what designing them had cost. */
    reused: { count: number; copies: number; saved: number };
  };
  budget?: { cap: number | null; spent: number };
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** Sub-build id of a round's scope ("sub:x", "asm:x", "plan:x"), or null for main-build stages. */
const subOf = (scope: string) => scope.match(/^(?:sub|asm|plan):(.+)$/)?.[1] ?? null;

export function costBreakdown(rounds: RoundSummary[], depthOf: (id: string) => number, reused: { copies: number; saved: number }[] = [], budget?: { cap: number | null; spent: number }): CostBreakdown {
  const byLevel: CostBreakdown["byLevel"] = {};
  const byKind: CostBreakdown["byKind"] = { analysis: 0, planning: 0, design: 0, assembly: 0, repair: 0, comparison: 0 };
  const own = new Set<string>();
  let ownCost = 0;
  for (const r of rounds) {
    const id = subOf(r.scope);
    const level = String(id ? depthOf(id) : 0);
    const l = (byLevel[level] ??= { cost: 0, calls: 0 });
    l.cost += r.usage.cost;
    l.calls++;
    const kind: keyof CostBreakdown["byKind"] =
      r.scope === "analysis"
        ? "analysis"
        : r.round > 0
          ? "repair"
          : r.scope === "plan" || r.scope.startsWith("plan:")
            ? "planning"
            : r.scope.startsWith("sub:")
              ? "design"
              : r.scope === "assembly" || r.scope.startsWith("asm:")
                ? "assembly"
                : r.scope.startsWith("refine")
                  ? "comparison"
                  : "design";
    byKind[kind] += r.usage.cost;
    if (id) {
      own.add(id);
      ownCost += r.usage.cost;
    }
  }
  for (const l of Object.values(byLevel)) l.cost = r4(l.cost);
  for (const k of Object.keys(byKind) as (keyof CostBreakdown["byKind"])[]) byKind[k] = r4(byKind[k]);
  return {
    total: r4(rounds.reduce((n, r) => n + r.usage.cost, 0)),
    byLevel,
    byKind,
    components: { new: { count: own.size, cost: r4(ownCost) }, reused: { count: reused.length, copies: reused.reduce((n, r) => n + r.copies, 0), saved: r4(reused.reduce((n, r) => n + r.saved, 0)) } },
    ...(budget ? { budget: { cap: budget.cap, spent: r4(budget.spent) } } : {}),
  };
}

/** One line for logs: "level 0 $0.62 · level 1 $1.10 … · new 49 sub-builds $3.90 · reused 6 (~$3.87 saved)". */
export function formatBreakdown(b: CostBreakdown): string {
  const levels = Object.entries(b.byLevel)
    .sort((x, y) => Number(x[0]) - Number(y[0]))
    .map(([l, v]) => `level ${l} $${v.cost.toFixed(2)}`)
    .join(" · ");
  const kinds = Object.entries(b.byKind)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k} $${v.toFixed(2)}`)
    .join(" · ");
  const reuse = b.components.reused.count ? ` · reused ${b.components.reused.count} components, ${b.components.reused.copies} copies (~$${b.components.reused.saved.toFixed(2)} saved)` : "";
  const cap = b.budget?.cap != null ? ` · cap $${b.budget.cap.toFixed(2)}` : "";
  return `$${b.total.toFixed(2)}${cap} — ${levels} — ${kinds} — new ${b.components.new.count} sub-builds $${b.components.new.cost.toFixed(2)}${reuse}`;
}

/** Every round saved in a run folder (for a run that stopped before writing its summary). */
export function roundsIn(dir: string): RoundSummary[] {
  const out: RoundSummary[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!/\.round-\d+\.validation\.json$/.test(f) && !/^round-\d+\.validation\.json$/.test(f)) continue;
    try {
      const v = JSON.parse(fs.readFileSync(path.join(/*turbopackIgnore: true*/ dir, f), "utf8")) as { summary?: RoundSummary };
      if (v.summary) out.push(v.summary);
    } catch {
      // skip
    }
  }
  return out;
}

/** Depth of each sub-build in a run folder: from tree.json, else 1 for everything in the plan. */
export function depthsIn(dir: string): (id: string) => number {
  try {
    const t = JSON.parse(fs.readFileSync(path.join(/*turbopackIgnore: true*/ dir, "tree.json"), "utf8")) as { nodes: { id: string; depth: number }[] };
    const m = new Map(t.nodes.map((n) => [n.id, n.depth]));
    return (id) => m.get(id) ?? 1;
  } catch {
    return () => 1;
  }
}
