/**
 * Minimal LDraw geometry reader for checking the part library: follows subfile
 * references with their transforms, and collects the body's bounding box and
 * the positions of top-stud primitives. Shared by verify-ldraw and probe-ldraw.
 */
import fs from "node:fs";
import path from "node:path";
import type { Mat3 } from "../../src/lib/ldraw/export";

export type V = [number, number, number];

export interface Geo {
  min: V;
  max: V;
  studs: V[];
  missing: Set<string>;
}

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

/** Single top-stud primitives (solid and hollow), not underside tubes (stud3/stud4). */
const TOP_STUD = /^stud(2a?|10|13|15|17a?|18a)?\.dat$/;

export function openLibrary(root = path.resolve("ldraw-lib/ldraw")) {
  const index = new Map<string, string>();
  for (const dir of ["parts", "parts/s", "p", "p/48", "p/8"]) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full)) {
      const rel = (dir.startsWith("parts/s") ? "s/" : dir === "p/48" ? "48/" : dir === "p/8" ? "8/" : "") + f;
      const k = rel.toLowerCase();
      if (!index.has(k)) index.set(k, path.join(full, f));
    }
  }
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
  function walkInto(name: string, m: Mat3, t: V, g: Geo) {
    const lines = readLines(name);
    if (!lines) return void g.missing.add(name);
    for (const raw of lines) {
      const tok = raw.trim().split(/\s+/);
      if (tok[0] === "1" && tok.length >= 15) {
        const sub = tok.slice(14).join(" ");
        const n = tok.slice(2, 14).map(Number);
        const pos = add(mul(m, [n[0], n[1], n[2]]), t);
        const base = sub.toLowerCase().replace(/\\/g, "/");
        if (TOP_STUD.test(base)) {
          g.studs.push(pos);
          continue; // studs don't count toward the body's box
        }
        walkInto(sub, mulM(m, n.slice(3) as Mat3), pos, g);
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
  return {
    size: index.size,
    readLines,
    title: (name: string) => readLines(name)?.[0]?.replace(/^0\s*/, "") ?? "(not found)",
    walk(name: string, m: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1], t: V = [0, 0, 0]): Geo {
      const g: Geo = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], studs: [], missing: new Set() };
      walkInto(name, m, t, g);
      return g;
    },
  };
}
