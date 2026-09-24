/**
 * LDraw mesh reader: flattens a part (and its subfiles) into triangles in the
 * part's native frame, skipping top-stud primitives (the app draws studs from
 * the connection data) and, optionally, wheel-pin primitives. Also returns the
 * body's bounding box.
 */
import type { Mat3 } from "../../src/lib/ldraw/export";
import type { V } from "./ldrawGeo";

type Lib = { readLines: (name: string) => string[] | null };

/** Top studs (solid and hollow). Underside tubes (stud3/stud4) are kept. */
const TOP_STUD = /^(?:48\/|8\/)?stud(2a?|10|13|15|17a?|18a|6a?|7a?|16|20|26|14)?\.dat$/;
/** Wheel pins stick out of wheel holders; they're connectors, not body. */
const PIN = /^wpin[0-9a-z]*\.dat$/;
/** Logos on studs etc. */
const SKIP = /^(logo|stug)[^/]*\.dat$/;

export interface Mesh {
  /** Flat triangle list, 9 floats per triangle. */
  tris: number[];
  /** LDraw colour code per triangle; 16 = the part's own colour (fixed codes: e.g. 256 rubber black tyres, 47 clear glass). */
  colors: number[];
  min: V;
  max: V;
  missing: Set<string>;
  /** True if a subfile flips handedness an odd number of times (for winding; unused, we render double-sided). */
}

const mul = (m: Mat3, v: V): V => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const mulM = (a: Mat3, b: Mat3): Mat3 => {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
};

export function partMesh(lib: Lib, file: string, opts: { skipPins?: boolean; keepSideStuds?: boolean } = {}): Mesh {
  const mesh: Mesh = { tris: [], colors: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], missing: new Set() };
  const grow = (p: V) => {
    for (let a = 0; a < 3; a++) {
      if (p[a] < mesh.min[a]) mesh.min[a] = p[a];
      if (p[a] > mesh.max[a]) mesh.max[a] = p[a];
    }
  };
  const eff = (code: string, inherited: number) => (code === "16" || code === "24" ? inherited : Number(code) || 16);
  const walk = (name: string, m: Mat3, t: V, depth: number, color: number) => {
    const lines = lib.readLines(name);
    if (!lines) return void mesh.missing.add(name);
    if (depth > 30) return;
    for (const raw of lines) {
      const tok = raw.trim().split(/\s+/);
      if (tok[0] === "1" && tok.length >= 15) {
        const sub = tok.slice(14).join(" ");
        const base = sub.toLowerCase().replace(/\\/g, "/");
        const n = tok.slice(2, 14).map(Number);
        // Studs pointing up are drawn from the connection data; side studs (sideways parts) stay in the mesh.
        const upright = () => Math.abs(mulM(m, n.slice(3) as Mat3)[4]) > 0.99;
        if ((TOP_STUD.test(base) && (!opts.keepSideStuds || upright())) || SKIP.test(base.split("/").pop()!) || (opts.skipPins && PIN.test(base.split("/").pop()!))) continue;
        const pos = mul(m, [n[0], n[1], n[2]]);
        walk(sub, mulM(m, n.slice(3) as Mat3), [pos[0] + t[0], pos[1] + t[1], pos[2] + t[2]], depth + 1, eff(tok[1], color));
      } else if (tok[0] === "3" || tok[0] === "4") {
        const n = tok.slice(2).map(Number);
        const pts: V[] = [];
        for (let i = 0; i + 2 < n.length && pts.length < (tok[0] === "3" ? 3 : 4); i += 3) {
          const p = mul(m, [n[i], n[i + 1], n[i + 2]]);
          pts.push([p[0] + t[0], p[1] + t[1], p[2] + t[2]]);
        }
        pts.forEach(grow);
        const c = eff(tok[1], color);
        mesh.tris.push(...pts[0], ...pts[1], ...pts[2]);
        mesh.colors.push(c);
        if (pts.length === 4) (mesh.tris.push(...pts[0], ...pts[2], ...pts[3]), mesh.colors.push(c));
      }
    }
  };
  walk(file, [1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0], 0, 16);
  return mesh;
}
