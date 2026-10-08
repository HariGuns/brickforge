/**
 * Re-check every component in the library with the placement check (a
 * component must hold on a baseplate and on a plate, not only standing on its
 * own; see src/lib/components/placement.ts) and list the ones that fail.
 *   npm run check-components                       (report only)
 *   npm run check-components -- --quarantine       (also move failing ones to components-quarantine/)
 *   npm run check-components -- --move <id>        (move a named component there too; repeatable)
 * Quarantined components are moved, not deleted: move a file back to restore it.
 */
import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "../src/lib/config";
import { loadLibrary } from "../src/lib/components/library";
import { placementCheck } from "../src/lib/components/placement";
import { compileSubBuild } from "../src/lib/design/compile";

const args = process.argv.slice(2);
const quarantine = args.includes("--quarantine");
const named: string[] = [];
for (let k = args.indexOf("--move"); k >= 0; k = args.indexOf("--move")) named.push(args.splice(k, 2)[1]);

const lib = loadLibrary();
const failing: { id: string; why: string }[] = [];
for (const c of lib.components) {
  if (c.sideways) continue;
  const compiled = compileSubBuild({ name: c.name, description: "", subBuilds: c.subBuilds, main: { parts: [], uses: [] } }, c.root, { structure: "warn" });
  const why = compiled.errors.length ? `not valid on its own: ${compiled.errors.map((e) => e.code).join(", ")}` : placementCheck(compiled.model).errors.map((e) => `${e.code}: ${e.message}`).join(" | ");
  if (why) failing.push({ id: c.id, why });
}
console.log(`${lib.components.length} components checked (${lib.components.filter((c) => c.sideways).length} sideways panels skipped): ${failing.length} fail when placed.`);
for (const f of failing) console.log(`  ${f.id}: ${f.why.slice(0, 220)}`);

const move = [...(quarantine ? failing.map((f) => f.id) : []), ...named];
if (move.length) {
  fs.mkdirSync(CONFIG.quarantineDir, { recursive: true });
  for (const id of new Set(move)) {
    const from = path.join(lib.dir, `${id}.json`);
    if (!fs.existsSync(from)) {
      console.log(`  ${id}: not in the library`);
      continue;
    }
    const to = path.join(CONFIG.quarantineDir, `${id}.json`);
    if (fs.existsSync(to)) throw new Error(`${to} already exists; not overwriting it.`);
    fs.renameSync(from, to);
    console.log(`  moved ${id} to ${CONFIG.quarantineDir}/`);
  }
  console.log(`Library: ${loadLibrary().components.length} components.`);
}
