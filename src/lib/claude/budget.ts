import type { Stage } from "../config";

/**
 * Per-model budget cap. Every API call reserves an estimate of what it will
 * cost before it starts; a call that would take spent + reserved past the cap
 * doesn't start, and the run stops with BudgetExceeded (its finished stages
 * are saved, so it can be resumed with a higher cap). Calls run in parallel,
 * so each one's reservation holds its place until its real cost is known.
 *
 * The estimate is the larger of a default per stage and 1.25× the most
 * expensive call of that stage seen so far in this run. A call can still cost
 * more than its estimate, so the total can end slightly over the cap; it's
 * reported as it is.
 */

/** Rough cost of one call per stage before any has been seen (USD, Opus 5.5, from real runs). */
const DEFAULT_ESTIMATE: Record<Stage, number> = {
  analysis: 0.1,
  plan: 0.15,
  subPlan: 0.08,
  design: 0.6,
  subBuild: 0.12,
  subAssembly: 0.12,
  assembly: 0.5,
  edit: 0.4,
  refine: 0.5,
  repair: 0.1,
};

export class BudgetExceeded extends Error {
  constructor(
    readonly cap: number,
    readonly spent: number,
    /** The call that didn't start: its scope and estimated cost. */
    readonly next: { scope: string; estimate: number },
  ) {
    super(`Budget cap $${cap.toFixed(2)} reached: $${spent.toFixed(2)} spent, and ${next.scope} (about $${next.estimate.toFixed(2)}) would go over it.`);
    this.name = "BudgetExceeded";
  }
}

export class Budget {
  spent = 0;
  private reserved = 0;
  private largest = new Map<Stage, number>();

  /** `spent` starts at what earlier rounds of the same model already cost (resume). */
  constructor(
    readonly cap: number | null,
    spentBefore = 0,
  ) {
    this.spent = spentBefore;
  }

  estimate(stage: Stage): number {
    return Math.max(DEFAULT_ESTIMATE[stage], 1.25 * (this.largest.get(stage) ?? 0));
  }

  /** Reserve a call's estimate, or throw BudgetExceeded if it would go over the cap. */
  reserve(scope: string, stage: Stage): { settle: (cost: number) => void; release: () => void } {
    const est = this.estimate(stage);
    if (this.cap !== null && this.spent + this.reserved + est > this.cap) throw new BudgetExceeded(this.cap, this.spent, { scope, estimate: est });
    this.reserved += est;
    let open = true;
    const close = () => {
      if (open) (open = false), (this.reserved -= est);
    };
    return {
      settle: (cost: number) => {
        close();
        this.spent += cost;
        this.largest.set(stage, Math.max(this.largest.get(stage) ?? 0, cost));
      },
      release: close,
    };
  }

  /** What's left under the cap (null = no cap). */
  left(): number | null {
    return this.cap === null ? null : Math.max(0, this.cap - this.spent);
  }
}
