/**
 * LDCad shadow library reader: resolves a part's snap (connection) points the
 * way LDCad does, by walking the LDraw subfile tree and merging each file's
 * shadow meta commands (SNAP_CYL, SNAP_INCL, SNAP_CLEAR, SNAP_GEN…), with
 * transforms and grids applied. Coordinates are native LDraw (LDU, -Y up).
 *
 * Shadow library: https://github.com/RolandMelkert/LDCadShadowLibrary
 * (CC BY-SA 4.0), downloaded to ./ldraw-lib/shadow (see README).
 */
import fs from "node:fs";
import path from "node:path";
import type { Mat3 } from "../../src/lib/ldraw/export";
import type { V } from "./ldrawGeo";

export interface Snap {
  kind: "cyl" | "clp" | "fgr" | "gen";
  gender: "M" | "F";
  /** Cylinder sections, e.g. [["R", 6, 4]] = round, radius 6, length 4. */
  secs: [string, number, number][];
  caps: string;
  id?: string;
  group?: string;
  /** Position and orientation in the part's native frame. */
  pos: V;
  ori: Mat3;
  slide: boolean;
  /** File the snap came from (for debugging). */
  from: string;
}

const I3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const mul = (m: Mat3, v: V): V => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const mulM = (a: Mat3, b: Mat3): Mat3 => {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
};
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

interface Meta {
  cmd: string;
  args: Record<string, string>;
}

function parseMeta(line: string): Meta | null {
  const m = line.match(/^\s*0\s+!LDCAD\s+([A-Z_]+)\s*(.*)$/);
  if (!m) return null;
  const args: Record<string, string> = {};
  for (const a of m[2].matchAll(/\[(\w+)=([^\]]*)\]/g)) args[a[1].toLowerCase()] = a[2].trim();
  return { cmd: m[1], args };
}

const nums = (s: string | undefined, n: number, dflt: number[]): number[] => {
  if (!s) return dflt;
  const v = s.split(/\s+/).map(Number);
  return v.length >= n ? v.slice(0, n) : dflt;
};

/** Grid offsets in the snap's local X/Z plane: "C 2 C 2 20 20", "1 C 2 0 20", "3 2 20 20". */
function gridOffsets(spec: string | undefined): V[] {
  if (!spec) return [[0, 0, 0]];
  const t = spec.split(/\s+/);
  let i = 0;
  const cx = t[i] === "C" ? (i++, true) : false;
  const nx = Number(t[i++]);
  const cz = t[i] === "C" ? (i++, true) : false;
  const nz = Number(t[i++]);
  const sx = Number(t[i++]);
  const sz = Number(t[i++]);
  const out: V[] = [];
  for (let a = 0; a < nx; a++)
    for (let b = 0; b < nz; b++) out.push([(cx ? a - (nx - 1) / 2 : a) * sx, 0, (cz ? b - (nz - 1) / 2 : b) * sz]);
  return out;
}

function indexDir(root: string): Map<string, string> {
  const index = new Map<string, string>();
  for (const dir of ["parts", "parts/s", "p", "p/48", "p/8"]) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full)) {
      const rel = (dir === "parts/s" ? "s/" : dir === "p/48" ? "48/" : dir === "p/8" ? "8/" : "") + f;
      if (!index.has(rel.toLowerCase())) index.set(rel.toLowerCase(), path.join(full, f));
    }
  }
  return index;
}

export function openShadow(ldrawRoot = path.resolve("ldraw-lib/ldraw"), shadowRoot = path.resolve("ldraw-lib/shadow")) {
  const ldIndex = indexDir(ldrawRoot);
  const shIndex = indexDir(shadowRoot);
  const norm = (n: string) => n.toLowerCase().replace(/\\/g, "/");
  const read = (index: Map<string, string>, cache: Map<string, string[] | null>, name: string) => {
    const k = norm(name);
    if (cache.has(k)) return cache.get(k)!;
    const f = index.get(k);
    const lines = f ? fs.readFileSync(f, "utf8").split(/\r?\n/) : null;
    cache.set(k, lines);
    return lines;
  };
  const ldCache = new Map<string, string[] | null>();
  const shCache = new Map<string, string[] | null>();
  const snapCache = new Map<string, Snap[]>();
  const mirrorCache = new Map<string, Record<string, string>[]>();

  /** Snaps of a file in its own frame (memoised). */
  function fileSnaps(name: string, depth = 0): Snap[] {
    const k = norm(name);
    const hit = snapCache.get(k);
    if (hit) return hit;
    if (depth > 40) return [];
    const own: Snap[] = [];
    const metas = (read(shIndex, shCache, name) ?? []).map(parseMeta).filter((m): m is Meta => !!m);
    let clearAll = false;
    const clearIds = new Set<string>();
    for (const m of metas) {
      if (m.cmd === "SNAP_CLEAR") {
        if (m.args.id) clearIds.add(m.args.id);
        else clearAll = true;
      }
    }
    for (const m of metas) {
      const pos = nums(m.args.pos, 3, [0, 0, 0]) as V;
      const ori = nums(m.args.ori, 9, I3) as Mat3;
      if (m.cmd === "SNAP_INCL" && m.args.ref) {
        for (const o of gridOffsets(m.args.grid)) {
          const base = add(pos, mul(ori, o));
          for (const s of fileSnaps(m.args.ref, depth + 1)) own.push({ ...s, pos: add(mul(ori, s.pos), base), ori: mulM(ori, s.ori) });
        }
        continue;
      }
      const kind = ({ SNAP_CYL: "cyl", SNAP_CLP: "clp", SNAP_FGR: "fgr", SNAP_GEN: "gen" } as Record<string, Snap["kind"]>)[m.cmd];
      if (!kind) continue;
      const secs: [string, number, number][] = [];
      const st = (m.args.secs ?? "").split(/\s+/).filter(Boolean);
      for (let i = 0; i + 2 < st.length; i += 3) secs.push([st[i], Number(st[i + 1]), Number(st[i + 2])]);
      if (kind === "clp" && m.args.radius) secs.push(["R", Number(m.args.radius), Number(m.args.length ?? 0)]);
      for (const o of gridOffsets(m.args.grid)) {
        own.push({
          kind,
          gender: (m.args.gender ?? "M").toUpperCase().startsWith("F") ? "F" : "M",
          secs,
          caps: m.args.caps ?? "",
          id: m.args.id,
          group: m.args.group,
          pos: add(pos, mul(ori, o)),
          ori,
          slide: m.args.slide === "true",
          from: name,
        });
      }
    }
    // Inherited from subfile references, unless cleared.
    const inherited: Snap[] = [];
    if (!clearAll) {
      for (const raw of read(ldIndex, ldCache, name) ?? []) {
        const tok = raw.trim().split(/\s+/);
        if (tok[0] !== "1" || tok.length < 15) continue;
        const n = tok.slice(2, 14).map(Number);
        const m: Mat3 = n.slice(3) as Mat3;
        const t: V = [n[0], n[1], n[2]];
        for (const s of fileSnaps(tok.slice(14).join(" "), depth + 1)) {
          if (s.id && clearIds.has(s.id)) continue;
          inherited.push({ ...s, pos: add(mul(m, s.pos), t), ori: mulM(m, s.ori) });
        }
      }
    }
    const all = [...own, ...inherited];
    snapCache.set(k, all);
    return all;
  }

  return {
    snaps: (file: string) => fileSnaps(file),
    /** MIRROR_INFO entries from the part's own shadow file (counterPart, baseFlip). */
    mirrorInfo(file: string): Record<string, string>[] {
      const k = norm(file);
      if (!mirrorCache.has(k)) mirrorCache.set(k, (read(shIndex, shCache, file) ?? []).map(parseMeta).filter((m): m is Meta => m?.cmd === "MIRROR_INFO").map((m) => m.args));
      return mirrorCache.get(k)!;
    },
    hasShadow: (file: string) => shIndex.has(norm(file)),
  };
}

/** World direction of a snap's axis (its local +Y). */
export const snapAxis = (s: Snap): V => [s.ori[1], s.ori[4], s.ori[7]];
