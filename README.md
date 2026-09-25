# BrickForge (Brick Builder)

Local web app that turns a text description or a photo into a buildable model made of generic interlocking bricks. Claude (`claude-opus-5-5`) designs the model on a stud grid. A validator checks it is physically buildable, and errors go back to Claude until the model is valid. The app shows the model in 3D, with step-by-step instructions, a parts list and LDraw export.

**Added since the first version** (each has its own section below):

| Area | What it adds |
|---|---|
| [The app](#the-app) | BrickForge v2 design, paged instruction manual and PDF, chat editing, undo/redo, versions and Save, Showcase mode |
| [Sub-builds](#sub-builds) | Designs as a tree of sub-builds: plan → sub-builds → assembly, structural estimate, resume, mirrored copies, `.mpd` with submodels |
| [Detail and photo analysis](#detail-and-photo-analysis) | Detail levels, photo analysis to an exact target size, server-side renders compared with the photo |
| [Cost](#cost) | Per-stage model and effort, compact parts format, diffs, prompt caching, token report |
| [Part catalog](#part-catalog) | 885 upright parts from LDraw + LDCad shadow data, `search_parts`, wheels on pins |
| [Sideways building](#sideways-building) | 41 side-stud parts, sideways sub-build copies mounted on side studs, exact validation, export and manual |
| [BrickLink](#bricklink-wanted-list) | Wanted list export, with part and colour numbers for the whole catalog from Rebrickable |
| [Desktop app](#desktop-app-appimage), [launcher](#one-click-launcher-linux) | AppImage (Electron) and a one-click Linux launcher |
| [Regression check](#regression-check) | Seven saved builds snapshotted, so upright behaviour can't change unnoticed |

## Setup

```bash
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local   # server-side only, gitignored
npm run dev                                         # http://localhost:3000
```

Optional in `.env.local`: `REBRICKABLE_API_KEY` (only for `npm run fetch-bricklink`), and `NEXT_PUBLIC_BRICKFORGE_SIDEWAYS=0` to turn sideways building off.

## Desktop app (AppImage)

```bash
npm run appimage        # → dist/BrickForge-0.1.0-x86_64.AppImage (152 MB)
```

The AppImage is the whole app in one file: Electron plus the Next.js standalone server. Run it, and:
1. **The server** starts on a free local port and opens in its own window. Closing the window stops it.
2. **First run:** a welcome screen asks for your Anthropic API key. It's checked with a free API call, then stored in `~/.config/BrickForge/settings.json` (readable by you only). Change it later with the gear button. The key is never bundled: the build refuses to package if any key from `.env.local` (Anthropic, Rebrickable) appears anywhere in the output.
3. **Your existing builds:** the first run also offers to copy the generation runs, saved builds and exports from the folder the AppImage was built from (you can edit the path). Nothing is overwritten.
4. **Data:** builds, generation runs, exports and logs live in `~/.config/BrickForge` (`builds/`, `debug/`, `exports/`, `logs/server.log`).
5. **App menu:** on launch the AppImage adds a **BrickForge** entry with its icon (`~/.local/share/applications/brickforge-app.desktop`), updated if you move the file.

Development is unchanged: `npm run dev` and the launcher read the key from `.env.local` and keep data in the repo folder. The desktop build goes to `.next-app/`, separate from `.next/`.

## One-click launcher (Linux)

```bash
npm run install-launcher              # adds "BrickForge (dev)" to your app menu
scripts/install-launcher.sh --desktop # …and a desktop icon
scripts/install-launcher.sh --uninstall
```

Clicking **BrickForge**:
1. installs dependencies if they're missing;
2. rebuilds only if the code changed since the last build;
3. starts the app on http://localhost:3000, or reuses one that's already running;
4. opens your browser.

Right-click the menu entry for **Stop BrickForge**. The same actions from a terminal are `npm run launch` and `npm run stop`. Logs go to `logs/` (build, server). `BRICKFORGE_PORT` changes the port.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app |
| `npm test` | All tests (194): validator, steps, manual, LDraw export and import, compiler, diffs, caching, every generator path with a fake Claude, BrickLink IDs, and the regression snapshots |
| `npm run gen "a red fire truck"` | Run the full generate → validate → repair loop from the CLI; writes `exports/*.ldr/.mpd` |
| `npm run gen -- --image photo.jpg "extra instructions"` | Same, from a photo |
| `npm run gen -- --base model.json "add a chimney"` | Edit an existing model (JSON) instead of building a new one |
| `npm run gen -- --detail high "a rubber duck"` | Detail: `standard` (default), `high` or `very_high`, the same choice as the Detail buttons in the chat |
| `npm run gen -- --pipeline subbuilds --detail high "a castle"` | Generator path: `single`, `subbuilds` or `auto` (the default: sub-builds for High and Very high) |
| `npm run gen -- --resume debug/<run folder>` | Finish an interrupted sub-build run: reuses its valid plan, sub-builds and assembly, redoes the rest, and writes into the same folder. Earlier and new cost are reported separately |
| `npm run bench [side]` | Compile benchmark for a large nested design (`side` 5 ≈ 4,600 parts) |
| `npm run verify-ldraw` | Check the core parts and the whole catalog against the official LDraw library and LDCad's snap data (needs `ldraw-lib/`, see below) |
| `npm run build-catalog` | Regenerate the part catalog (`src/lib/parts/catalog.json`, meshes in `public/parts/`) from LDraw + the LDCad shadow library; report in `ldraw-lib/catalog-report.txt` |
| `npm run catalog-usage` | Which catalog parts generations used, and what Claude searched for, across all runs in `debug/` |
| `npm run export-sample` | Export the hand-built sample models to `exports/` |
| `npm run token-report` | Where the tokens and cost go, per stage, model, effort and token kind, across runs in `debug/` |
| `npm run fetch-bricklink` | Regenerate the BrickLink part and colour numbers from Rebrickable (`src/lib/bricklink/rebrickable.json`; needs `REBRICKABLE_API_KEY`, responses cached) |
| `npm run gen -- --stage-effort subBuild=medium --stage-model repair=claude-sonnet-5` | Override a stage's effort or model for one run (repeatable); `--refine N` sets the photo comparison rounds |
| `scripts/leocad-render.sh exports/X.ldr [out.png] [step]` | Render an export with LeoCAD (flatpak `org.leocad.LeoCAD`) to confirm it opens |

LDraw library for `verify-ldraw`, `build-catalog` and LeoCAD rendering:
`mkdir ldraw-lib && curl -L https://library.ldraw.org/library/updates/complete.zip -o ldraw-lib/complete.zip && (cd ldraw-lib && unzip -q complete.zip)`

LDCad shadow library (connection data) for `build-catalog` and `verify-ldraw`:
`mkdir -p ldraw-lib/shadow && curl -sL https://codeload.github.com/RolandMelkert/LDCadShadowLibrary/tar.gz/refs/heads/main | tar xz -C ldraw-lib/shadow --strip-components=1`

## The app

The UI follows `design/brickforge-v2.html`.
- **Chat:** describe a model or attach a photo, pick a size, and build. Progress and repair rounds show inline with a running cost. With a model loaded, messages **edit** it by default (toggle "Editing ⟨model⟩" off to start a new build). Claude gets the current parts list and your request, returns the full updated model, and it goes through the same validate/repair loop. The reply shows how many parts were added, removed and kept. The edit prompt is `src/lib/prompts/edit.ts`.
- **Library:** your saved runs from `debug/` and any `.ldr` files in `exports/`. `.ldr` files are read back with `src/lib/ldraw/import.ts`.
- **Tabs:**
  - **Model:** 3D view with 3/4, front and top cameras, full screen and spin. It includes the Issues card (errors outlined in red, warnings in amber) and a playback bar that animates the build step by step.
  - **Manual:** an instruction book with one cream page per step. Each page has an isometric three.js render (new parts outlined in orange), a parts callout with 3D icons, zoom, a Go to menu and a thumbnail strip. **Manual PDF** exports it as one A4 page per step.
  - **Parts:** parts list grouped by category.
  - **Design:** the model JSON plus stats.
- **Other:** dark mode, and the Download menu (.ldr, .mpd, BrickLink wanted list, Open model JSON).
- **BrickLink wanted list:** see [below](#bricklink-wanted-list).
- **Versions, undo/redo and Save:**
  - **Versions:** every chat edit adds a version to the open build, and the Versions menu lists them all (click one to restore it).
  - **Undo/redo:** the top-bar buttons, or ⌘/Ctrl+Z and ⌘/Ctrl+Shift+Z, step through your changes. A new edit clears the redo steps but never deletes a version.
  - **Save** (⌘/Ctrl+S): writes the build with all its versions to `builds/<id>.json` (gitignored). Saved builds appear at the top of the Library.
  - **Unsaved work:** switching builds or leaving the page asks first. Logic: `src/lib/builds/doc.ts`; storage: `src/lib/builds/store.ts`.
- **Showcase** (Model tab): a full-screen animated build that assembles each sub-build in turn ("Assembling Pine tree ×4"), then the main build ("Adding 3× Track Section"). New parts are highlighted as they go on, and it has a step counter, a progress bar, speed 0.5×–4×, pause/replay, and Stop (or Esc).
- **Chat:**
  - **Empty state:** "Try one" suggestion chips that fill in the composer (text, size and path) without sending anything.
  - **Toggle:** when a model is open, a "Change this build / Start a new build" choice sets what the next message does.
- **Not built yet:** shared builds is a disabled placeholder.

## Sub-builds

A **design** (`src/lib/design/schema.ts`) describes a model as a tree of sub-builds: each unique sub-build is defined once in its own frame, and `uses` place copies (x, y, z, rot). The deterministic compiler (`src/lib/design/compile.ts`) turns a design into a flat model:
- It expands copies (rotating each inside its footprint box, nested up to 4 levels) and tags every part with the copy it came from (e.g. `Grove #1 › Pine tree #2`).
- It runs the validator, then checks joins at every level: each copy must be attached, must rest on something, and must not interlock with a sibling.
- It reports stats: pieces, sub-builds, copies, compile time, errors, warnings, and size in cm.

A flat model is a design with no sub-builds, so the single-pass path and older saved builds are unchanged. Versions store the compiled `model` and, optionally, the `design`.

**Structural estimate** (`src/lib/validate/structure.ts`, thresholds in `CONFIG.structure`). This is not a physics simulation.
- **Load on joints:** each part gets a mass from its size (a 2×4 brick ≈ 2.3 g). Weight flows down through the joints, split by stud count, giving a load on every joint.
- **`WEAK_JOINT`:** a single stud is the only thing holding a stack more than 12 plates tall, or more than 5 g.
- **`OVERSTRESSED`:** an overhang whose leverage per supporting stud is over the limit.
- **Only real weak points:** a part that's also tied into the model another way (bonded walls, spans on other supports) is never flagged.
- **In the repair loop:** both count as errors during repair rounds, and as warnings after the last round.

**Sub-build generator** (`src/lib/claude/subbuilds.ts`, prompts in `src/lib/prompts/subbuilds.ts`): choose it with the path selector, `--pipeline subbuilds`, or `CONFIG.generator`. The default is **Auto**: sub-builds for High and Very high detail, single pass for Standard.
1. **Plan:** the sub-builds, each with a size envelope, part budget and copy count, plus a layout.
2. **Design each unique sub-build once:** all in parallel (up to 8), each validated on its own inside its envelope with its own repair loop.
3. **Assemble:** copies plus glue parts, placed using a map of each sub-build's top studs and underside. The compiler checks joins, connectivity and structure, and the assembly is repaired until valid.

All stages share the loop in `src/lib/claude/loop.ts` and the cached system prompt. Every stage writes `plan.*`, `sub-<id>.*` and `assembly.*` files to the run's debug folder.

Comparison at size Large (claude-opus-5-5, effort high):

| Prompt | Path | Valid | Rounds | Parts | Sub-builds / copies | Cost |
|---|---|---|---|---|---|---|
| Medieval castle with four corner towers, walls, gatehouse | single | yes | 1 | 244 | – | $0.50 |
| | sub-builds | yes | 9 (no repairs) | 2,394 | 7 / 29 | $2.90 |
| Steam train, engine + three matching carriages | single | yes | 1 | 215 | – | $0.54 |
| | sub-builds | yes | 6 (1 assembly repair) | 647 | 4 / 15 | $1.13 |
| Village square, three houses, trees, well | single | yes | 1 | 247 | – | $0.67 |
| | sub-builds | yes | 14 (3 sub-build + 1 assembly repair) | 1,014 | 8 / 23 | $2.57 |

The village sub-build run was interrupted at assembly when the API credit ran out. It was finished with `--resume`, which reused the plan and all 8 valid sub-builds ($2.11 already spent) and ran only the assembly ($0.46).

**In the app:**
- **Top bar:** the real sub-build count.
- **Design tab:** the sub-build tree with copy counts (click a node to highlight all its copies in 3D) and a stats panel: pieces, steps, pages, compile time, errors, warnings, and size in cm.
- **Manual:** the sub-builds come first (deepest first), then the main build. Each page carries a "Sub-build · Pine tree ×4" tab, and main-build callouts show copies ("4× Corner Tower"). The Go to menu is grouped by sub-build, and the PDF follows the same order.
- **Download `.mpd`:** one submodel per sub-build.
- **Chat edits on a model with sub-builds:** Claude gets the design (each sub-build once) and returns the updated design, so changing a sub-build changes every copy. The reply names the changed sub-builds. For example, "make all three carriages dark blue" on the train changed only the Passenger Carriage (90 parts across 3 copies, $0.35).
- **Speed:** the viewer uses instanced meshes and merged outlines. The 2,394-part castle draws in 187 draw calls instead of ~7,000.

`.mpd` export for designs has one submodel per unique sub-build, with copies as references; the importer expands them back. Compiling ~4,600 parts in 425 nested copies takes about 60 ms (`npm run bench`).

**Mirrored copies** (`mirror: true` on a copy) are left/right mirror images of a sub-build, so a vehicle's right side can be designed once and mirrored for the left:
- **How it flips:** the copy is flipped along the sub-build's own x axis before it's rotated.
- **Parts:** each part becomes its mirror image. Handed parts swap (wedge right ↔ left), and symmetric parts stay or turn (a wheel turns to face the other way).
- **Swap map** (`src/lib/parts/mirror.ts`): it isn't a hand-written list. It comes from comparing each part's flipped connection data with its left/right counterpart (or itself) at each rotation. 23 parts have no mirror image, and a mirrored copy containing one is reported (`MIRROR_UNSUPPORTED`).
- **Nested copies:** inside a mirrored copy, they flip too.
- **Manual and export:** mirrored copies get their own manual section ("Side (mirrored)") and their own `.mpd` submodel, with the parts really swapped.

## Detail and photo analysis

**Detail** (Standard / High / Very high; it replaced Small / Medium / Large) sets the target width of the subject in studs and the part budget (`CONFIG.detail`):

| Detail | Width | Parts | Auto uses |
|---|---|---|---|
| Standard | 10 studs | 300 | single pass |
| High | 16 studs | 700 | sub-builds |
| Very high | 22 studs | 1,500 | sub-builds |

Photos of vehicles are never narrower than 14 studs. The single pass keeps its 300-part limit, so High and Very high need sub-builds to use their full budget.

**Photo analysis** (`src/lib/claude/analyze.ts`, prompt in `src/lib/prompts/analysis.ts`) runs before designing any photo build. It's a short structured call (effort `CONFIG.analysisEffort`) that returns:
- the subject;
- its category;
- its real length, width and height in metres (published specs where Claude recognises it);
- 5–8 key features;
- the main colours;
- the camera angle;
- notes.

The code then turns the dimensions into an exact target size:
- the width comes from the Detail level;
- length and height keep the real proportions, at 1 stud = 8 mm = 2.5 plates;
- everything scales down if needed to fit the build area.

For example, a Lamborghini Huracán at High is 37 × 16 studs × 24 plates.

The design prompt (or, with sub-builds, the plan) gets the analysis and target size, plus a fixed orientation: front toward +z, length along z. That orientation also lets the phase 3 renders match the photo's angle.

Where the analysis shows up:
- **Chat:** a "Reading the photo" row with the subject, proportions, size and cost.
- **Cost:** it's included in the total and also logged on its own, as `analysis` in `summary.json` and `analysis.json`.
- **Resume:** a resumed sub-build run reuses it.

**Comparison with the photo** (`src/lib/claude/refine.ts`, prompt in `src/lib/prompts/refine.ts`, settings in `CONFIG.refine`) runs after a photo build is valid:
1. **Render.** A server-side software renderer (`src/lib/render/render.ts`: plain JavaScript, no GPU or LeoCAD) draws the model from the photo's camera angle (from the analysis) and from the side the photo shows. It uses the viewer's part shapes and the catalog meshes.
2. **Compare.** Claude gets the photo, both renders and the current model (or, with sub-builds, the design). It either says the model matches, or lists up to 6 differences, proportions first, and returns a corrected model.
3. **Check.** The correction must pass the validator, with up to 2 repairs. If it can't be made valid, the previous model stays.

There are at most `rounds` (2) rounds, and the loop stops once Claude says the model matches.

Where it shows up:
- **Debug folder:** renders as `refine-N.view.png` and `refine-N.side.png`, and the differences in `refine-N.json`.
- **Chat:** a "Comparing with the photo" row per round.
- **Cost:** logged separately (`refine` in `summary.json`) and included in the total.

**Manual:** wheel holders hanging under a chassis go in the same step as the part they hang from, and wheels go on last.

## Cost

`npm run token-report` shows where the tokens go, per stage, per model and effort, and per token kind (answer vs thinking, cache reads and writes), from every run in `debug/`. The baseline before the cost work is in `docs/token-report-before.md`: thinking was 74% of the cost, the JSON answers 18%, and input 8%.

- **Model and effort per stage** (`CONFIG.stages`): analysis, plan, design, sub-build, assembly, edit, comparison, and `repair` for every repair round. Any stage can switch model or effort; each round logs which it used, and its cost uses that model's prices (`CONFIG.pricing`). Defaults: Opus 5.5 at effort high, except analysis and repairs at medium.
- **Compact parts format** (`CONFIG.outputFormat`, `src/lib/diff/codec.ts`): Claude writes each part as one string, `"brick_2x4 red 3 0 5 90"`, and each copy as `"pine_tree 4 1 0 270"` (`" m"` for a mirror image). The same format is used in the listings it's shown. This is 47% of the JSON objects' size on a real 247-part model. Malformed lines come back as errors with their path; JSON objects are still accepted.
- **Prompt caching:** the output schema turned out to be part of the cached prefix. A repair that switched to a diff schema read nothing back from the cache and re-wrote its whole conversation ($0.17 in one run), while a repair that kept its schema read 65% from the cache. So:
  - **One schema per loop:** each loop uses one merged schema, with the full answer's fields plus the diff's. First answers leave the diff fields empty, and repairs leave the full lists empty.
  - **No cache writes where nothing reads them:** single-call stages with their own schema (analysis, plan) write no cache. Other stages cache their system prompt and conversation.
  - **Staggered starts:** parallel sub-builds (same schema) start staggered, so they read one cache entry.
  - **Logging:** each round logs its cache hit rate, and `summary.json` has the run's `cache` totals.
- **No earlier thinking in repairs** (`CONFIG.keepThinkingInRepairs`): a finished round's thinking isn't re-sent, since it's billed as input every round. A repair gets its answer (listed with indices) and the errors.
- **Diffs:** repairs, chat edits and photo comparisons return only the changes (remove / set / add by index, copies and new sub-builds for designs), applied by code (`src/lib/diff`).

### Live results (2026-09-24, $8.77)

**Huracán photo at High** (`docs/huracan-compare.png`: LeoCAD renders next to the photo):

| Run | Parts | Valid | Cost | Cost by stage |
|---|---|---|---|---|
| Old (phase 6, no analysis) | 87 | yes | $0.46 | one design call |
| Phase 2 only (analysis, single pass) | 204 | yes, first try | $1.02 | analysis $0.09 · design $0.93 |
| Full (sub-builds with a mirrored side panel, comparison) | 393 | yes | $2.72 | analysis $0.09 · plan $0.11 · sub-builds $1.55 · assembly $0.68 · comparison $0.29 |
| Tuned (single pass, tuned prompts, comparison) | 147 | yes | $1.92 | analysis $0.09 · design $0.91 · comparison $0.93 |

- **Old:** stubby, with block wheels.
- **Phase 2 and full:** the right long, low proportions and real wheels, but slab-sided and too tall.
- **Full, comparison rounds:** round 1 removed "stilts", and round 2 called it a match despite big differences.
- **Tuned:** its comparison lowered the body 3 plates, opened the wheel arches, blackened the wheels, and then added headlights and intakes. It's the closest to the photo.

**Before/after cost**, the same prompts in single pass:

| Prompt | Before: parts / cost | After: parts / cost | Cost per 100 parts, before → after |
|---|---|---|---|
| Red house | 37 / $0.12 | 86 / $0.24 | $0.32 → $0.28 |
| Pickup | 78 / $0.34 | 97 / $0.47 | $0.44 → $0.48 |
| Train | 215 / $0.54 | 231 / $0.56 | $0.25 → $0.24 |

The models are larger now because the Detail targets are bigger, and cost per part is about flat.

Across these runs, the JSON answer fell from 18% to 5% of the cost, and answer tokens per part from about 22 to about 10. But thinking in the first design call still dominates, and cache re-writes on repairs cost back what diffs saved (fixed since, see caching above). The biggest single lever measured is effort: on the same Huracán plan, sub-builds at **medium** cost **$1.04 instead of $1.55 (−33%)** with equal quality. That's now the default for sub-builds. Details are in `docs/token-report-after.md` against `docs/token-report-before.md`.

### Effort A/B on the other stages (2026-09-25, $1.58)

Each stage was run at **medium** against its earlier **high** run. Assembly and comparison were controlled: the high run's folder was copied and resumed, so plan and sub-builds were identical. Design used new runs of the same prompts. None held quality, so all three stay at high.

| Stage | Test | High | Medium | Verdict |
|---|---|---|---|---|
| Assembly | Village (same sub-builds) | $0.16, 46 s, valid | $0.13, 26 s, valid, same model | equal |
| Assembly | Huracán, sideways (same sub-builds) | $1.00, 411 s, 377 parts | $0.41, 191 s, 292 parts, 1 repair | **worse**: left out all 4 planned fender arches |
| Comparison | Huracán (same design) | $0.93, 2 rounds of real fixes | $0.14, "matches" at once | **worse**: missed the tucked wheels, 20 vs 16 studs wide, boxy deck |
| Design | House | $0.32, 89 parts | $0.18, 72 parts | simpler: no chimney or path |
| Design | Pickup | $0.47, 97 parts | $0.27, 65 parts | **worse**: slab cab with bare studs, no slopes or windscreen |
| Design | Train (High detail) | $0.56, 231 parts | $0.45, 230 parts | equal |

Medium keeps up on simple, regular builds (village, train) and falls behind where shape matters (vehicles), or where it has to find problems (comparison). The runs are the `ab-*` and `2026-09-25_10-10-56-*` folders in `debug/`.

## Part catalog

Claude can use **978 parts**:
- **Hand-made core:** 52 parts in `src/lib/parts/library.ts`.
- **Generated catalog:** 885 upright parts plus 41 side-stud parts in `src/lib/parts/catalog.json` (the side-stud parts only while sideways building is on; 937 parts without them).

The prompt lists a **core menu** of 150 (142 with sideways building off): the core parts plus the most useful catalog parts (`src/lib/parts/core.ts`, vehicle parts first). Claude finds the rest with the **`search_parts` tool** during design, which returns ids, sizes and connection info. Each run's `summary.json` records which catalog parts the model used and how many came from search; `npm run catalog-usage` adds them up.

**How the catalog is made** (`npm run build-catalog`, about 25 s):
1. **Filter** every official LDraw part, dropping prints, stickers, aliases, minifig/Duplo/other systems and assemblies.
2. **Resolve connection data** the way LDCad does: walk each part's subfile tree and apply the **LDCad shadow library**'s snap info (`scripts/lib/snaps.ts`).
3. **Keep only parts with complete connection data** (`scripts/lib/classify.ts`). Every connection must be one the validator understands, and must sit exactly on the grid:
   - studs and anti-studs, which may be on lower steps (`(x,z)@level`), not just the top and bottom;
   - wheel pins (thin wheel pins, or Technic pins on bricks and plates).

   Rejected:
   - clips, hinges and bars;
   - side studs (those parts go to the side-stud classifier, see [Sideways building](#sideways-building));
   - off-grid studs;
   - bodies that aren't a whole number of studs and plates (up to 2.5 LDU of overhang is allowed).
4. **Infer missing anti-studs.** Where the shadow library lacks them (96 parts), anti-studs come from the LDraw geometry's standard underside tubes, and the part is marked `inferred`.
5. **Compute the space each part fills** from its surfaces, per 1 × 1 stud × 1 plate cell, so a curved slope's thin end or an arch's opening stays free.
6. **Merge near-duplicates** ("with/without bottom tube" variants), and **pair left/right versions** (22 pairs) for mirrored sub-builds.
7. **Frame the wheels** (rim + tyre assemblies, e.g. `4624c01`) so their hub lands exactly on a holder's pin.
8. **Write compact meshes.** Real LDraw geometry goes to `public/parts/<id>.bin` (15 MB; each part loads on demand). Tyres and glass keep their own colour. The viewer, manual and PDF render catalog parts from these meshes.

**Wheels** attach only through holders:
- A wheel's hub must sit exactly on a free pin of the same kind, facing it. Otherwise the error is `LOOSE_WHEEL`, and it names the exact placement to use.
- Wheels hold their holders up.
- Wheels go on in the last build step.

**Verification** (`npm run verify-ldraw`) places every catalog part at rot 0 and rot 90 through the exporter's transform and checks:
- the real stud and anti-stud snaps land on exactly the cells and heights the validator uses;
- the body fits the footprint;
- the pins are where the validator says.

It also mounts every wheel on a real holder and checks, in LDraw space, that the hub is on the pin's axis and flush against the holder. **All 885 upright catalog parts pass** (the 41 side-stud parts have their own checks).

Why 885, not 1,000+: most of the rest need connection types the validator doesn't have yet:
- Technic beams, axles and gears;
- hinges and clips;
- recessed side studs (the headlight brick) and parts that mix side studs with other side connectors.

`ldraw-lib/catalog-report.txt` lists every rejected part and the reason.

**Side-stud parts** are catalogued separately; see [Sideways building](#sideways-building).

**Licences:**
- The LDraw parts library is CC BY 2.0 / 4.0 (LDraw.org).
- The LDCad shadow library is CC BY-SA 4.0 (Roland Melkert and contributors, github.com/RolandMelkert/LDCadShadowLibrary).
- The generated `catalog.json` and meshes are derived from both, so they're shared under CC BY-SA 4.0 with this attribution.

## Sideways building

Studs on the sides of parts, so panels can face outwards: smooth or detailed vertical faces such as a car's flanks, doors and facades. It's on by default; `NEXT_PUBLIC_BRICKFORGE_SIDEWAYS=0` turns it off (read at startup, and baked into the browser code at build time). Turned off, side-stud parts aren't loaded, sideways copies can't be made, and the prompts and schemas are exactly as before. `src/lib/regression.test.ts` shows upright behaviour is unchanged either way.

**Side-stud parts** come from a separate classifier (`scripts/lib/classifySide.ts`), which only runs for parts the normal one rejects, so upright parts are classified exactly as before. It covers 41 parts: bricks with studs on one to four sides, brackets and similar.
- **Side studs:** each is recorded as an exact point with an outward direction. They sit on stud centres along the face and on a quarter-plate grid in height.
- **Brackets:** framed by their plate. The flange is recorded as an LDU extension box.
- **Excluded for now:** recessed side studs (the headlight brick) and parts with other side connectors.
- **Verification:** `verify-ldraw` checks side studs through the exporter, and checks the body against the grid box plus extension boxes. All 41 pass.

**Sideways copies:** a copy of a sub-build can be mounted on a side stud instead of placed on the grid (`mount: { part, stud, at, spin }` on the copy).
- **Orientation:** the copy's top faces the stud's direction; seen from outside, its x runs left to right and its z top to bottom. `mirror: true` gives the opposite side.
- **Exact placement:** the compiler gives the copy's parts exact frames (`src/lib/sideways/frame.ts`).
- **Validation:** an extra pass matches side-stud and sideways joints by exact position and facing, and checks collisions on exact LDU boxes, including bracket flanges (`src/lib/sideways/validate.ts`). It only runs when a model has sideways parts, side studs or flanges. Errors: `MOUNT_INVALID`, `SIDEWAYS_DETACHED`.
- **Everywhere else:** the viewer, manual, PDF and server renderer draw frames. LDraw export writes turned parts, and the design `.mpd` writes turned submodel references; import reads both back (a tilted part in any `.ldr` becomes a sideways part). In the manual, the panel is built flat in its own section, then attached after the upright build.
- **Verification:** `verify-ldraw` mounts a panel on every side stud of every carrier (spins 0 and 90) and checks, in LDraw space, that the panel's anti-stud sits on the side stud. All 41 carriers pass.
- **Not yet:** sideways copies inside sideways copies, and sideways parts inside mirrored copies (both reported).

**Generation:** the planner can mark a sub-build `sideways: true` (a panel: w × d is its face, h its thickness, at most 6 plates). It's designed flat, face up, and the assembly mounts copies with `"<sub> on <part>:<stud> at <cx>,<cz> spin <s>"` (compact) or a `mount` object (JSON). Part rows list side studs, search knows "side studs", "bracket" and "snot", and 8 carriers are in the core menu. A mount names its carrier by part index; when an edit removes or adds parts, the indices are renumbered automatically, and removing a carrier that still holds a copy is reported instead of silently re-targeting it.

**Live results (2026-09-25, $3.48 in total):**

Huracán photo at High, the sideways run next to the tuned single-pass run (`docs/huracan-sideways-compare.png`, LeoCAD):

| Stage | Tuned single pass | Sub-builds + sideways |
|---|---|---|
| Photo analysis | $0.09 | $0.07 |
| Plan | – | $0.09 |
| Design | $0.91 | sub-builds $0.77 (7, all valid first try; side panel $0.04) + assembly $1.00 (valid first try) |
| Photo comparison | $0.93 | $0.93 (incl. $0.21 of mount repairs, since fixed) |
| **Total** | **$1.92, 147 parts** | **$2.86, 368 parts** |

- **Sideways:** the planner chose a mirrored pair of side-intake panels by itself, mounted on 1 × 2 bricks with a side stud (30414). They render flush on the flanks, with a stepped black intake.
- **Overall:** the single pass is still closer to the photo; the sub-build car is bulkier and taller. That comes from how the sub-build pipeline splits the car, not from the panels (20 of 368 parts).
- **Upright prompts unaffected:** the red house with sideways off vs on cost $0.303 vs $0.315 (87–89 parts, valid first try, no warnings, equal quality in LeoCAD).

## BrickLink wanted list

Download › BrickLink wanted list writes an `.xml` to upload at BrickLink › Wanted › Upload. `src/lib/bricklink/` maps each part and colour to BrickLink's numbers:
- **Core parts:** a hand-made table (`ids.ts`). Windows are listed as frame plus trans-clear glass, and the door as frame plus door.
- **Catalog parts** (upright and sideways): from Rebrickable's LDraw → BrickLink data, generated by `npm run fetch-bricklink` into `rebrickable.json` (by part number, then by LDraw number, following LDraw's "moved to" aliases). 955 of 984 LDraw numbers match, 88 of them to a different BrickLink number (e.g. 6141 → 4073); all 21 colours match.
- **Flagged:** 28 catalog parts have no BrickLink number on Rebrickable (16 aren't on Rebrickable; 12 are listed without one, such as Braille bricks and plain baseplates). They keep their LDraw number as a best guess and are listed in `UNCONFIRMED_BRICKLINK`.
- **Checked:** `ids.test.ts` checks every part has a BrickLink ID, the flagged list, the renumbered parts, and that the core table and colours agree with Rebrickable. That check updated six core numbers: tiles 3070/3069/3068, round brick 3062 and door 60616 (BrickLink's current numbers), and the 2 × 1 ridge (3044b).

## Where to tune things

- **Part library**: `src/lib/parts/library.ts`, with 52 parts:
  - bricks, plates and tiles;
  - 45°/33° slopes and ridges;
  - round bricks, plates and tiles;
  - cones, fences, arches, windows, a door and flower plates.

  Parts that aren't solid boxes declare `solids` (e.g. an arch's opening), `bottom` (the underside cells that take studs) and a viewer `shape`. Multi-piece parts list LDraw `extra` files (the door is frame + door).

  To add a part: add an entry, then run `npm run verify-ldraw`, which checks the bounding box and top studs against the real LDraw geometry. `npm run probe-ldraw <file>` prints a part's measured box and studs. The prompt's part table is generated from this file.
- **Colors**: `src/lib/parts/colors.ts`.
- **Prompts**: `src/lib/prompts/`. `system.ts` holds the rules, coordinate system and design advice. `design.ts` holds the first-turn text and photo prompts. `repair.ts` holds the feedback message and the fix hint for each error type.
- **Limits and model settings**: `src/lib/config.ts`. It sets grid size, part cap, repair rounds, model, effort, max tokens, and pricing for cost estimates.

## How it works

- **Grid**: x is studs to the right, z is studs toward the front, y is plate heights up (1 brick = 3 plates). A placement is `{part, color, x, y, z, rot}`. (x, z) is the min corner of the rotated footprint.
- **Validator** (`src/lib/validate/validator.ts`) reports these errors:
  - unknown part or color, and out-of-bounds parts
  - `OVERLAP` (voxel collision)
  - `FLOATING` (no stud connection to the main structure)
  - `UNSUPPORTED` (held only from above)
  - `DISCONNECTED` (a separate multi-part section)

  It also gives a `WEAK_CONNECTION` warning for a part held by a single stud. Parts connect only when the studs on top of one plug into the underside of the part directly above. Sitting on the ground supports a part but doesn't connect it to anything.
- **Repair loop** (`src/lib/claude/generate.ts`): uses structured JSON output (a hand-written JSON schema, so enums are enforced), adaptive thinking and effort `high`. Each repair round continues the same conversation and appends the validator's errors. The loop stops at the first valid model, or after `maxRepairRounds` and returns the attempt with the fewest errors.
- **Steps** (`src/lib/steps/steps.ts`): parts are grouped into layers by bottom height and split into balanced steps. Every part rests on a part from an earlier step. `checkStepOrder` verifies this.
- **LDraw** (`src/lib/ldraw/export.ts`): 1 stud = 20 LDU, 1 plate = 8 LDU, and −Y is up. The grid is turned 180° about x, so parts are never mirrored. Each part carries its own LDraw yaw and origin offset, and `verify-ldraw` checks them.

## Debugging and cost

Each run writes `debug/<timestamp>-<slug>/`, containing:
- `input.json`, `system-prompt.md` and the input image
- for each round: the prompt, raw JSON output, thinking summary, parsed model and validation result
- `summary.json` and `final-model.json`

Token usage and estimated cost are logged per round and in total. They appear in the server console, the UI and `summary.json`. To view a debug model in the app, use **Open model JSON**: it opens `final-model.json` and also designs with sub-builds (`final-design.json`, or a design downloaded from the Design tab).

## Regression check

`src/lib/regression.test.ts` snapshots seven saved builds (`src/lib/fixtures/regression`: house, pickup, train, duck, two Huracáns and a village design). For each it records validation, connections, structure, steps, manual pages, parts list, `.ldr`/`.mpd` hashes and re-import, the BrickLink list, compile stats and a small render. A change that alters any of them fails the test; update the snapshots (`npx vitest run src/lib/regression.test.ts -u`) only for intended changes. So far that's happened once: the BrickLink numbers from Rebrickable.

## Test results (phase 6)

These are end-to-end runs with `claude-opus-5-5` at effort `high`, using the tuned prompt. Every model was opened and rendered in LeoCAD.

| Input | Valid | Repair rounds | Parts | Cost |
|---|---|---|---|---|
| "a small red house with a door and two windows" | yes | 0 | 37 | $0.12 |
| "a blue pickup truck" | yes | 1 | 78 | $0.34 |
| "a lighthouse on a rocky base" | yes | 0 | 92 | $0.23 |
| "a sitting cat" | yes | 0 | 62 | $0.23 |
| Photo of a red sports car | yes | 1 | 87 | $0.46 |

- **Time:** a generation takes 45–150 s. A repair round adds about 25 s.
- **Repairs seen:** every repair so far fixed `UNSUPPORTED` plates (plates placed at a height where nothing sits under them), and each took one round.
- **Prompt tuning:** after the first pass, two rules were added to `system.ts`, and the four text prompts were re-run to check for regressions. The rules:
  - close gable ends and other visible openings (the first house had an open gable)
  - make wheels stick out from the body (the first truck hid them underneath)

## Known limitations

- **No hanging parts:** a part can't be attached only to the underside of a part above it. Every part must rest on studs below it, which is what makes bottom-up build steps possible.
- **Slopes block their whole box:** collision treats a slope as filling its full bounding box, so nothing can sit in the empty space above a sloped face.
- **Structure isn't simulated:** the validator checks stud connections only. It doesn't check balance, weight or clutch strength. A part held by a single stud gets a warning, not an error.
- **Library:** 978 parts (see Part catalog). Side studs are supported through sideways copies only (no recessed side studs); there are no hinges, clips or Technic beams yet.
- **Sideways copies:** they can't be nested, and a mount names its carrier by part index (renumbered through edits, see [Sideways building](#sideways-building)).
- **BrickLink:** 28 catalog parts have unconfirmed BrickLink numbers (see [BrickLink wanted list](#bricklink-wanted-list)).
- **Simple step grouping:** steps are grouped by layer and position (up to 6 parts each). No build-order optimisation is done beyond that.
