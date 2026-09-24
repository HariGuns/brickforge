# BrickForge (Brick Builder)

Local web app that turns a text description or a photo into a buildable model made of generic interlocking bricks. Claude (`claude-opus-5-5`) designs the model on a stud grid. A validator checks it is physically buildable, and errors go back to Claude until the model is valid. The app shows the model in 3D, with step-by-step instructions, a parts list and LDraw export.

## Setup

```bash
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local   # server-side only, gitignored
npm run dev                                         # http://localhost:3000
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app |
| `npm test` | Unit tests (validator, steps, LDraw export, repair loop with a fake Claude) |
| `npm run gen "a red fire truck"` | Run the full generate → validate → repair loop from the CLI; writes `exports/*.ldr/.mpd` |
| `npm run gen -- --image photo.jpg "extra instructions"` | Same, from a photo |
| `npm run gen -- --base model.json "add a chimney"` | Edit an existing model (JSON) instead of building a new one |
| `npm run gen -- --size small "a rubber duck"` | Target size: `small`, `medium` or `large` (the same choice as the size buttons in the chat) |
| `npm run gen -- --pipeline subbuilds --size large "a castle"` | Generator path: `single` (default), `subbuilds` or `auto` (sub-builds for Large) |
| `npm run gen -- --resume debug/<run folder>` | Finish an interrupted sub-build run: reuses its valid plan, sub-builds and assembly, redoes the rest, and writes into the same folder. Earlier and new cost are reported separately |
| `npm run bench [side]` | Compile benchmark for a large nested design (`side` 5 ≈ 4,600 parts) |
| `npm run verify-ldraw` | Check every part in the library against the official LDraw library (needs `ldraw-lib/`, see below) |
| `npm run export-sample` | Export the hand-built sample models to `exports/` |
| `scripts/leocad-render.sh exports/X.ldr [out.png] [step]` | Render an export with LeoCAD (flatpak `org.leocad.LeoCAD`) to confirm it opens |

LDraw library for `verify-ldraw` and LeoCAD rendering:
`mkdir ldraw-lib && curl -L https://library.ldraw.org/library/updates/complete.zip -o ldraw-lib/complete.zip && (cd ldraw-lib && unzip -q complete.zip)`

## The app

The UI follows `design/brickforge-v2.html`.
- **Chat:** describe a model or attach a photo, pick a size, and build. Progress and repair rounds show inline with a running cost. With a model loaded, messages **edit** it by default (toggle "Editing ⟨model⟩" off to start a new build). Claude gets the current parts list and your request, returns the full updated model, and it goes through the same validate/repair loop. The reply shows how many parts were added, removed and kept. The edit prompt is `src/lib/prompts/edit.ts`.
- **Library:** your saved runs from `debug/` and any `.ldr` files in `exports/`. `.ldr` files are read back with `src/lib/ldraw/import.ts`.
- **Tabs:**
  - **Model:** 3D view with 3/4, front and top cameras, full screen and spin. It includes the Issues card (errors outlined in red, warnings in amber) and a playback bar that animates the build step by step.
  - **Manual:** an instruction book with one cream page per step. Each page has an isometric three.js render (new parts outlined in orange), a parts callout with 3D icons, zoom, a Go to menu and a thumbnail strip. **Manual PDF** exports it as one A4 page per step.
  - **Parts:** parts list grouped by category.
  - **Design:** the model JSON plus stats.
- **Other:** dark mode, and the Download menu (.ldr, .mpd, Open model JSON).
- **Versions, undo/redo and Save:**
  - **Versions:** every chat edit adds a version to the open build, and the Versions menu lists them all (click one to restore it).
  - **Undo/redo:** the top-bar buttons, or ⌘/Ctrl+Z and ⌘/Ctrl+Shift+Z, step through your changes. A new edit clears the redo steps but never deletes a version.
  - **Save** (⌘/Ctrl+S): writes the build with all its versions to `builds/<id>.json` (gitignored). Saved builds appear at the top of the Library.
  - **Unsaved work:** switching builds or leaving the page asks first. Logic: `src/lib/builds/doc.ts`; storage: `src/lib/builds/store.ts`.
- **Not built yet:** Showcase, sub-builds and shared builds are disabled placeholders.

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

**Sub-build generator** (`src/lib/claude/subbuilds.ts`, prompts in `src/lib/prompts/subbuilds.ts`): choose it with the path selector, `--pipeline subbuilds`, or `CONFIG.generator`.
1. **Plan:** the sub-builds, each with a size envelope, part budget and copy count, plus a layout.
2. **Design each unique sub-build once:** 4 in parallel, each validated on its own inside its envelope with its own repair loop.
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
| | sub-builds | yes | 14 (2 sub-build + 1 assembly repair) | 1,014 | 8 / 23 | $2.57 |

The village sub-build run was interrupted at assembly when the API credit ran out. It was finished with `--resume`, which reused the plan and all 8 valid sub-builds ($2.11 already spent) and ran only the assembly ($0.46).

`.mpd` export for designs has one submodel per unique sub-build, with copies as references; the importer expands them back. Compiling ~4,600 parts in 425 nested copies takes about 60 ms (`npm run bench`).

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

Token usage and estimated cost are logged per round and in total. They appear in the server console, the UI and `summary.json`. To view a debug model in the app, use **Open model JSON**.

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

## Known limitations (v1)

- **No hanging parts:** a part can't be attached only to the underside of a part above it. Every part must rest on studs below it, which is what makes bottom-up build steps possible.
- **Slopes block their whole box:** collision treats a slope as filling its full bounding box, so nothing can sit in the empty space above a sloped face.
- **Structure isn't simulated:** the validator checks stud connections only. It doesn't check balance, weight or clutch strength. A part held by a single stud gets a warning, not an error.
- **Small library:** v1 has bricks, plates, tiles and 45° slopes only. There are no curved, inverted, SNOT or Technic parts.
- **Simple step grouping:** steps are grouped by layer and position (up to 6 parts each). No build-order optimisation is done beyond that.
