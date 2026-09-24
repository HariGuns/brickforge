/** Writes the hand-built sample models to ./exports as .ldr and .mpd (for checking in LeoCAD). */
import fs from "node:fs";
import { SAMPLE_HOUSE, SAMPLE_STACK } from "../src/lib/fixtures/samples";
import { SAMPLE_VILLAGE } from "../src/lib/fixtures/designs";
import { PART_SHOWCASE } from "../src/lib/fixtures/showcase";
import { validate } from "../src/lib/validate/validator";
import { buildSteps } from "../src/lib/steps/steps";
import { compileDesign } from "../src/lib/design/compile";
import { exportDesignMpd, exportFileNames, exportLdr, exportMpd } from "../src/lib/ldraw/export";

fs.mkdirSync("exports", { recursive: true });
for (const m of [SAMPLE_HOUSE, SAMPLE_STACK, PART_SHOWCASE]) {
  const v = validate(m);
  if (!v.valid) throw new Error(`${m.name} invalid: ${v.errors.map((e) => e.message).join("; ")}`);
  const steps = buildSteps(m);
  const names = exportFileNames(m);
  fs.writeFileSync(`exports/${names.ldr}`, exportLdr(m, steps));
  fs.writeFileSync(`exports/${names.mpd}`, exportMpd(m, steps));
  console.log(`exports/${names.ldr}  exports/${names.mpd}  (${m.parts.length} parts, ${steps.length} steps)`);
}
// Sub-build design: .mpd with one submodel per unique sub-build, plus the flat .ldr for comparison.
const c = compileDesign(SAMPLE_VILLAGE);
if (c.errors.length) throw new Error(`${SAMPLE_VILLAGE.name}: ${c.errors.map((e) => e.message).join("; ")}`);
const names = exportFileNames(c.model);
fs.writeFileSync(`exports/${names.mpd}`, exportDesignMpd(SAMPLE_VILLAGE, c));
fs.writeFileSync(`exports/${names.ldr}`, exportLdr(c.model, buildSteps(c.model)));
console.log(`exports/${names.mpd} (submodels: ${c.subBuilds.map((s) => `${s.name}×${s.copies}`).join(", ")})  exports/${names.ldr} (flat, ${c.stats.pieces} parts)`);
