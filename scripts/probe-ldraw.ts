/**
 * Print an LDraw part's native bounding box (in studs / plates) and top-stud
 * positions, to help define new library entries.
 * Usage: npm run probe-ldraw 3659 60592c01 …
 */
import { openLibrary } from "./lib/ldrawGeo";

const lib = openLibrary();
for (const id of process.argv.slice(2)) {
  const file = id.endsWith(".dat") ? id : `${id}.dat`;
  const g = lib.walk(file);
  const r = (n: number) => Math.round(n * 100) / 100;
  // The top is where the top studs sit (some frames have tabs above their top face).
  const ys = g.studs.map((s) => s[1]);
  const top = ys.length ? Math.max(...ys) : g.min[1];
  const studs = g.studs.filter((s) => Math.abs(s[1] - top) < 1.01);
  console.log(`${file.padEnd(12)} ${lib.title(file)}`);
  console.log(`  X ${r(g.min[0])}..${r(g.max[0])}  (${r((g.max[0] - g.min[0]) / 20)} studs)   Z ${r(g.min[2])}..${r(g.max[2])}  (${r((g.max[2] - g.min[2]) / 20)} studs)   Y ${r(g.min[1])}..${r(g.max[1])}  (${r((g.max[1] - g.min[1]) / 8)} plates)`);
  console.log(`  top studs (${studs.length}): ${studs.map((s) => `(${r(s[0])},${r(s[2])})`).join(" ")}${g.studs.length !== studs.length ? `   other studs: ${g.studs.length - studs.length} at y ${[...new Set(g.studs.filter((s) => !studs.includes(s)).map((s) => r(s[1])))].join(",")}` : ""}${g.missing.size ? `   MISSING ${[...g.missing].join(",")}` : ""}`);
}
