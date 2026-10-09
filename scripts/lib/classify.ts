/**
 * Turns an LDraw part plus its LDCad snap data into a grid part definition:
 * footprint (studs), height (plates), studs and anti-studs (with their height
 * level), wheel pins / hubs, and the space it fills (1 stud × 1 stud × 1 plate
 * voxels). A part is accepted only if every connection it has is one the
 * validator understands and sits exactly on the grid; otherwise the reason is
 * returned.
 *
 * Snap conventions (LDCad): a cylinder snap sits at `pos` and extends along
 * its local -Y ("axis" below is its local +Y). Studs and anti-studs both have
 * axis +Y (down in LDraw); a mating pair shares position and axis.
 */
import type { V } from "./ldrawGeo";
import { partMesh, type Mesh } from "./ldrawMesh";
import { snapAxis, type Snap } from "./snaps";

export type PinKind = "wpin" | "tpin";
export type Dir = "+x" | "-x" | "+z" | "-z";

export interface Connector {
  /** Cell (x, z) and level (plates above the part's bottom). */
  cell: [number, number];
  level: number;
}

export interface PinDef {
  kind: PinKind;
  /** Point on the axis where the pin leaves the body / the hole opens, local units: x/z studs from the min corner, y plates from the bottom. */
  at: [number, number, number];
  /** Pins: the direction they point. Hubs: the direction the hole opens toward. */
  dir: Dir;
}

export interface Classified {
  file: string;
  title: string;
  w: number;
  d: number;
  h: number;
  studs: Connector[];
  bottom: Connector[];
  pins: PinDef[];
  hubs: PinDef[];
  /** Filled voxels, index x + w * (z + d * y). */
  voxels: boolean[];
  /** Native LDraw coords of the footprint's top centre (for export). */
  origin: V;
  /** Footprint box in native coords (pins excluded). */
  min: V;
  max: V;
  /** Anti-studs inferred from the underside geometry (no shadow data for them). */
  inferred: boolean;
  /** How far (LDU) the body sticks out of the footprint on its worst side (0 for most parts). */
  overhang: number;
  mesh: Mesh;
  ignored: string[];
}

export type Result = { ok: true; part: Classified } | { ok: false; reason: string; detail?: string };

const near = (a: number, b: number, eps = 0.35) => Math.abs(a - b) <= eps;
const isInt = (a: number, eps = 0.06) => near(a, Math.round(a), eps);
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const norm = (v: V): V => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const sig = (s: Snap) => `${s.kind}:${s.gender}:${s.secs.map((q) => `${q[0]}${q[1]}x${q[2]}`).join("|")}`;
const lengthOf = (s: Snap) => s.secs.reduce((n, q) => n + q[2], 0);

/** Pin kind of a horizontal male cylinder, or null. Wheel pins: radius 4, ~12 long. Large pins: radius-8 collar, ~20 long. */
function pinKind(s: Snap): PinKind | null {
  const r = s.secs[0]?.[1], len = lengthOf(s);
  if (near(r, 4, 0.01) && len >= 8 && len <= 13) return "wpin";
  if (near(r, 8, 0.01) && s.secs.some((q) => near(q[1], 6, 0.01)) && len >= 16 && len <= 22) return "tpin";
  return null;
}
/** Hub kind of a horizontal female cylinder (a rim's hole), or null. */
export function hubKind(s: Snap): PinKind | null {
  const r = s.secs[0]?.[1];
  if (near(r, 4, 0.01)) return "wpin";
  if (near(r, 8, 0.01) && s.secs.some((q) => near(q[1], 6, 0.01))) return "tpin";
  return null;
}

/** Most a body may stick out of its grid box per side, LDU (the hand-made flower part allows 2.5). */
export const OVERHANG = 2.5;

/** Studs and anti-studs: the snaps that fix where the grid is. */
const isGridSnap = (s: Snap) => s.kind === "cyl" && near(s.secs[0]?.[1] ?? 0, 6, 0.01) && Math.abs(norm(snapAxis(s))[1]) > 0.99;

/**
 * Grid box along one axis: the box whose cell centres line up with the part's
 * studs, nearest to the body's extent, if the body overhangs it by at most
 * OVERHANG or falls short of it by at most 1.4 LDU on each side. Without
 * studs, the body box itself must be a whole number of studs.
 */
function fitAxis(lo: number, hi: number, studPos: number[], strict = true): [number, number] | null {
  const n = (hi - lo) / 20;
  // No studs to line up with: the body box itself must be a whole number of studs.
  if (!studPos.length) return isInt(n, 0.07) ? [lo, lo + 20 * Math.round(n)] : null;
  const phaseOf = (p: number) => ((((p - 10) % 20) + 20) % 20);
  const dist = (a: number, b: number) => Math.min(Math.abs(a - b), 20 - Math.abs(a - b));
  // Grid lines sit at phase + 20k. Studs must all agree; anti-studs (strict = false) go by majority,
  // since some sit between cells (e.g. under 1-wide curved slopes).
  const phase = studPos.map(phaseOf).sort((a, b) => studPos.filter((p) => dist(phaseOf(p), b) < 0.1).length - studPos.filter((p) => dist(phaseOf(p), a) < 0.1).length)[0];
  if (strict && studPos.some((p) => dist(phaseOf(p), phase) > 0.1)) return null;
  const snapTo = (v: number) => phase + 20 * Math.round((v - phase) / 20);
  const a = snapTo(lo), b = snapTo(hi);
  if (b - a < 20 || a - lo > OVERHANG || hi - b > OVERHANG || lo - a > 1.4 || b - hi > 1.4) return null;
  return [a, b];
}

export { inPin };

/** Triangles entirely inside a pin's cylinder (it's a connector, not body). */
function inPin(p: V, pins: { pos: V; out: V; len: number; r: number }[]): boolean {
  for (const pin of pins) {
    const d: V = [p[0] - pin.pos[0], p[1] - pin.pos[1], p[2] - pin.pos[2]];
    const t = d[0] * pin.out[0] + d[1] * pin.out[1] + d[2] * pin.out[2];
    if (t < -0.5 || t > pin.len + 0.5) continue;
    const q: V = [d[0] - t * pin.out[0], d[1] - t * pin.out[1], d[2] - t * pin.out[2]];
    if (Math.hypot(...q) <= pin.r + 0.6) return true;
  }
  return false;
}

export function classify(lib: { readLines: (n: string) => string[] | null }, snaps: Snap[], file: string, title: string): Result {
  const mesh = partMesh(lib, file, { skipPins: true });
  if (mesh.missing.size) return { ok: false, reason: "missing subfiles", detail: [...mesh.missing].slice(0, 3).join(" ") };
  if (!mesh.tris.length) return { ok: false, reason: "no geometry" };

  // Pins first: their geometry isn't part of the body box.
  const pinSnaps: { s: Snap; kind: PinKind; pos: V; out: V; len: number; r: number }[] = [];
  for (const s of snaps) {
    if (s.kind !== "cyl" || s.gender !== "M") continue;
    const a = norm(snapAxis(s));
    if (Math.abs(a[1]) > 0.01) continue;
    const kind = pinKind(s);
    if (kind) pinSnaps.push({ s, kind, pos: s.pos, out: [-a[0], -a[1], -a[2]], len: lengthOf(s), r: Math.max(...s.secs.map((q) => q[1])) });
  }
  const min: V = [Infinity, Infinity, Infinity], max: V = [-Infinity, -Infinity, -Infinity];
  const t = mesh.tris;
  for (let i = 0; i < t.length; i += 9) {
    const vs: V[] = [[t[i], t[i + 1], t[i + 2]], [t[i + 3], t[i + 4], t[i + 5]], [t[i + 6], t[i + 7], t[i + 8]]];
    if (pinSnaps.length && vs.every((v) => inPin(v, pinSnaps))) continue;
    for (const v of vs) for (let a = 0; a < 3; a++) (v[a] < min[a] && (min[a] = v[a]), v[a] > max[a] && (max[a] = v[a]));
  }
  const [, minY] = min;
  const [, maxY] = max;
  const H = (maxY - minY) / 8;
  if (!isInt(H, 0.16)) return { ok: false, reason: "not on the grid", detail: `height ${H.toFixed(2)} plates` };
  // Footprint: the body box, or (for small overhangs such as rounded lips) the grid box the
  // part's own studs line up with, if the body sticks out of it by at most OVERHANG LDU per side.
  // Grid phase from the studs (anti-studs only if there are none); off-grid anti-studs don't count.
  const phaseSnaps = snaps.filter((s) => isGridSnap(s) && s.gender === "M").length ? snaps.filter((s) => isGridSnap(s) && s.gender === "M") : snaps.filter((s) => isGridSnap(s));
  const strict = phaseSnaps.some((s) => s.gender === "M");
  const fx = fitAxis(min[0], max[0], phaseSnaps.map((s) => s.pos[0]), strict);
  const fz = fitAxis(min[2], max[2], phaseSnaps.map((s) => s.pos[2]), strict);
  if (!fx || !fz) return { ok: false, reason: "not on the grid", detail: `${((max[0] - min[0]) / 20).toFixed(2)}×${((max[2] - min[2]) / 20).toFixed(2)} studs` };
  const [minX, maxX] = fx, [minZ, maxZ] = fz;
  const w = Math.round((maxX - minX) / 20), d = Math.round((maxZ - minZ) / 20), h = Math.round(H);
  if (!w || !d || !h) return { ok: false, reason: "not on the grid", detail: "zero size" };
  const overhang = Math.max(minX - min[0], max[0] - maxX, minZ - min[2], max[2] - maxZ, 0);

  // Native → local: x = (X - minX)/20, z = (maxZ - Z)/20, y = (maxY - Y)/8.
  const lx = (X: number) => (X - minX) / 20, lz = (Z: number) => (maxZ - Z) / 20, ly = (Y: number) => (maxY - Y) / 8;
  const studs = new Map<string, Connector>(), bottom = new Map<string, Connector>();
  const pins: PinDef[] = [], hubs: PinDef[] = [];
  const ignored = new Set<string>();

  for (const s of snaps) {
    const a = norm(snapAxis(s));
    const vertical = Math.abs(a[1]) > 0.99;
    const horizontal = Math.abs(a[1]) < 0.01;
    const r = s.secs[0]?.[1] ?? 0;
    const len = lengthOf(s);
    const [X, Y, Z] = s.pos;
    if (s.kind === "gen") {
      // Rim ↔ tyre and window ↔ glass pairings are part of an assembly, not a building connection.
      if (s.group && /^(rim|win|glass)/i.test(s.group)) ignored.add(`gen ${s.group}`);
      else if (s.gender === "M") return { ok: false, reason: "unsupported connection", detail: `gen ${s.group ?? "?"}` };
      else ignored.add(`gen F ${s.group ?? ""}`);
      continue;
    }
    if (s.kind === "clp" || s.kind === "fgr") return { ok: false, reason: "unsupported connection", detail: s.kind === "clp" ? "clip" : "hinge" };

    if (vertical && near(r, 6, 0.01)) {
      const cx = lx(X) - 0.5, cz = lz(Z) - 0.5, lev = ly(Y);
      const onGrid = isInt(cx, 0.03) && isInt(cz, 0.03) && isInt(lev, 0.03);
      if (s.gender === "M") {
        if (a[1] < 0) return { ok: false, reason: "unsupported connection", detail: "downward stud" };
        if (!onGrid) return { ok: false, reason: "off-grid stud", detail: `${cx.toFixed(2)},${cz.toFixed(2)} level ${lev.toFixed(2)}` };
        const c: Connector = { cell: [Math.round(cx), Math.round(cz)], level: Math.round(lev) };
        studs.set(`${c.cell}|${c.level}`, c);
      } else if (a[1] < 0) ignored.add("upside-down anti-stud");
      else if (!onGrid) ignored.add("off-grid anti-stud"); // e.g. under jumper plates; takes no grid stud, breaks nothing
      else {
        const c: Connector = { cell: [Math.round(cx), Math.round(cz)], level: Math.round(lev) };
        bottom.set(`${c.cell}|${c.level}`, c);
      }
      continue;
    }
    if (s.kind === "cyl" && s.gender === "M" && horizontal && pinKind(s)) {
      const out = dirOf([-a[0], -a[1], -a[2]]);
      pins.push({ kind: pinKind(s)!, at: [round3(lx(X)), round3(ly(Y)), round3(lz(Z))], dir: out });
      continue;
    }
    if (s.gender === "F") {
      if (horizontal && hubKind(s)) hubs.push({ kind: hubKind(s)!, at: [round3(lx(X)), round3(ly(Y)), round3(lz(Z))], dir: dirOf(a) });
      else ignored.add(vertical ? `hole r${r}` : horizontal ? `side hole r${r}` : `angled hole r${r}`);
      continue;
    }
    // Male connectors that stay inside the body (e.g. the ring under a round brick) connect nothing on the grid.
    if (vertical && a[1] > 0 && Y - len >= minY - 0.5 && Y <= maxY + 0.5) {
      ignored.add(`internal ${sig(s)}`);
      continue;
    }
    if (vertical && a[1] < 0 && near(r, 4, 0.01) && len <= 8) {
      ignored.add("underside bar"); // 1-wide parts' underside pin; clutches nothing on the grid
      continue;
    }
    return { ok: false, reason: "unsupported connection", detail: `${sig(s)} ${horizontal ? "sideways" : vertical ? "vertical" : "angled"}` };
  }

  const inside = (c: Connector, top: boolean) => c.cell[0] >= 0 && c.cell[1] >= 0 && c.cell[0] < w && c.cell[1] < d && (top ? c.level >= 1 && c.level <= h : c.level >= 0 && c.level < h);
  if ([...studs.values()].some((c) => !inside(c, true))) return { ok: false, reason: "off-grid stud", detail: "stud outside the footprint" };
  if ([...bottom.values()].some((c) => !inside(c, false))) return { ok: false, reason: "off-grid stud", detail: "anti-stud outside the footprint" };
  if (!studs.size && !bottom.size && !pins.length) return { ok: false, reason: "no connections" };
  const voxels = voxelize(mesh.tris, w, d, h, (X, Y, Z) => [(X - minX) / 20, (maxY - Y) / 8, (maxZ - Z) / 20], pinSnaps);
  // The shadow library has no anti-stud data for some parts. If the part's geometry has the
  // standard underside (tube / bar primitives), it takes a stud under every cell whose bottom
  // layer is filled; those anti-studs are marked as inferred.
  let inferred = false;
  if (!bottom.size && (studs.size || pins.length) && usesUndersideTubes(lib, file)) {
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) if (voxels[x + w * z]) bottom.set(`${x},${z}|0`, { cell: [x, z], level: 0 });
    inferred = bottom.size > 0;
  }
  // Complete data: something with studs or pins must also be attachable from below.
  if (!bottom.size && (studs.size || pins.length)) return { ok: false, reason: "incomplete connection data", detail: "no anti-studs" };

  return {
    ok: true,
    part: {
      file,
      title,
      w,
      d,
      h,
      studs: sortC([...studs.values()]),
      bottom: sortC([...bottom.values()]),
      pins: uniq(pins),
      hubs: uniq(hubs),
      voxels,
      inferred,
      // Bottom-aligned: connection levels are measured from the bottom, so a part a fraction of
      // an LDU off a whole number of plates keeps its anti-studs exactly on the grid.
      origin: [round3((minX + maxX) / 2), round3(maxY - 8 * h), round3((minZ + maxZ) / 2)],
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      overhang: round3(overhang),
      mesh,
      ignored: [...ignored],
    },
  };
}

/** Underside tubes and 1-wide bars: the geometry of a standard, stud-taking underside. */
const UNDERSIDE = /^(stud4[a-z]?|stud3[a-z]?|stud4f\d?[sn]?|stud4od?)\.dat$/;
function usesUndersideTubes(lib: { readLines: (n: string) => string[] | null }, file: string, seen = new Set<string>()): boolean {
  for (const l of lib.readLines(file) ?? []) {
    const t = l.trim().split(/\s+/);
    if (t[0] !== "1" || t.length < 15) continue;
    const sub = t.slice(14).join(" ").toLowerCase().replace(/\\/g, "/");
    if (UNDERSIDE.test(sub.split("/").pop()!)) return true;
    if (sub.startsWith("s/") && !seen.has(sub) && (seen.add(sub), usesUndersideTubes(lib, sub, seen))) return true;
  }
  return false;
}

/** Local direction from a native one (local x = native X, local z = native -Z). */
export function dirOf(a: V): Dir {
  const x = a[0], z = -a[2];
  return Math.abs(x) > Math.abs(z) ? (x > 0 ? "+x" : "-x") : z > 0 ? "+z" : "-z";
}

const sortC = (cs: Connector[]) => cs.sort((a, b) => a.level - b.level || a.cell[1] - b.cell[1] || a.cell[0] - b.cell[0]);
function uniq(ps: PinDef[]): PinDef[] {
  const seen = new Map<string, PinDef>();
  for (const p of ps) seen.set(`${p.kind}|${p.at.map((n) => n.toFixed(2))}|${p.dir}`, p);
  return [...seen.values()];
}

/**
 * Filled voxels: a voxel counts if the part's surface passes through it
 * (shrunk by 1.5 LDU so faces lying on a voxel boundary don't spill into the
 * neighbour), then each column is filled between its lowest and highest
 * marked voxel, since LDraw parts are hollow shells. Slightly conservative.
 */
export function voxelize(
  tris: number[],
  w: number,
  d: number,
  h: number,
  toLocal: (X: number, Y: number, Z: number) => [number, number, number],
  pins: { pos: V; out: V; len: number; r: number }[] = [],
): boolean[] {
  const vox = new Array(w * d * h).fill(false);
  const M = 1.5;
  const mark = (X: number, Y: number, Z: number) => {
    const [fx, fy, fz] = toLocal(X, Y, Z);
    const ix = Math.floor(fx), iz = Math.floor(fz), iy = Math.floor(fy);
    if (ix < 0 || iz < 0 || iy < 0 || ix >= w || iz >= d || iy >= h) return;
    const ox = (fx - ix) * 20, oz = (fz - iz) * 20, oy = (fy - iy) * 8;
    if (ox < M || ox > 20 - M || oz < M || oz > 20 - M || oy < M || oy > 8 - M) return;
    vox[ix + w * (iz + d * iy)] = true;
  };
  for (let i = 0; i < tris.length; i += 9) {
    const a: V = [tris[i], tris[i + 1], tris[i + 2]], b: V = [tris[i + 3], tris[i + 4], tris[i + 5]], c: V = [tris[i + 6], tris[i + 7], tris[i + 8]];
    if (pins.length && [a, b, c].every((v) => inPin(v, pins))) continue;
    const edge = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]), Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]));
    const n = Math.max(1, Math.ceil(edge / 1.5));
    for (let u = 0; u <= n; u++)
      for (let v = 0; v <= n - u; v++) {
        const s = u / n, r = v / n, q = 1 - s - r;
        mark(a[0] * q + b[0] * s + c[0] * r, a[1] * q + b[1] * s + c[1] * r, a[2] * q + b[2] * s + c[2] * r);
      }
  }
  for (let z = 0; z < d; z++)
    for (let x = 0; x < w; x++) {
      let lo = -1, hi = -1;
      for (let y = 0; y < h; y++) if (vox[x + w * (z + d * y)]) (lo < 0 && (lo = y), (hi = y));
      for (let y = lo; y >= 0 && y <= hi; y++) vox[x + w * (z + d * y)] = true;
    }
  return vox;
}
