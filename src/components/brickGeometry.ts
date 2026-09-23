import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { getPart, localStuds, type PartDef } from "@/lib/parts/library";

/** Viewer units: 1 stud pitch = 1, 1 plate = 0.4 (real proportions: 8 mm / 3.2 mm). */
export const PLATE_H = 0.4;
const GAP = 0.02; // visual seam between neighbouring parts
const STUD_R = 0.3;
const STUD_H = 0.18;
const SLOPE_LIP = 0.2;

const bodyCache = new Map<string, THREE.BufferGeometry>();
const fullCache = new Map<string, THREE.BufferGeometry>();
const edgeCache = new Map<string, THREE.EdgesGeometry>();

/** Body only (no studs), in local part space: x 0..w, y 0..h, z 0..d, then centred on x/z. */
function bodyGeometry(def: PartDef): THREE.BufferGeometry {
  const cached = bodyCache.get(def.id);
  if (cached) return cached;
  const h = def.h * PLATE_H;
  let g: THREE.BufferGeometry;
  if (def.category === "slope") {
    // Profile in (z, y): full height over the stud row (z 0..1), 45° face down to a low lip at the front.
    const shape = new THREE.Shape();
    const pts: [number, number][] = [
      [GAP, 0],
      [def.d - GAP, 0],
      [def.d - GAP, SLOPE_LIP],
      [1, h - GAP],
      [GAP, h - GAP],
    ];
    // Shape u = -z so that rotateY(+90°) maps (u, v, extrude) → (x = extrude, y = v, z = -u = z).
    shape.moveTo(-pts[0][0], pts[0][1]);
    for (const [z, y] of pts.slice(1)) shape.lineTo(-z, y);
    shape.closePath();
    g = new THREE.ExtrudeGeometry(shape, { depth: def.w - 2 * GAP, bevelEnabled: false });
    g.rotateY(Math.PI / 2);
    g.translate(GAP, 0, 0);
  } else {
    g = new THREE.BoxGeometry(def.w - 2 * GAP, h - GAP, def.d - 2 * GAP);
    g.translate(def.w / 2, (h - GAP) / 2, def.d / 2);
  }
  g.translate(-def.w / 2, 0, -def.d / 2);
  if (g.index) g = g.toNonIndexed();
  g.computeVertexNormals();
  bodyCache.set(def.id, g);
  return g;
}

/** Body plus studs, centred on the footprint (x/z) with y = 0 at the bottom. */
export function partGeometry(partId: string): THREE.BufferGeometry | null {
  const cached = fullCache.get(partId);
  if (cached) return cached;
  const def = getPart(partId);
  if (!def) return null;
  const pieces: THREE.BufferGeometry[] = [bodyGeometry(def).clone()];
  const top = def.h * PLATE_H - GAP;
  for (const [cx, cz] of localStuds(def)) {
    const s = new THREE.CylinderGeometry(STUD_R, STUD_R, STUD_H, 16).toNonIndexed();
    s.translate(cx + 0.5 - def.w / 2, top + STUD_H / 2, cz + 0.5 - def.d / 2);
    pieces.push(s);
  }
  for (const p of pieces) {
    p.deleteAttribute("uv");
    if (!p.getAttribute("normal")) p.computeVertexNormals();
  }
  const g = mergeGeometries(pieces, false)!;
  fullCache.set(partId, g);
  return g;
}

/** Outline edges of the body (studs excluded to keep the look clean). */
export function partEdges(partId: string): THREE.EdgesGeometry | null {
  const cached = edgeCache.get(partId);
  if (cached) return cached;
  const def = getPart(partId);
  if (!def) return null;
  const e = new THREE.EdgesGeometry(bodyGeometry(def), 30);
  edgeCache.set(partId, e);
  return e;
}
