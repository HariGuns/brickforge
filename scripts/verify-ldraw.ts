/**
 * Verifies the part library against the official LDraw library in ./ldraw-lib/ldraw.
 * For every part it places the LDraw geometry exactly as the exporter would
 * (rot 0 and rot 90 at the origin, including any extra parts such as a door in
 * its frame) and checks that:
 *   - the body's bounding box matches our footprint and height
 *     (tabs up to one stud height above the top are allowed where marked)
 *   - the top studs are exactly where our stud mask says
 *   - no file is a "~Moved to" redirect
 * Solids (arch openings) and underside masks are hand-specified; the LeoCAD
 * render of exports/Part_showcase.mpd (npm run export-sample) is the visual check.
 *
 * Usage: npm run verify-ldraw   (download: see README)
 */
import { PARTS, type PartDef } from "../src/lib/parts/library";
import { footprint, worldStuds } from "../src/lib/model/geometry";
import { ldrawTransform, LDU_PLATE, LDU_STUD } from "../src/lib/ldraw/export";
import type { Rot } from "../src/lib/model/schema";
import { openLibrary, type Geo, type V } from "./lib/ldrawGeo";

const lib = openLibrary(process.argv[2]);
if (lib.size === 0) {
  console.error("No LDraw library found (see README).");
  process.exit(2);
}

function merge(a: Geo, b: Geo): Geo {
  return {
    min: [0, 1, 2].map((i) => Math.min(a.min[i], b.min[i])) as V,
    max: [0, 1, 2].map((i) => Math.max(a.max[i], b.max[i])) as V,
    studs: [...a.studs, ...b.studs],
    missing: new Set([...a.missing, ...b.missing]),
  };
}

function check(def: PartDef, rot: Rot): string[] {
  const problems: string[] = [];
  for (const file of [def.ldraw.file, ...(def.ldraw.extra ?? []).map((e) => e.file)]) {
    const first = lib.readLines(file)?.[0] ?? "";
    if (/~Moved to/i.test(first)) problems.push(`${file} is a redirect: "${first.replace(/^0\s*/, "")}"`);
  }
  const pl = { part: def.id, color: "red", x: 0, y: 0, z: 0, rot };
  const { pos, m } = ldrawTransform(pl, def);
  let g = lib.walk(def.ldraw.file, m, pos);
  for (const e of def.ldraw.extra ?? []) {
    const [ox, oy, oz] = e.offset;
    g = merge(g, lib.walk(e.file, m, [pos[0] + m[0] * ox + m[1] * oy + m[2] * oz, pos[1] + m[3] * ox + m[4] * oy + m[5] * oz, pos[2] + m[6] * ox + m[7] * oy + m[8] * oz]));
  }
  if (g.missing.size) problems.push(`missing subfiles: ${[...g.missing].join(", ")}`);

  const fp = footprint(pl, def);
  // Expected body box in LDraw space (X = x, Y = -y, Z = -z).
  const exp = { minX: 0, maxX: fp.sx * LDU_STUD, minY: -fp.y1 * LDU_PLATE, maxY: -fp.y0 * LDU_PLATE, minZ: -fp.sz * LDU_STUD, maxZ: 0 };
  const slack = (def.ldraw.slack ?? 1) + 0.01;
  const got = { minX: g.min[0], maxX: g.max[0], minY: g.min[1], maxY: g.max[1], minZ: g.min[2], maxZ: g.max[2] };
  for (const k of Object.keys(exp) as (keyof typeof exp)[]) {
    const tabs = k === "minY" && def.ldraw.topTabs && got.minY < exp.minY && got.minY >= exp.minY - 4.01;
    if (!tabs && Math.abs(exp[k] - got[k]) >= slack) problems.push(`bbox ${k}: expected ${exp[k]}, got ${Math.round(got[k] * 100) / 100}`);
  }

  const toCell = (v: V) => `${Math.floor(v[0] / LDU_STUD)},${Math.floor(-v[2] / LDU_STUD)}`;
  const onCentre = (u: number) => Math.abs((((u % LDU_STUD) + LDU_STUD) % LDU_STUD) - LDU_STUD / 2) < 1.01;
  const topStuds = g.studs.filter((s) => Math.abs(s[1] - exp.minY) < 1.01);
  const offGrid = topStuds.filter((s) => !onCentre(s[0]) || !onCentre(s[2]));
  if (offGrid.length && !def.ldraw.offGridStud) problems.push(`${offGrid.length} top stud(s) sit between grid cells`);
  const gotStuds = topStuds.filter((s) => !offGrid.includes(s)).map(toCell).sort();
  const expStuds = worldStuds(pl, def).map(([x, z]) => `${x},${z}`).sort();
  if (gotStuds.join(" ") !== expStuds.join(" ")) problems.push(`studs: expected [${expStuds.join(" ")}], got [${gotStuds.join(" ")}]`);
  return problems;
}

let failures = 0;
for (const def of PARTS) {
  const problems = [...check(def, 0), ...check(def, 90).map((p) => `rot90 ${p}`)];
  const files = [def.ldraw.file, ...(def.ldraw.extra ?? []).map((e) => `+${e.file}`)].join(" ");
  if (problems.length) {
    failures++;
    console.log(`✗ ${def.id.padEnd(17)} ${files.padEnd(22)} ${lib.title(def.ldraw.file)}`);
    for (const p of [...new Set(problems)]) console.log(`    ${p}`);
  } else {
    console.log(`✓ ${def.id.padEnd(17)} ${files.padEnd(22)} ${lib.title(def.ldraw.file)}`);
  }
}
console.log(failures ? `\n${failures} part(s) need fixing` : `\nAll ${PARTS.length} parts match LDraw.`);
process.exit(failures ? 1 : 0);
