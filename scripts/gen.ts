/**
 * Run the generate → validate → repair loop from the command line.
 *   npm run gen "a red fire truck"
 *   npm run gen -- --image photo.jpg "optional extra instructions"
 *   npm run gen -- --size small "a rubber duck"      (small | medium | large)
 *   npm run gen -- --base model.json "add a chimney"  (edit an existing model)
 *   npm run gen -- --pipeline single "a castle"         (single | subbuilds | auto; default from CONFIG.generator)
 * Writes exports/<name>.ldr/.mpd and a debug folder under ./debug.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
config({ path: ".env.local" });

const { generateModel } = await import("../src/lib/claude/generate");
const { generateDesign } = await import("../src/lib/claude/subbuilds");
const { exportDesignMpd, exportFileNames, exportLdr, exportMpd } = await import("../src/lib/ldraw/export");
const { compileDesign } = await import("../src/lib/design/compile");
const { formatUsage } = await import("../src/lib/claude/usage");

const args = process.argv.slice(2);
let imagePath: string | undefined;
const i = args.indexOf("--image");
if (i >= 0) [imagePath] = args.splice(i, 2).slice(1);
let size: "small" | "medium" | "large" | undefined;
const si = args.indexOf("--size");
if (si >= 0) size = args.splice(si, 2)[1] as typeof size;
const pi = args.indexOf("--pipeline");
const pipelineArg = pi >= 0 ? (args.splice(pi, 2)[1] as "single" | "subbuilds" | "auto") : undefined;
const bi = args.indexOf("--base");
const base = bi >= 0 ? JSON.parse(fs.readFileSync(args.splice(bi, 2)[1], "utf8")) : undefined;
const text = args.join(" ").trim() || undefined;

const ext = imagePath ? path.extname(imagePath).slice(1).toLowerCase() : "";
const mediaType = ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" } as const)[ext as "jpg"];
const image = imagePath ? { mediaType, data: fs.readFileSync(imagePath).toString("base64") } : undefined;

const { resolvePipeline, AVAILABLE_PIPELINES } = await import("../src/lib/claude/pipeline");
const pipeline = resolvePipeline(pipelineArg, size, !!base);
if (!AVAILABLE_PIPELINES.includes(pipeline)) {
  console.error(`The ${pipeline} generator isn't built yet. Use --pipeline single.`);
  process.exit(2);
}
console.log(`pipeline: ${pipeline}`);

const run = pipeline === "subbuilds" ? generateDesign : generateModel;
const result = await run({ text, image, size, base }, (e) => {
  if (e.type === "stage") console.log(`${e.status === "start" ? "▶" : "■"} ${e.label}${e.copies ? ` ×${e.copies}` : ""}${e.status === "done" ? ` — ${e.valid ? "ok" : "not valid"}${e.parts !== undefined ? `, ${e.parts}` : ""}${e.cost !== undefined ? `, $${e.cost.toFixed(3)}` : ""}` : ""}`);
  if (e.type === "round_start") console.log(`→ ${e.scope} round ${e.round} (${e.kind})…`);
  if (e.type === "round_end" && e.errors.length) {
    for (const err of e.errors.slice(0, 8)) console.log(`    ${err.code}: ${err.message}`);
    if (e.errors.length > 8) console.log(`    … ${e.summary.errorCount - 8} more`);
  }
});

console.log(`\nValid: ${result.valid} · parts: ${result.model?.parts.length ?? 0} · steps: ${result.steps.length}${result.compile ? ` · sub-builds: ${result.compile.stats.uniqueSubBuilds} unique, ${result.compile.stats.copies} copies · compile ${result.compile.stats.compileMs} ms` : ""}`);
for (const r of result.rounds) console.log(`  ${r.scope} round ${r.round}: ${r.errorCount} errors · ${r.seconds.toFixed(0)}s · ${formatUsage(r.usage)}`);
console.log(`  total: ${formatUsage(result.usage)}`);
if (result.model) {
  fs.mkdirSync("exports", { recursive: true });
  const n = exportFileNames(result.model);
  fs.writeFileSync(`exports/${n.ldr}`, exportLdr(result.model, result.steps));
  // Sub-build designs get one submodel per unique sub-build in the .mpd.
  fs.writeFileSync(`exports/${n.mpd}`, result.design ? exportDesignMpd(result.design, compileDesign(result.design)) : exportMpd(result.model, result.steps));
  console.log(`  wrote exports/${n.ldr} and exports/${n.mpd}`);
}
console.log(`  debug: ${result.debugDir}`);
