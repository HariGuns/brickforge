/**
 * Seed the component library (CONFIG.componentsDir) from the valid sub-builds
 * of every run in debug/ and every saved build. Existing components are kept;
 * duplicates are skipped.
 *   npm run seed-components                               (add them)
 *   npm run seed-components -- --dry-run                  (only report)
 *   npm run seed-components -- --from ~/.config/BrickForge (also another data folder, e.g. the desktop app's; repeatable)
 */
import path from "node:path";
import { seedLibrary, type SeedReport } from "../src/lib/components/seed";
import { loadLibrary } from "../src/lib/components/library";
import { CONFIG } from "../src/lib/config";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const folders = [{ debugDir: CONFIG.debugDir, buildsDir: CONFIG.buildsDir }];
for (let k = args.indexOf("--from"); k >= 0; k = args.indexOf("--from")) {
  const from = args.splice(k, 2)[1];
  folders.push({ debugDir: path.join(from, "debug"), buildsDir: path.join(from, "builds") });
}
const dir = CONFIG.componentsDir;
for (const f of folders) {
  const r: SeedReport = seedLibrary({ dir, dryRun, ...f });
  console.log(`${dryRun ? "[dry run] " : ""}${path.dirname(path.resolve(f.debugDir))}: ${r.runs} runs and ${r.builds} saved builds, ${r.found} sub-builds found, ${r.added} added, ${r.duplicates} duplicates, ${r.invalid} not valid on their own.`);
  for (const s of r.skipped) console.log(`  skipped ${s}`);
}
if (!dryRun) {
  const lib = loadLibrary(dir);
  console.log(`Library: ${lib.components.length} components in ${lib.dir}`);
  for (const c of lib.components) console.log(`  ${c.id.padEnd(36)} ${`${c.size.w}×${c.size.d}×${c.size.h}`.padEnd(10)} ${String(c.parts).padStart(4)} parts  ${c.sideways ? "sideways · " : ""}${c.tags.slice(0, 6).join(", ")}`);
}
