# Live test plan: sub-build trees and library reuse

Not run yet. Everything below was built and tested against the simulated Claude only. Real API cost so far: $0.

Two runs of the same request, each with a budget cap: run 1 builds the town square as a tree; run 2 measures library reuse.

## 0. Before spending anything (free)

```bash
git log --oneline -1          # 54e29ae or later
npm test                      # 209 tests, including the 7 regression snapshots
ls components | wc -l         # 70 seeded components (npm run seed-components if missing)
npm run gen -- --simulate --detail very_high --budget 15 "a town square"   # dry run: valid, 49 unique, 255 copies, no API calls
```

The seeded library already holds village houses, trees, lamp posts, benches, wells, castle walls and towers. So run 1 may already reuse a few. That's expected, and the logs show which.

## 1. Run 1: town square at Very high, $15 cap

```bash
npm run gen -- --detail very_high --budget 15 \
  "a town square with four town houses, market stalls, a fountain, a clock tower, trees, benches, lamp posts and railings" \
  2>&1 | tee logs/live-tree-1.log
```

Very high detail turns tree mode on (target 3,000 parts). Rough estimate, from earlier real runs' per-call costs:

| Stage | Calls | Estimate |
|---|---|---|
| Top plan (high) | 1 | $0.10–0.20 |
| Child plans (high) | 10–16 | $0.8–1.6 |
| Leaves (medium) | 30–50 | $2.5–6 |
| Sub-assemblies (small: medium, large: high) | 10–16 | $2–5 |
| Main assembly (high) | 1 + repairs | $0.5–1.5 |
| **Total** | | **$6–14** |

This is close enough to $15 that the cap may trigger.

**If the cap is reached:**
- It stops before the next call and prints the spend and what didn't start.
- It writes `debug/<run>/stopped.json` and saves the valid sub-builds to the library.
- **Stop there and report.** Don't resume without approval. The command it prints (`npm run gen -- --resume debug/<run> --budget 23`) would allow up to $23 in total for this model, including what's already spent.

**What to check** (all from the log end and `debug/<run>/summary.json`):
- `Valid: true`, with no errors left.
- **Tree:** unique sub-builds, copies, and depth (`stages.tree`); the target is about 50 unique, 100+ copies, 3 levels.
- **Parts:** the count against the 3,000 target.
- **Cost:** `costBreakdown`, by level (0–3), by kind, and new vs reused.
- **Repairs:** rounds per stage, and any child plan that failed (its sub-build is then designed directly; the log says so).
- **Library:** `library.reused` (from the seeded library) and `library.added`.
- **Visual:** open `debug/<run>/final-design.json` in the app (Open model JSON). Check the Design tab tree, the manual sections, and the Showcase. Render with `scripts/leocad-render.sh exports/<name>.ldr`.

## 2. Run 2: the same request, to measure reuse ($10 cap)

Run it only after run 1 has finished valid, or has been reviewed.

```bash
npm run gen -- --detail very_high --budget 10 \
  "a town square with four town houses, market stalls, a fountain, a clock tower, trees, benches, lamp posts and railings" \
  2>&1 | tee logs/live-tree-2.log
```

Expected: the plan is offered run 1's components (houses, stalls, fountain, tower, trees…) and reuses most of them. The cost drops to the top plan, child plans for anything new, and the assembly: roughly $1–4. The cap is lower because a large spend here would itself mean reuse failed.

**What to check:**
- The `[generate] library: reused …` lines, and `summary.json` `library.reused` / `library.savedCost`.
- The calls made: `rounds` in `summary.json`, compared with run 1.
- `costBreakdown.components`: new vs reused.
- Whether the reused components fit the assembly without repairs.

## 3. Report (fill in)

| | Run 1 | Run 2 |
|---|---|---|
| Valid | | |
| Parts / unique / copies / depth | | |
| Calls (plan / child plans / leaves / sub-assemblies / main) | | |
| Cost (level 0 / 1 / 2 / 3) | | |
| New components (count, cost) | | |
| Reused components (count, copies, saved) | | |
| Stopped at cap? | | |
| Time | | |

Stop conditions for both runs:
- the cap is reached;
- or an API error (credit, auth, rate limit): report it, and don't retry in a loop.
