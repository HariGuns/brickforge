/** Writes the hand-built sample models to ./exports as .ldr and .mpd (for checking in LeoCAD). */
import fs from "node:fs";
import { SAMPLE_HOUSE, SAMPLE_STACK } from "../src/lib/fixtures/samples";
import { validate } from "../src/lib/validate/validator";
import { buildSteps } from "../src/lib/steps/steps";
import { exportFileNames, exportLdr, exportMpd } from "../src/lib/ldraw/export";

fs.mkdirSync("exports", { recursive: true });
for (const m of [SAMPLE_HOUSE, SAMPLE_STACK]) {
  const v = validate(m);
  if (!v.valid) throw new Error(`${m.name} invalid: ${v.errors.map((e) => e.message).join("; ")}`);
  const steps = buildSteps(m);
  const names = exportFileNames(m);
  fs.writeFileSync(`exports/${names.ldr}`, exportLdr(m, steps));
  fs.writeFileSync(`exports/${names.mpd}`, exportMpd(m, steps));
  console.log(`exports/${names.ldr}  exports/${names.mpd}  (${m.parts.length} parts, ${steps.length} steps)`);
}
