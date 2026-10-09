/**
 * Regression check on saved builds: everything a user sees from an existing
 * model (validation, connections, structure, steps, manual pages, parts list,
 * LDraw export and re-import, BrickLink list, compile stats, a render) is
 * snapshotted, so changes for new features (e.g. sideways building) can't
 * silently change how upright models behave. Update the snapshot only for
 * an intended change: npx vitest run src/lib/regression.test.ts -u
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validate } from "./validate/validator";
import { buildSteps, checkStepOrder } from "./steps/steps";
import { exportDesignMpd, exportLdr, exportMpd } from "./ldraw/export";
import { importLdr } from "./ldraw/import";
import { countParts } from "./model/stats";
import { exportWantedList } from "./bricklink/wantedList";
import { REBRICKABLE_LOADED } from "./bricklink/ids";
import { compileDesign } from "./design/compile";
import { designSteps } from "./design/steps";
import { flatSection, manualPages } from "./manual/pages";
import { renderModel } from "./render/render";
import type { BrickModel } from "./model/schema";
import type { BrickDesign } from "./design/schema";

const dir = path.join(__dirname, "fixtures/regression");
const hash = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
const key = (p: BrickModel["parts"][number]) => `${p.part}|${p.color}|${p.x},${p.y},${p.z}|${p.rot}`;

async function summary(model: BrickModel, design?: BrickDesign) {
  // Designs are validated by the compiler (design limits), as in the app.
  const compiled = design ? compileDesign(design) : null;
  const v = compiled?.validation ?? validate(model);
  const steps = buildSteps(model);
  const sections = design ? designSteps(design, compiled!).sections : [flatSection(model, steps)];
  const ldr = exportLdr(model, steps);
  const mpd = design ? exportDesignMpd(design, compiled!) : exportMpd(model, steps);
  const back = importLdr(mpd);
  return {
    parts: model.parts.length,
    valid: v.valid,
    errors: v.errors.map((e) => `${e.code} ${e.parts.join(",")}`),
    warnings: v.warnings.map((e) => `${e.code} ${e.parts.join(",")}`),
    connections: v.connections.map((c) => `${c.lower}>${c.upper}:${c.studs}${c.kind === "pin" ? "p" : ""}`).join(" "),
    components: v.components.length,
    structure: v.structure ? { mass: v.structure.totalMassG, maxJoint: v.structure.maxJointLoadG } : null,
    steps: steps.map((s) => `${s.y}:${s.parts.join(",")}`).join(" "),
    stepOrderProblems: checkStepOrder(model, v.connections, steps),
    manual: manualPages(sections).map((p) => `${p.label ?? ""}|${p.local}/${p.localTotal}|${p.pieces}|${p.callout.map((c) => `${c.qty}${c.size}`).join("+")}`),
    partsList: countParts(model).map((c) => `${c.qty}× ${c.part} ${c.color}`),
    ldr: hash(ldr),
    mpd: hash(mpd),
    reimportSame: back.skipped.length === 0 && back.model.parts.map(key).sort().join() === model.parts.map(key).sort().join(),
    compile: compiled ? { pieces: compiled.stats.pieces, unique: compiled.stats.uniqueSubBuilds, copies: compiled.stats.copies, errors: compiled.errors.length, warnings: compiled.warnings.length, sizeCm: compiled.stats.sizeCm } : null,
    render: hash(await renderModel(model, { azimuth: 35, elevation: 25 }, { width: 160, height: 100 })),
  };
}

describe("regression: saved builds behave exactly as before", () => {
  for (const f of fs.readdirSync(dir).sort()) {
    it(f, async () => {
      const json = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      const design: BrickDesign | undefined = f.endsWith(".design.json") ? json : undefined;
      const model: BrickModel = design ? compileDesign(design).model : json;
      expect(await summary(model, design)).toMatchSnapshot();
    }, 60000);
    // The wanted list's part numbers come from Rebrickable data, which each user fetches
    // with their own key (npm run fetch-bricklink); without it this check is skipped.
    it.skipIf(!REBRICKABLE_LOADED)(`${f}: BrickLink wanted list`, () => {
      const json = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      const model: BrickModel = f.endsWith(".design.json") ? compileDesign(json).model : json;
      expect(hash(exportWantedList(model))).toMatchSnapshot();
    });
  }
});
