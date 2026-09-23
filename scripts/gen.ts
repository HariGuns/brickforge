/**
 * Run the generate → validate → repair loop from the command line.
 *   npm run gen "a red fire truck"
 *   npm run gen -- --image photo.jpg "optional extra instructions"
 *   npm run gen -- --size small "a rubber duck"      (small | medium | large)
 *   npm run gen -- --base model.json "add a chimney"  (edit an existing model)
 * Writes exports/<name>.ldr/.mpd and a debug folder under ./debug.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
config({ path: ".env.local" });

const { generateModel } = await import("../src/lib/claude/generate");
const { exportFileNames, exportLdr, exportMpd } = await import("../src/lib/ldraw/export");
const { formatUsage } = await import("../src/lib/claude/usage");

const args = process.argv.slice(2);
let imagePath: string | undefined;
const i = args.indexOf("--image");
if (i >= 0) [imagePath] = args.splice(i, 2).slice(1);
let size: "small" | "medium" | "large" | undefined;
const si = args.indexOf("--size");
if (si >= 0) size = args.splice(si, 2)[1] as typeof size;
const bi = args.indexOf("--base");
const base = bi >= 0 ? JSON.parse(fs.readFileSync(args.splice(bi, 2)[1], "utf8")) : undefined;
const text = args.join(" ").trim() || undefined;

const ext = imagePath ? path.extname(imagePath).slice(1).toLowerCase() : "";
const mediaType = ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" } as const)[ext as "jpg"];
const image = imagePath ? { mediaType, data: fs.readFileSync(imagePath).toString("base64") } : undefined;

const result = await generateModel({ text, image, size, base }, (e) => {
  if (e.type === "round_start") console.log(`→ round ${e.round} (${e.kind})…`);
  if (e.type === "round_end" && e.errors.length) {
    for (const err of e.errors.slice(0, 8)) console.log(`    ${err.code}: ${err.message}`);
    if (e.errors.length > 8) console.log(`    … ${e.summary.errorCount - 8} more`);
  }
});

console.log(`\nValid: ${result.valid} · parts: ${result.model?.parts.length ?? 0} · steps: ${result.steps.length}`);
for (const r of result.rounds) console.log(`  round ${r.round}: ${r.errorCount} errors · ${r.seconds.toFixed(0)}s · ${formatUsage(r.usage)}`);
console.log(`  total: ${formatUsage(result.usage)}`);
if (result.model) {
  fs.mkdirSync("exports", { recursive: true });
  const n = exportFileNames(result.model);
  fs.writeFileSync(`exports/${n.ldr}`, exportLdr(result.model, result.steps));
  fs.writeFileSync(`exports/${n.mpd}`, exportMpd(result.model, result.steps));
  console.log(`  wrote exports/${n.ldr} and exports/${n.mpd}`);
}
console.log(`  debug: ${result.debugDir}`);
