/**
 * Exact 3D placement for sideways building. "G space" is the grid in LDU:
 * x = studs × 20, y = plates × 8 (up), z = studs × 20 (toward the front). A
 * frame maps a part's own G space (origin at its min corner and bottom, not
 * rotated) to the world: world = m · p + t (m row-major, a rotation).
 *
 * Upright parts don't carry a frame; uprightFrame() gives theirs, so both
 * kinds can be treated alike where needed. Only sideways parts get one.
 */
import type { Dir, PartDef } from "../parts/library";
import { localBottom, localSolids, localStuds } from "../parts/library";
import type { Placement, Rot } from "../model/schema";

export type M3 = [number, number, number, number, number, number, number, number, number];
export type V3 = [number, number, number];
export interface Frame {
  m: M3;
  t: V3;
}

export const I3: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const mulMV = (m: M3, v: V3): V3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
export const mulMM = (a: M3, b: M3): M3 => {
  const r = new Array(9).fill(0) as M3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r.map((v) => (Object.is(v, -0) ? 0 : Math.round(v * 1e9) / 1e9)) as M3;
};
export const transpose = (m: M3): M3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Apply a frame to a point. */
export const apply = (f: Frame, p: V3): V3 => add(mulMV(f.m, p), f.t);
/** outer ∘ inner: first inner, then outer. */
export const compose = (outer: Frame, inner: Frame): Frame => ({ m: mulMM(outer.m, inner.m), t: apply(outer, inner.t) });

/** An upright placement's frame (rotation about the vertical, then its grid position). */
export function uprightFrame(pl: Placement, def: Pick<PartDef, "w" | "d">): Frame {
  const W = def.w * 20, D = def.d * 20;
  const [m, off]: [M3, V3] =
    pl.rot === 90 ? [[0, 0, -1, 0, 1, 0, 1, 0, 0], [D, 0, 0]] : pl.rot === 180 ? [[-1, 0, 0, 0, 1, 0, 0, 0, -1], [W, 0, D]] : pl.rot === 270 ? [[0, 0, 1, 0, 1, 0, -1, 0, 0], [0, 0, W]] : [I3, [0, 0, 0]];
  return { m, t: add(off, [pl.x * 20, pl.y * 8, pl.z * 20]) };
}

export const frameOf = (pl: Placement, def: PartDef): Frame => pl.frame ?? uprightFrame(pl, def);

export const DIR_VEC: Record<Dir, V3> = { "+x": [1, 0, 0], "-x": [-1, 0, 0], "+z": [0, 0, 1], "-z": [0, 0, -1] };
/**
 * The frame of a copy mounted sideways: its top faces `n` (the side stud's
 * direction); seen from outside that face, its x runs left to right and its z
 * top to bottom; `spin` turns it within the face (like rot). Its anti-stud at
 * local point `a` (G space, on its bottom) lands on the stud base `s`.
 */
export function mountFrame(n: V3, spin: Rot, a: V3, s: V3): Frame {
  // local y → n, local z → down, local x = y × z (right-handed).
  const y = n, z: V3 = [0, -1, 0];
  const x: V3 = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]];
  const base: M3 = [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]]; // columns = images of local x, y, z
  const spinM: M3 = spin === 90 ? [0, 0, -1, 0, 1, 0, 1, 0, 0] : spin === 180 ? [-1, 0, 0, 0, 1, 0, 0, 0, -1] : spin === 270 ? [0, 0, 1, 0, 1, 0, -1, 0, 0] : I3;
  const m = mulMM(base, spinM);
  return { m, t: sub(s, mulMV(m, a)) };
}

export interface WorldConnector {
  /** World G space (LDU). */
  p: V3;
  /** Studs: the direction they point. Anti-studs: the direction their opening faces. */
  d: V3;
}

/** Studs (top and side) and anti-studs of a placed part, in world G space. */
export function worldConnectors(pl: Placement, def: PartDef): { studs: (WorldConnector & { side: boolean })[]; anti: WorldConnector[] } {
  const f = frameOf(pl, def);
  const studs = [
    ...localStuds(def).map(([cx, cz, l]) => ({ p: apply(f, [(cx + 0.5) * 20, l * 8, (cz + 0.5) * 20]), d: mulMV(f.m, [0, 1, 0]), side: false })),
    ...(def.sideStuds ?? []).map((s) => ({ p: apply(f, [s.at[0] * 20, s.at[1] * 8, s.at[2] * 20]), d: mulMV(f.m, DIR_VEC[s.dir]), side: true })),
  ];
  const anti = localBottom(def).map(([cx, cz, l]) => ({ p: apply(f, [(cx + 0.5) * 20, l * 8, (cz + 0.5) * 20]), d: mulMV(f.m, [0, -1, 0]) }));
  return { studs, anti };
}

export type Box = [number, number, number, number, number, number]; // x0 y0 z0 x1 y1 z1, world G space

/** Solid space of a placed part as world boxes (LDU): its cells, plus extension boxes (a bracket's flange). */
export function worldBoxes(pl: Placement, def: PartDef, opts: { fineOnly?: boolean } = {}): Box[] {
  const f = frameOf(pl, def);
  const local: Box[] = [...(opts.fineOnly ? [] : localSolids(def).map(([x0, z0, x1, z1, y0, y1]) => [x0 * 20, y0 * 8, z0 * 20, x1 * 20, y1 * 8, z1 * 20] as Box)), ...(def.fine ?? [])];
  return local.map((b) => {
    const a = apply(f, [b[0], b[1], b[2]]), c = apply(f, [b[3], b[4], b[5]]);
    return [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.min(a[2], c[2]), Math.max(a[0], c[0]), Math.max(a[1], c[1]), Math.max(a[2], c[2])];
  });
}

/** Grid cell / plate the frame's origin is in, for sorting and display of sideways parts. */
export function approxGrid(f: Frame): { x: number; y: number; z: number } {
  return { x: Math.floor(f.t[0] / 20 + 1e-6), y: Math.floor(f.t[1] / 8 + 1e-6), z: Math.floor(f.t[2] / 20 + 1e-6) };
}
