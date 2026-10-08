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
 *
 * Once one call is refused the budget is stopped: no later call starts either,
 * and calls already running finish. idle() resolves when none are left, so the
 * stop is reported with one final total (spent includes every call that ran).
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
  /** The refusal that stopped the budget; every later reserve() throws too. */
  stopped: BudgetExceeded | null = null;
  private reserved = 0;
  private running = 0;
  private waiting: (() => void)[] = [];
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
    if (this.stopped) throw new BudgetExceeded(this.stopped.cap, this.spent, this.stopped.next);
    if (this.cap !== null && this.spent + this.reserved + est > this.cap) throw (this.stopped = new BudgetExceeded(this.cap, this.spent, { scope, estimate: est }));
    this.reserved += est;
    this.running++;
    let open = true;
    const close = () => {
      if (!open) return;
      open = false;
      this.reserved -= est;
      if (--this.running === 0) this.waiting.splice(0).forEach((f) => f());
    };
    return {
      settle: (cost: number) => {
        this.spent += cost;
        close();
        this.largest.set(stage, Math.max(this.largest.get(stage) ?? 0, cost));
      },
      release: close,
    };
  }

  /** Resolves once no call is running (all settled or released). */
  idle(): Promise<void> {
    return this.running === 0 ? Promise.resolve() : new Promise((f) => this.waiting.push(f));
  }

  /** What's left under the cap (null = no cap). */
  left(): number | null {
    return this.cap === null ? null : Math.max(0, this.cap - this.spent);
  }
}
