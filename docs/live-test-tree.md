# Live test plan: sub-build trees and library reuse

**Run on 2026-10-09: both runs valid, $4.05 in total.** Results are in [section 3](#3-results-2026-10-09). Sections 0–2 are the plan as written. It was run with three changes:
- Run 1 started from an **empty** library: the 70 seeded components were backed up and merged back afterwards.
- Run 2 was a **different, related model** (a canal street), not the same request.
- Both runs had a **$15** cap.

Two runs, each with a budget cap: run 1 builds the town square as a tree; run 2 measures library reuse.

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

## 3. Results (2026-10-09)

Commands: run 1 as in section 1 (`--budget 15`, with the `components/` folder emptied); run 2:
`npm run gen -- --detail very_high --budget 15 "a canal street with narrow town houses, a stone bridge, moored boats, lamp posts, railings and trees"`.
Logs: `logs/live-tree-{1,2}.log`. Runs: `debug/2026-10-08_18-38-01-subbuilds-a-town-square-…` and `debug/2026-10-08_18-47-55-subbuilds-a-canal-street-…`.

| | Run 1: town square, empty library | Run 2: canal street, run 1's library |
|---|---|---|
| Valid | yes | yes |
| Parts (target 3,000) | 1,575 | 1,299 |
| Unique sub-builds / copies (compiled) | 18 / 69 (20 / 79 planned) | 18 / 56 (8 / 22 planned at the top) |
| Tree depth | 2: only the town house and the clock tower were split | 1: the reused town house brings its own tree |
| Calls (plan / child plans / leaves / sub-assemblies / main) | 1 / 2 / 18 / 2 / 1, plus 3 repair rounds (27 calls) | 1 / 0 / 2 / 0 / 1, plus 2 repair rounds (6 calls) |
| Cost by level (0 / 1 / 2) | $0.37 / $1.57 / $0.99 | $0.69 / $0.42 / – |
| New components (count, cost) | 20, $2.56 | 2 (bridge, boat), $0.42 |
| Reused components (count, copies, saved) | 0 | 6 of 8 top-level sub-builds (one used twice, once recoloured), 19 copies, ~$1.68 saved |
| Library hit rate | – (offered 0) | 6 of 8 sub-builds, 19 of 22 copies |
| Total cost | **$2.93** | **$1.12** |
| Stopped at cap? | no | no |
| Time | 547 s | 403 s |
| LeoCAD | renders (`docs/live-tree-town-square.png`) | renders (`docs/live-tree-canal-street.png`) |

**Against the simulation** (town square: $4.59 from an empty library, then $0.39 reusing it, −91%):
- **Run 1 ($2.93) cost less than the simulated $4.59.** Claude planned a shallower tree than the script: 2 levels, not 3, and 20 sub-builds, not 49. The model reached half the 3,000-part target.
- **The saving held up, but smaller.** Run 2 would have cost about $2.80 without reuse ($1.12 spent + $1.68 saved), so reuse cut it by 60%, against 91% simulated.
  - It's a different model, so the bridge and boats were new work.
  - The live main assembly cost $0.57 with 2 repair rounds, where the simulated one cost $0.23 with none.
- **Reuse itself worked:**
  - The plan picked the house twice, once recoloured as a second house design.
  - Reused components went in with no sub-build repairs.

**What failed: the repairs deleted features instead of fixing them.**
- **Lamp posts (both runs):**
  - The `lamp_post` component is a stack standing on a single stud. It's valid on its own, standing on the ground, but placed on a baseplate it always fails `WEAK_JOINT`.
  - Both main-assembly repairs removed every lamp-post copy and built stand-in lamps from loose round bricks.
  - Run 2 reused the same component from the library and failed the same way, so the library is passing a component on that can't be placed.
- **Clock faces (run 1):** the clock tower's sub-assembly mounted 4 sideways clock faces whose brackets overlapped a 6×6 plate (22 `OVERLAP` errors). The repair removed all 4, so the tower has no clock face.
- **Wasted spend:** both sub-builds were designed and paid for, then left unused.
- **Not fixed here.** Two possible fixes, which need a plan first:
  - Check a component for single-stud joints before saving it.
  - Tell repairs not to drop copies of a planned sub-build.

**Total API spend since sub-builds were introduced** (commit `7756019`, 2026-09-24), from the round files of every run in `debug/` and the desktop app's `~/.config/BrickForge/debug` (each run counted once; the desktop log matches its runs to the cent):

| | Cost |
|---|---|
| Sub-build runs (13 runs, 4 of them in the desktop app) | $29.62 |
| Single-pass and edit runs in the same period (comparisons, effort A/B, cost work) | $8.31 |
| Deleted runs, recorded only in the README (resumed medium copies) | $0.68 |
| **Total** | **$38.61** |

$34.56 of that came before this test, and these two runs added $4.05. Not counted: requests that failed before they wrote a round. There are 3 run folders with no rounds; failed requests are normally not billed.

## 4. Re-run after the repair and library fixes (2026-10-09, $2.28)

The fixes:
- **Repairs may not delete planned features** (`FEATURE_REMOVED`, see `src/lib/claude/features.ts`). A repair round fails when copies of a sub-build are gone, when a part type is gone completely, or when a container lost more than 3 parts or 10% of its parts (whichever is smaller). Removals are listed in `summary.json` (`repairRemovals`).
- **Placement gate** (`src/lib/components/placement.ts`). A sub-build must hold standing on a baseplate and on a plate:
  - it's checked in its own repair loop;
  - a component that fails isn't saved to the library;
  - its own structural warnings fail the gate too.
- **Library clean-up.** `npm run check-components` re-checked the 92 components, and only `lamp_post_b0bf21` failed.
  - It and the faceless `clock_tower_05c36d` were moved to `components-quarantine/`.
  - The hand-fixed lamp post (`lamp_post_6e7e2b`, with `handFixed` metadata) has a 2×2 lower half, so no single stud holds more than 12 plates.

Run 1 again (same prompt, empty library, `--budget 10`). Log: `logs/live-tree-3.log`. Run folder: `debug/2026-10-08_19-21-20-subbuilds-a-town-square-…`.

| | Run 1 (before) | Re-run |
|---|---|---|
| Valid | yes | yes |
| Parts / unique / copies | 1,575 / 18 / 69 | 1,144 / 15 / 52 |
| Lamp posts (planned → in the model) | 6 → 0 (replaced by loose bricks) | **6 → 6** |
| Clock faces | 4 sideways faces planned, all removed by the repair | built into the clock stage's walls (white squares with black hands); not a separate sub-build this time, so nothing was removed |
| Repair rounds | 3 | 7 |
| Repair removals | 6 lamp-post copies, 4 clock faces and 11 parts, all accepted | 3: 2 rejected (lamp post, tree), then fixed in place; 1 accepted (2 tree parts) |
| Cost / time | $2.93 / 547 s | **$2.28** / 256 s |
| LeoCAD | renders | renders (`docs/live-tree-rerun.png`, tower: `docs/live-tree-rerun-clock-tower.png`) |

**Lamp post:**
1. Its first answer was a 1×1 column on one stud (`WEAK_JOINT`).
2. The first repair deleted 2 parts and was rejected (`FEATURE_REMOVED`), with the placement check still reporting the weak joint.
3. The second repair fixed it in place.

**Tree:** the first repair deleted every round 1×1 brick and was rejected. The second kept them, removing only 2 parts, which is within the limit.

**Clock faces: not settled.** They survive, but this run didn't test the sideways case that failed before. The planner wrote "clock faces mounted on side-stud bricks" for the clock stage, but the stage was built with no side-stud parts. The faces are simple and read partly like windows.

**Library afterwards:** 106 components (the 91 before plus 15 new), all passing the gate. 2 are in quarantine.

**Total API spend since sub-builds were introduced:** $38.61 + $2.28 = **$40.89**.

## Simulated baseline history

The simulated town square (`npm run gen -- --simulate --detail very_high`) is the cost baseline. When the script or the pipeline changes what it builds, the new figures are recorded here next to the old ones.

| Date | Change | Run 1 (empty library) | Run 2 (reusing it) | Parts |
|---|---|---|---|---|
| 2026-10-08 | Sub-build trees and the component library | $4.59, 66 calls | $0.39, 2 calls | 406 |
| 2026-10-09 | Repairs may not delete; placement gate | $4.59 | $0.39 | 406 (unchanged) |
| 2026-10-09 | Scenes on baseplates: the town square is a scene and stands on a 48×48 green baseplate (its 48×32 footprint; there's no 48×32 baseplate) | $4.59 | $0.39 | **407** (+ the baseplate) |
