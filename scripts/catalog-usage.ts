/**
 * Which catalog parts generations actually use, across all runs in debug/
 * (from each summary.json's "catalog" field, plus the part searches Claude made).
 *
 * Usage: npm run catalog-usage
 */
import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "../src/lib/config";
import { getPart } from "../src/lib/parts/library";

const root = path.resolve(CONFIG.debugDir);
const totals = new Map<string, { placements: number; runs: number }>();
const queries = new Map<string, number>();
let runs = 0, withCatalog = 0;
for (const dir of fs.existsSync(root) ? fs.readdirSync(root) : []) {
  const full = path.join(root, dir);
  try {
    const s = JSON.parse(fs.readFileSync(path.join(full, "summary.json"), "utf8"));
    if (!s.catalog) continue;
    runs++;
    const ids = Object.entries(s.catalog.parts as Record<string, number>);
    if (ids.length) withCatalog++;
    for (const [id, n] of ids) {
      const t = totals.get(id) ?? { placements: 0, runs: 0 };
      t.placements += n;
      t.runs++;
      totals.set(id, t);
    }
  } catch {
    continue;
  }
  for (const f of fs.readdirSync(full).filter((f) => f.endsWith(".tools.json"))) {
    for (const call of JSON.parse(fs.readFileSync(path.join(full, f), "utf8"))) {
      const q = String(call.input?.query ?? "").toLowerCase();
      queries.set(q, (queries.get(q) ?? 0) + 1);
    }
  }
}
console.log(`${runs} runs with catalog logging, ${withCatalog} used catalog parts.\n`);
console.log("part          runs  placements  name");
for (const [id, t] of [...totals].sort((a, b) => b[1].runs - a[1].runs || b[1].placements - a[1].placements)) {
  console.log(`${id.padEnd(12)} ${String(t.runs).padStart(5)} ${String(t.placements).padStart(11)}  ${getPart(id)?.name ?? "?"}`);
}
if (queries.size) {
  console.log("\nsearches:");
  for (const [q, n] of [...queries].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`${String(n).padStart(4)}  ${q}`);
}
