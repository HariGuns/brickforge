/**
 * Side-stud parts (carriers for sideways building): bricks with studs on
 * their sides, brackets, car bases with side studs. Runs only for parts the
 * normal classifier rejects, so upright parts are classified exactly as before.
 *
 * The grid box is set by the upright connectors (top studs and the anti-stud
 * plane underneath), so a bracket's box is its horizontal plate; body outside
 * that box (a bracket's flange) is recorded as extension boxes in LDU. Side
 * studs are recorded as exact points with an outward direction: along the
 * face they sit on stud centres, and their height is on a quarter-plate grid.
 */
import type { V } from "./ldrawGeo";
import { partMesh } from "./ldrawMesh";
import { snapAxis, type Snap } from "./snaps";
import { dirOf, inPin, voxelize, type Classified, type Connector, type Dir, type Result } from "./classify";

export interface SideStud {
  /** Base of the stud (where it leaves the face): x/z studs from the min corner, y plates up from the grid bottom. */
  at: [number, number, number];
  /** Direction the stud points (outward). */
  dir: Dir;
}

export interface SideClassified extends Classified {
  sideStuds: SideStud[];
  /** Body outside the grid box (e.g. a bracket's flange), as boxes in LDU: [x0, y0, z0, x1, y1, z1], local frame (x/z from the min corner, y up from the grid bottom). */
  fine: [number, number, number, number, number, number][];
}

const near = (a: number, b: number, e: number) => Math.abs(a - b) <= e;
const isInt = (a: number, e = 0.03) => near(a, Math.round(a), e);
const norm = (v: V): V => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const len = (s: Snap) => s.secs.reduce((n, q) => n + q[2], 0);

export function classifySideways(lib: { readLines: (n: string) => string[] | null }, snaps: Snap[], file: string, title: string): Result {
  const mesh = partMesh(lib, file, { skipPins: true, keepSideStuds: true });
  if (mesh.missing.size) return { ok: false, reason: "missing subfiles" };
  const cyl = snaps.filter((s) => s.kind === "cyl");
  const axis = (s: Snap) => norm(snapAxis(s));
  const r = (s: Snap) => s.secs[0]?.[1] ?? 0;
  const isStud = (s: Snap) => s.gender === "M" && near(r(s), 6, 0.01) && axis(s)[1] > 0.99;
  const isAnti = (s: Snap) => s.gender === "F" && near(r(s), 6, 0.01) && axis(s)[1] > 0.99;
  const isSide = (s: Snap) => s.gender === "M" && near(r(s), 6, 0.01) && Math.abs(axis(s)[1]) < 0.01 && len(s) <= 6;
  const side = uniqueSnaps(cyl.filter(isSide));
  if (!side.length) return { ok: false, reason: "no side studs" };
  for (const s of snaps) {
    if (s.kind !== "cyl") {
      if (s.gender === "M" && !(s.kind === "gen" && /^(rim|win|glass)/i.test(s.group ?? ""))) return { ok: false, reason: "unsupported connection", detail: s.kind };
      continue;
    }
    if (s.gender === "F" || isStud(s) || isSide(s)) continue;
    // Underside bars and internal rings connect nothing on the grid.
    if (near(r(s), 4, 0.01) && axis(s)[1] < -0.99 && len(s) <= 8) continue;
    return { ok: false, reason: "unsupported connection", detail: `M r${r(s)} ${Math.abs(axis(s)[1]) > 0.99 ? "vertical" : "sideways"}` };
  }
  const studs = uniqueSnaps(cyl.filter(isStud));
  // Anti-studs off the studs' grid (e.g. a centre tube) take no grid stud: leave them out.
  const phaseOf = (v: number) => ((((v - 10) % 20) + 20) % 20);
  const onPhase = (s: Snap) => !studs.length || [0, 2].every((k) => Math.min(Math.abs(phaseOf(s.pos[k]) - phaseOf(studs[0].pos[k])), 20 - Math.abs(phaseOf(s.pos[k]) - phaseOf(studs[0].pos[k]))) < 0.1);
  const anti = uniqueSnaps(cyl.filter(isAnti)).filter(onPhase);
  if (!anti.length) return { ok: false, reason: "incomplete connection data", detail: "no anti-studs" };

  // Grid box from the upright connectors.
  const bottom = Math.max(...anti.map((s) => s.pos[1]));
  const top = studs.length ? Math.min(...studs.map((s) => s.pos[1])) : mesh.min[1];
  const H = (bottom - top) / 8;
  if (!isInt(H, 0.05) || Math.round(H) < 1) return { ok: false, reason: "not on the grid", detail: `height ${H.toFixed(2)} plates between studs and anti-studs` };
  const h = Math.round(H);
  const grid = [...studs, ...anti];
  const phase = (v: number) => ((((v - 10) % 20) + 20) % 20);
  const fit = (k: 0 | 2): [number, number] | null => {
    const ps = grid.map((s) => s.pos[k]);
    if (ps.some((p) => Math.min(Math.abs(phase(p) - phase(ps[0])), 20 - Math.abs(phase(p) - phase(ps[0]))) > 0.1)) return null;
    let lo = Math.min(...ps) - 10, hi = Math.max(...ps) + 10;
    // The body's walls, if they're on the same grid and within a stud of the connectors (e.g. a 2-wide part with a 1-wide stud row).
    const bmin = mesh.min[k], bmax = mesh.max[k];
    if (bmin < lo - 1 && isInt((lo - bmin) / 20, 0.07) && lo - bmin <= 20.5) lo = lo - 20 * Math.round((lo - bmin) / 20);
    if (bmax > hi + 1 && isInt((bmax - hi) / 20, 0.07) && bmax - hi <= 20.5) hi = hi + 20 * Math.round((bmax - hi) / 20);
    return [lo, hi];
  };
  const fx = fit(0), fz = fit(2);
  if (!fx || !fz) return { ok: false, reason: "not on the grid", detail: "studs and anti-studs aren't on one grid" };
  const [minX, maxX] = fx, [minZ, maxZ] = fz;
  const w = Math.round((maxX - minX) / 20), d = Math.round((maxZ - minZ) / 20);
  const lx = (X: number) => (X - minX) / 20, lz = (Z: number) => (maxZ - Z) / 20, ly = (Y: number) => (bottom - Y) / 8;

  const cell = (s: Snap): Connector | null => {
    const cx = lx(s.pos[0]) - 0.5, cz = lz(s.pos[2]) - 0.5, lev = ly(s.pos[1]);
    return isInt(cx) && isInt(cz) && isInt(lev) ? { cell: [Math.round(cx), Math.round(cz)], level: Math.round(lev) } : null;
  };
  const upStuds = studs.map(cell), downAnti = anti.map(cell).filter((c): c is Connector => !!c);
  if (upStuds.some((c) => !c)) return { ok: false, reason: "off-grid stud" };

  // Side studs: on stud centres along the face, quarter-plate heights, at the face (not recessed).
  const sideStuds: SideStud[] = [];
  const cyls: { pos: V; out: V; len: number; r: number }[] = [];
  for (const s of side) {
    const out: V = axis(s).map((v) => -v) as V;
    const dir = dirOf(out);
    const at: [number, number, number] = [r3(lx(s.pos[0])), r3(ly(s.pos[1])), r3(lz(s.pos[2]))];
    const along = dir === "+x" || dir === "-x" ? at[2] : at[0];
    if (!isInt(along - 0.5)) return { ok: false, reason: "off-grid side stud", detail: `${dir} at ${at}` };
    if (!isInt(at[1] * 4)) return { ok: false, reason: "off-grid side stud", detail: `height ${at[1]} plates` };
    // The stud's base must be on or outside the part's face (a recessed stud, like a headlight brick's, isn't supported yet).
    const inside = dir === "+x" ? w - at[0] : dir === "-x" ? at[0] : dir === "+z" ? d - at[2] : at[2];
    if (inside > 0.03) return { ok: false, reason: "recessed side stud", detail: `${dir} ${(inside * 20).toFixed(1)} LDU inside` };
    sideStuds.push({ at, dir });
    cyls.push({ pos: s.pos, out, len: len(s) + 0.5, r: 6.5 });
  }

  // Coarse voxels inside the box; everything outside it (flanges) as extension boxes per region.
  const toLocal = (X: number, Y: number, Z: number): [number, number, number] => [lx(X), ly(Y), lz(Z)];
  const voxels = voxelize(mesh.tris, w, d, h, toLocal, cyls);
  const groups = new Map<string, number[]>();
  const t = mesh.tris;
  const E = 0.75; // LDU tolerance for faces on the box boundary
  for (let i = 0; i < t.length; i += 9) {
    const a: V = [t[i], t[i + 1], t[i + 2]], b: V = [t[i + 3], t[i + 4], t[i + 5]], c: V = [t[i + 6], t[i + 7], t[i + 8]];
    if ([a, b, c].every((v) => inPin(v, cyls))) continue;
    const n = Math.max(1, Math.ceil(Math.max(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2])) / 2));
    for (let u = 0; u <= n; u++)
      for (let v = 0; v <= n - u; v++) {
        const s1 = u / n, s2 = v / n, q = 1 - s1 - s2;
        const P: V = [a[0] * q + b[0] * s1 + c[0] * s2, a[1] * q + b[1] * s1 + c[1] * s2, a[2] * q + b[2] * s1 + c[2] * s2];
        if (inPin(P, cyls)) continue;
        const X = P[0] - minX, Y = bottom - P[1], Z = maxZ - P[2];
        const kx = X < -E ? "-" : X > w * 20 + E ? "+" : "0", ky = Y < -E ? "-" : Y > h * 8 + E ? "+" : "0", kz = Z < -E ? "-" : Z > d * 20 + E ? "+" : "0";
        if (kx + ky + kz === "000") continue;
        const k = kx + ky + kz;
        const g = groups.get(k) ?? groups.set(k, [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]).get(k)!;
        (g[0] = Math.min(g[0], X)), (g[1] = Math.min(g[1], Y)), (g[2] = Math.min(g[2], Z)), (g[3] = Math.max(g[3], X)), (g[4] = Math.max(g[4], Y)), (g[5] = Math.max(g[5], Z));
      }
  }
  const half = (n: number) => Math.round(n * 2) / 2;
  const fine = mergeBoxes([...groups.values()].map((g) => g.map(half) as Box6));

  const part: SideClassified = {
    file,
    title,
    w,
    d,
    h,
    studs: upStuds as Connector[],
    bottom: downAnti,
    pins: [],
    hubs: [],
    voxels,
    origin: [r3((minX + maxX) / 2), r3(top), r3((minZ + maxZ) / 2)],
    min: [minX, top, minZ],
    max: [maxX, bottom, maxZ],
    overhang: 0,
    inferred: false,
    mesh,
    ignored: [],
    sideStuds,
    fine,
  };
  return { ok: true, part };
}

type Box6 = [number, number, number, number, number, number];
const vol = (b: Box6) => Math.max(0, b[3] - b[0]) * Math.max(0, b[4] - b[1]) * Math.max(0, b[5] - b[2]);

/** Merge boxes that touch (within 1.5 LDU) when their joint box adds little empty space. */
function mergeBoxes(boxes: Box6[]): Box6[] {
  const out = [...boxes];
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i], b = out[j];
        const touch = [0, 1, 2].every((k) => a[k] <= b[k + 3] + 1.5 && b[k] <= a[k + 3] + 1.5);
        if (!touch) continue;
        const u: Box6 = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4]), Math.max(a[5], b[5])];
        if (vol(u) <= (vol(a) + vol(b)) * 1.25 + 1) {
          out.splice(j, 1);
          out[i] = u;
          merged = true;
          break outer;
        }
      }
  }
  return out;
}

/** Snaps can be listed twice (a part and its subpart); keep one per position and axis. */
function uniqueSnaps(ss: Snap[]): Snap[] {
  const seen = new Map<string, Snap>();
  for (const s of ss) seen.set(`${s.pos.map((v) => v.toFixed(1))}|${snapAxis(s).map((v) => Math.round(v))}`, s);
  return [...seen.values()];
}
