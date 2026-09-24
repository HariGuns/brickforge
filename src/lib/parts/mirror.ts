import { rotateCell, rotatePoint } from "../model/geometry";
import type { Placement, Rot } from "../model/schema";
import { getPart, localBottom, localSolids, localStuds, PARTS, rotateDir, type Dir, type PartDef } from "./library";

/**
 * Mirror images of parts, for mirrored sub-build copies (left/right).
 *
 * Mirroring flips a part along its local x axis. For each part we find what
 * its mirror image *is*: its left/right counterpart (e.g. wedge right ↔ left)
 * or itself, at some rotation r. It's found by comparing connection data:
 * studs and anti-studs (with levels), filled space, pins and hubs of the
 * flipped part against the candidate at each rotation, so the swap map can't
 * drift from the geometry the validator uses.
 *
 * Flip and rotation commute with the angle negated (flipX ∘ R(θ) = R(−θ) ∘ flipX),
 * so a part at rot θ mirrors to its image at rot (r − θ).
 */

const ROTS: Rot[] = [0, 90, 180, 270];
const flipDir = (d: Dir): Dir => (d === "+x" ? "-x" : d === "-x" ? "+x" : d);

/** Connection + shape signature of a part in its footprint box, optionally flipped along x, then turned by rot. */
function signature(def: PartDef, flip: boolean, rot: Rot): string {
  const fx = (cx: number) => (flip ? def.w - 1 - cx : cx);
  const fpx = (x: number) => (flip ? def.w - x : x);
  const cell = (cx: number, cz: number) => rotateCell(fx(cx), cz, def, rot).join(",");
  const studs = localStuds(def).map(([x, z, l]) => `${cell(x, z)}@${l}`).sort();
  const bottom = localBottom(def).map(([x, z, l]) => `${cell(x, z)}@${l}`).sort();
  const vox: string[] = [];
  for (const [x0, z0, x1, z1, y0, y1] of localSolids(def)) for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) vox.push(`${cell(x, z)},${y}`);
  const pin = (p: { kind: string; at: [number, number, number]; dir: Dir }) => {
    const [px, pz] = rotatePoint(fpx(p.at[0]), p.at[2], def, rot);
    return `${p.kind}|${px.toFixed(3)},${p.at[1].toFixed(3)},${pz.toFixed(3)}|${rotateDir(flip ? flipDir(p.dir) : p.dir, rot)}`;
  };
  return JSON.stringify([studs, bottom, vox.sort(), (def.pins ?? []).map(pin).sort(), def.hub ? pin(def.hub) : null]);
}

const cache = new Map<string, { id: string; rot: Rot } | null>();

/** What a part becomes in a mirror: its counterpart (or itself) at rotation `rot`; null if it has no mirror image. */
export function mirrorOf(partId: string): { id: string; rot: Rot } | null {
  if (cache.has(partId)) return cache.get(partId)!;
  const def = getPart(partId);
  let found: { id: string; rot: Rot } | null = null;
  if (def) {
    const target = signature(def, true, 0);
    const candidates = [def.mirror ? getPart(def.mirror) : undefined, def].filter((c): c is PartDef => !!c);
    outer: for (const c of candidates)
      for (const r of ROTS) {
        const dims = r === 90 || r === 270 ? [c.d, c.w] : [c.w, c.d];
        if (dims[0] !== def.w || dims[1] !== def.d || c.h !== def.h) continue;
        if (signature(c, false, r) === target) {
          found = { id: c.id, rot: r };
          break outer;
        }
      }
  }
  cache.set(partId, found);
  return found;
}

/**
 * A placement mirrored along x inside a box [minX, minX + width): the part is
 * replaced by its mirror image and moved to the mirrored position. Null if the
 * part has no mirror image.
 */
export function mirrorPlacement(pl: Placement, minX: number, width: number): Placement | null {
  const m = mirrorOf(pl.part);
  const def = getPart(pl.part);
  if (!m || !def) return null;
  const sx = pl.rot === 90 || pl.rot === 270 ? def.d : def.w;
  return { ...pl, part: m.id, rot: ((m.rot - pl.rot + 360) % 360) as Rot, x: minX + (width - (pl.x - minX) - sx) };
}

/** Parts with no mirror image (they can't go in a mirrored copy). */
export const unmirrorable = () => PARTS.filter((p) => !mirrorOf(p.id)).map((p) => p.id);
