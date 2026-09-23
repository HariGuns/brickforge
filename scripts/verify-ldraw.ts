/**
 * Verifies the part library against the official LDraw library in ./ldraw-lib/ldraw.
 * For every part it places the LDraw geometry exactly as the exporter would
 * (rot 0 and rot 90 at the origin) and checks that:
 *   - the body's bounding box matches our footprint and height
 *   - the top studs are exactly where our stud mask says
 *   - the file is not a "~Moved to" redirect
 *
 * Usage: npm run verify-ldraw   (download: see README)
 */
import fs from "node:fs";
import path from "node:path";
import { PARTS, type PartDef } from "../src/lib/parts/library";
import { footprint, worldStuds } from "../src/lib/model/geometry";
import { ldrawTransform, LDU_PLATE, LDU_STUD, type Mat3 } from "../src/lib/ldraw/export";
import type { Rot } from "../src/lib/model/schema";

const ROOT = path.resolve(process.argv[2] ?? "ldraw-lib/ldraw");
const index = new Map<string, string>();
for (const dir of ["parts", "parts/s", "p", "p/48"]) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) continue;
  for (const f of fs.readdirSync(full)) {
    const rel = (dir.startsWith("parts/s") ? "s/" : dir === "p/48" ? "48/" : "") + f;
    const k = rel.toLowerCase();
    if (!index.has(k)) index.set(k, path.join(full, f));
  }
}
if (index.size === 0) {
  console.error(`No LDraw library at ${ROOT}`);
  process.exit(2);
}

type V = [number, number, number];
const mul = (m: Mat3, v: V): V => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
const mulM = (a: Mat3, b: Mat3): Mat3 => {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
};
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

const cache = new Map<string, string[]>();
function readLines(name: string): string[] | null {
  const k = name.toLowerCase().replace(/\\/g, "/");
  if (cache.has(k)) return cache.get(k)!;
  const file = index.get(k);
  if (!file) return null;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  cache.set(k, lines);
  return lines;
}

const TOP_STUD = /^stud(2a?|10|13|15|17a?|18a|\b)?\.dat$/; // single top-stud primitives (not stud3/stud4 underside tubes)

interface Geo {
  min: V;
  max: V;
  studs: V[];
  missing: Set<string>;
}

function walk(name: string, m: Mat3, t: V, g: Geo, depth = 0) {
  const lines = readLines(name);
  if (!lines) return void g.missing.add(name);
  for (const raw of lines) {
    const tok = raw.trim().split(/\s+/);
    if (tok[0] === "1" && tok.length >= 15) {
      const sub = tok.slice(14).join(" ");
      const n = tok.slice(2, 14).map(Number);
      const st: V = [n[0], n[1], n[2]];
      const sm = n.slice(3) as Mat3;
      const pos = add(mul(m, st), t);
      const base = sub.toLowerCase().replace(/\\/g, "/");
      if (TOP_STUD.test(base)) {
        g.studs.push(pos);
        continue; // don't let studs affect the body bbox
      }
      walk(sub, mulM(m, sm), pos, g, depth + 1);
    } else if (tok[0] === "3" || tok[0] === "4") {
      const n = tok.slice(2).map(Number);
      for (let i = 0; i + 2 < n.length; i += 3) {
        const p = add(mul(m, [n[i], n[i + 1], n[i + 2]]), t);
        for (let a = 0; a < 3; a++) {
          g.min[a] = Math.min(g.min[a], p[a]);
          g.max[a] = Math.max(g.max[a], p[a]);
        }
      }
    }
  }
}

function check(def: PartDef, rot: Rot): string[] {
  const problems: string[] = [];
  const first = readLines(def.ldraw.file)?.[0] ?? "";
  if (/~Moved to/i.test(first)) problems.push(`${def.ldraw.file} is a redirect: "${first.replace(/^0\s*/, "")}"`);
  const pl = { part: def.id, color: "red", x: 0, y: 0, z: 0, rot };
  const { pos, m } = ldrawTransform(pl, def);
  const g: Geo = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], studs: [], missing: new Set() };
  walk(def.ldraw.file, m, pos, g);
  if (g.missing.size) problems.push(`missing subfiles: ${[...g.missing].join(", ")}`);

  const fp = footprint(pl, def);
  // Expected body box in LDraw space (X = x, Y = -y, Z = -z).
  const exp = { minX: 0, maxX: fp.sx * LDU_STUD, minY: -fp.y1 * LDU_PLATE, maxY: -fp.y0 * LDU_PLATE, minZ: -fp.sz * LDU_STUD, maxZ: 0 };
  const near = (a: number, b: number) => Math.abs(a - b) < 1.01; // allow ~1 LDU for chamfers/offsets
  const got = { minX: g.min[0], maxX: g.max[0], minY: g.min[1], maxY: g.max[1], minZ: g.min[2], maxZ: g.max[2] };
  for (const k of Object.keys(exp) as (keyof typeof exp)[]) {
    if (!near(exp[k], got[k])) problems.push(`bbox ${k}: expected ${exp[k]}, got ${Math.round(got[k] * 100) / 100}`);
  }

  const toCell = (v: V) => `${Math.floor(v[0] / LDU_STUD)},${Math.floor(-v[2] / LDU_STUD)}`;
  const gotStuds = g.studs.filter((s) => near(s[1], exp.minY)).map(toCell).sort();
  const expStuds = worldStuds(pl, def).map(([x, z]) => `${x},${z}`).sort();
  if (gotStuds.join(" ") !== expStuds.join(" ")) problems.push(`studs: expected [${expStuds.join(" ")}], got [${gotStuds.join(" ")}]`);
  return problems;
}

let failures = 0;
for (const def of PARTS) {
  const problems = [...check(def, 0), ...check(def, 90).map((p) => `rot90 ${p}`)];
  const head = readLines(def.ldraw.file)?.[0]?.replace(/^0\s*/, "") ?? "(not found)";
  if (problems.length) {
    failures++;
    console.log(`✗ ${def.id.padEnd(14)} ${def.ldraw.file.padEnd(10)} ${head}`);
    for (const p of [...new Set(problems)]) console.log(`    ${p}`);
  } else {
    console.log(`✓ ${def.id.padEnd(14)} ${def.ldraw.file.padEnd(10)} ${head}`);
  }
}
console.log(failures ? `\n${failures} part(s) need fixing` : `\nAll ${PARTS.length} parts match LDraw.`);
process.exit(failures ? 1 : 0);
