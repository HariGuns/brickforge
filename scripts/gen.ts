/**
 * Run the generate → validate → repair loop from the command line.
 *   npm run gen "a red fire truck"
 *   npm run gen -- --image photo.jpg "optional extra instructions"
 *   npm run gen -- --detail high "a rubber duck"      (standard | high | very_high; default standard)
 *   npm run gen -- --base model.json "add a chimney"  (edit an existing model)
 *   npm run gen -- --pipeline single "a castle"         (single | subbuilds | auto; default from CONFIG.generator)
 *   npm run gen -- --resume debug/<run folder>          (finish an interrupted sub-build run)
 *   npm run gen -- --tree / --no-tree "a town square"   (deeper sub-build trees; default on for Very high)
 *   npm run gen -- --budget 15 "a town square"          (budget cap in USD: stops and reports before a call would go over it)
 *   npm run gen -- --simulate "a town square"           (simulated Claude, no API calls: always the scripted town square,
 *                                                        tree mode; data goes to sim/ instead of the repo's debug/, exports/, components/)
 * Writes exports/<name>.ldr/.mpd and a debug folder under ./debug.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
config({ path: ".env.local" });

// --simulate: set before anything reads CONFIG, so simulated runs, exports and components stay in sim/.
const simulate = process.argv.includes("--simulate");
if (simulate) {
  process.argv.splice(process.argv.indexOf("--simulate"), 1);
  process.env.BRICKFORGE_DATA_DIR ??= path.resolve("sim");
  console.log(`simulated Claude (no API calls); data in ${process.env.BRICKFORGE_DATA_DIR}`);
}

const { generateModel } = await import("../src/lib/claude/generate");
const { generateDesign, resumeDesign } = await import("../src/lib/claude/subbuilds");
const { exportDesignMpd, exportFileNames, exportLdr, exportMpd } = await import("../src/lib/ldraw/export");
const { compileDesign } = await import("../src/lib/design/compile");
const { formatUsage } = await import("../src/lib/claude/usage");
const { formatBreakdown } = await import("../src/lib/claude/breakdown");

const args = process.argv.slice(2);
let imagePath: string | undefined;
const i = args.indexOf("--image");
if (i >= 0) [imagePath] = args.splice(i, 2).slice(1);
const { toDetail } = await import("../src/lib/detail");
// --detail standard | high | very_high.
const detailAt = args.indexOf("--detail");
const detailArg = detailAt >= 0 ? args.splice(detailAt, 2)[1] : undefined;
const detail = toDetail(detailArg);
if (detailArg && !detail) {
  console.error(`Unknown detail "${detailArg}". Use standard, high or very_high.`);
  process.exit(2);
}
// --refine N: photo comparison rounds (0 = off); --stage-effort subBuild=medium; --stage-model repair=claude-sonnet-5 (repeatable).
const { CONFIG } = await import("../src/lib/config");
for (let k = args.indexOf("--refine"); k >= 0; k = args.indexOf("--refine")) CONFIG.refine.rounds = Number(args.splice(k, 2)[1]);
for (const [flag, field] of [["--stage-effort", "effort"], ["--stage-model", "model"]] as const) {
  for (let k = args.indexOf(flag); k >= 0; k = args.indexOf(flag)) {
    const [stage, value] = args.splice(k, 2)[1].split("=");
    const st = stage as keyof typeof CONFIG.stages;
    if (!(st in CONFIG.stages)) throw new Error(`Unknown stage "${stage}" (${Object.keys(CONFIG.stages).join(", ")})`);
    CONFIG.stages[st] = { ...CONFIG.stages[st], [field]: value };
  }
}
const ri = args.indexOf("--resume");
const resumeDir = ri >= 0 ? args.splice(ri, 2)[1] : undefined;
const pi = args.indexOf("--pipeline");
const pipelineArg = pi >= 0 ? (args.splice(pi, 2)[1] as "single" | "subbuilds" | "auto") : undefined;
// --tree / --no-tree: deeper sub-build trees (default: CONFIG.tree.details).
let tree: boolean | undefined = simulate ? true : undefined;
for (const [flag, on] of [["--tree", true], ["--no-tree", false]] as const) {
  const k = args.indexOf(flag);
  if (k >= 0) (args.splice(k, 1), (tree = on));
}
// --budget 15: cap in USD for the whole model (a resumed run counts what it spent before).
const bgi = args.indexOf("--budget");
const budget = bgi >= 0 ? Number(args.splice(bgi, 2)[1]) : undefined;
if (budget !== undefined && !(budget > 0)) {
  console.error("--budget needs a positive amount in USD, e.g. --budget 15");
  process.exit(2);
}
const bi = args.indexOf("--base");
const base = bi >= 0 ? JSON.parse(fs.readFileSync(args.splice(bi, 2)[1], "utf8")) : undefined;
const text = args.join(" ").trim() || undefined;

const ext = imagePath ? path.extname(imagePath).slice(1).toLowerCase() : "";
const mediaType = ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" } as const)[ext as "jpg"];
const image = imagePath ? { mediaType, data: fs.readFileSync(imagePath).toString("base64") } : undefined;

const { resolvePipeline } = await import("../src/lib/claude/pipeline");
const pipeline = resumeDir || tree ? "subbuilds" : resolvePipeline(pipelineArg, detail, !!base);
console.log(`pipeline: ${pipeline}`);

const onEvent = (e: import("../src/lib/claude/generate").GenerateEvent) => {
  if (e.type === "stage") console.log(`${"  ".repeat(Math.max(0, (e.depth ?? 1) - 1))}${e.status === "start" ? "▶" : "■"} ${e.scope.startsWith("plan:") ? "plan " : e.scope.startsWith("asm:") ? "assemble " : ""}${e.label}${e.copies ? ` ×${e.copies}` : ""}${e.status === "done" ? ` — ${e.valid ? "ok" : "not valid"}${e.parts !== undefined ? `, ${e.parts}` : ""}${e.cost !== undefined ? `, $${e.cost.toFixed(3)}` : ""}` : ""}`);
  if (e.type === "budget") console.log(`■ Budget cap $${e.cap.toFixed(2)} reached: $${e.spent.toFixed(2)} spent; ${e.next.scope} (~$${e.next.estimate.toFixed(2)}) didn't start.${e.savedComponents ? ` ${e.savedComponents} valid sub-builds saved to the library.` : ""}${e.resume ? `\n  Resume: ${e.resume}` : ""}`);
  if (e.type === "round_start") console.log(`→ ${e.scope} round ${e.round} (${e.kind})…`);
  if (e.type === "round_end" && e.errors.length) {
    for (const err of e.errors.slice(0, 8)) console.log(`    ${err.code}: ${err.message}`);
    if (e.errors.length > 8) console.log(`    … ${e.summary.errorCount - 8} more`);
  }
};
const { simulatedClient } = await import("../src/lib/claude/simulated");
const client = simulate ? simulatedClient({ delayMs: 20 }) : undefined;
const result = resumeDir
  ? await resumeDesign(resumeDir, onEvent, { budget, client })
  : pipeline === "subbuilds"
    ? await generateDesign({ text, image, detail, tree }, onEvent, { budget, client })
    : await generateModel({ text, image, detail, base }, onEvent, { budget, client });

console.log(`\nValid: ${result.valid} · parts: ${result.model?.parts.length ?? 0} · steps: ${result.steps.length}${result.compile ? ` · sub-builds: ${result.compile.stats.uniqueSubBuilds} unique, ${result.compile.stats.copies} copies · compile ${result.compile.stats.compileMs} ms` : ""}`);
for (const r of result.rounds) console.log(`  ${r.scope} round ${r.round}: ${r.errorCount} errors · ${r.seconds.toFixed(0)}s · ${formatUsage(r.usage)}${r.reused ? " (earlier run)" : ""}`);
console.log(`  total: ${formatUsage(result.usage)}`);
if (result.costBreakdown) console.log(`  cost: ${formatBreakdown(result.costBreakdown)}`);
if (result.library) console.log(`  library: ${result.library.reused} components reused (${result.library.copies} copies, ~$${result.library.saved.toFixed(2)} saved), ${result.library.added} new components saved`);
if (result.model) {
  const out = CONFIG.exportsDir;
  fs.mkdirSync(out, { recursive: true });
  const n = exportFileNames(result.model);
  fs.writeFileSync(path.join(out, n.ldr), exportLdr(result.model, result.steps));
  // Sub-build designs get one submodel per unique sub-build in the .mpd.
  fs.writeFileSync(path.join(out, n.mpd), result.design ? exportDesignMpd(result.design, compileDesign(result.design)) : exportMpd(result.model, result.steps));
  console.log(`  wrote ${path.join(out, n.ldr)} and ${path.join(out, n.mpd)}`);
}
console.log(`  debug: ${result.debugDir}`);
