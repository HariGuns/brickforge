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
| `npm run gen -- --size small "a rubber duck"` | Target size: `small`, `medium` or `large` (the same choice as the size buttons in the chat) |
| `npm run verify-ldraw` | Check every part in the library against the official LDraw library (needs `ldraw-lib/`, see below) |
| `npm run export-sample` | Export the hand-built sample models to `exports/` |
| `scripts/leocad-render.sh exports/X.ldr [out.png] [step]` | Render an export with LeoCAD (flatpak `org.leocad.LeoCAD`) to confirm it opens |

LDraw library for `verify-ldraw` and LeoCAD rendering:
`mkdir ldraw-lib && curl -L https://library.ldraw.org/library/updates/complete.zip -o ldraw-lib/complete.zip && (cd ldraw-lib && unzip -q complete.zip)`

## The app

The UI follows `design/brickforge-v2.html`.
- **Chat:** describe a model or attach a photo, pick a size, and build. Progress and repair rounds show inline with a running cost.
- **Library:** your saved runs from `debug/` and any `.ldr` files in `exports/`. `.ldr` files are read back with `src/lib/ldraw/import.ts`.
- **Tabs:**
  - **Model:** 3D view with 3/4, front and top cameras, full screen and spin. It includes the Issues card (errors outlined in red, warnings in amber) and a playback bar that animates the build step by step.
  - **Manual:** an instruction book with one cream page per step. Each page has an isometric three.js render (new parts outlined in orange), a parts callout with 3D icons, zoom, a Go to menu and a thumbnail strip. **Manual PDF** exports it as one A4 page per step.
  - **Parts:** parts list grouped by category.
  - **Design:** the model JSON plus stats.
- **Other:** dark mode, and the Download menu (.ldr, .mpd, Open model JSON).
- **Not built yet:** undo/redo, versions, Save, Showcase, editing a model from the chat, sub-builds and shared builds are disabled placeholders.

## Where to tune things

- **Part library**: `src/lib/parts/library.ts`. Add an entry, then run `npm run verify-ldraw`. The prompt's part table is generated from this file.
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
