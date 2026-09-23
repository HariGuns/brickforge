# Brick Builder

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
| `npm run verify-ldraw` | Check every part in the library against the official LDraw library (needs `ldraw-lib/`, see below) |
| `npm run export-sample` | Export the hand-built sample models to `exports/` |
| `scripts/leocad-render.sh exports/X.ldr [out.png] [step]` | Render an export with LeoCAD (flatpak `org.leocad.LeoCAD`) to confirm it opens |

LDraw library for `verify-ldraw` and LeoCAD rendering:
`mkdir ldraw-lib && curl -L https://library.ldraw.org/library/updates/complete.zip -o ldraw-lib/complete.zip && (cd ldraw-lib && unzip -q complete.zip)`

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
