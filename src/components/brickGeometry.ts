import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { getPart, localSolids, localStuds, type PartDef } from "@/lib/parts/library";

/** Viewer units: 1 stud pitch = 1, 1 plate = 0.4 (real proportions: 8 mm / 3.2 mm). */
export const PLATE_H = 0.4;
const GAP = 0.02; // visual seam between neighbouring parts
const STUD_R = 0.3;
const STUD_H = 0.18;
const SLOPE_LIP = 0.2;

const bodyCache = new Map<string, THREE.BufferGeometry>();
const fullCache = new Map<string, THREE.BufferGeometry>();
const edgeCache = new Map<string, THREE.EdgesGeometry>();

type G = THREE.BufferGeometry;

/** Box from local min to max corner (world units, footprint min corner at 0). */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): G {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

/** Profile in (z, y), extruded along x over the part's width. */
function extrudeProfile(def: PartDef, pts: [number, number][]): G {
  const shape = new THREE.Shape();
  // Shape u = -z so that rotateY(+90°) maps (u, v, extrude) → (x = extrude, y = v, z = -u = z).
  shape.moveTo(-pts[0][0], pts[0][1]);
  for (const [z, y] of pts.slice(1)) shape.lineTo(-z, y);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: def.w - 2 * GAP, bevelEnabled: false });
  g.rotateY(Math.PI / 2);
  g.translate(GAP, 0, 0);
  g.deleteAttribute("uv");
  const flat = g.index ? g.toNonIndexed() : g;
  flat.computeVertexNormals();
  return flat;
}

function cylinder(def: PartDef, rTop: number, rBottom: number, segments = 24, height = def.h * PLATE_H - GAP): G {
  const g = new THREE.CylinderGeometry(rTop, rBottom, height, segments);
  g.translate(def.w / 2, height / 2, def.d / 2);
  return g;
}

function merge(pieces: G[]): G {
  const flat = pieces.map((p) => {
    const q = p.index ? p.toNonIndexed() : p;
    if (q.getAttribute("uv")) q.deleteAttribute("uv");
    if (!q.getAttribute("normal")) q.computeVertexNormals();
    return q;
  });
  return flat.length === 1 ? flat[0] : mergeGeometries(flat, false)!;
}

/** Body only (no studs), in local part space: x 0..w, y 0..h, z 0..d, then centred on x/z. */
function bodyGeometry(def: PartDef): THREE.BufferGeometry {
  const cached = bodyCache.get(def.id);
  if (cached) return cached;
  const h = def.h * PLATE_H;
  const top = h - GAP;
  const { w, d } = def;
  let g: G;
  switch (def.shape ?? (def.category === "slope" ? "slope" : "box")) {
    case "slope":
      // Full height over the stud row (z 0..1), then the slope down to a low lip at the front.
      g = extrudeProfile(def, [[GAP, 0], [d - GAP, 0], [d - GAP, SLOPE_LIP], [1, top], [GAP, top]]);
      break;
    case "ridge":
      g = extrudeProfile(def, [[GAP, 0], [d - GAP, 0], [d - GAP, SLOPE_LIP], [d / 2, top], [GAP, SLOPE_LIP]]);
      break;
    case "round":
      g = merge([cylinder(def, Math.min(w, d) / 2 - GAP, Math.min(w, d) / 2 - GAP)]);
      break;
    case "cone":
      g = merge([cylinder(def, 0.3, Math.min(w, d) / 2 - GAP)]);
      break;
    case "flower":
      // Five-sided petal disk.
      g = merge([cylinder(def, 0.5, 0.5, 5)]);
      break;
    case "fence": {
      const z0 = d * 0.35, z1 = d * 0.65, bar = 0.12;
      const posts = [0, 1, 2, 3, 4].map((k) => {
        const x = GAP + (k * (w - 2 * GAP - bar)) / 4;
        return box(x, 0, z0, x + bar, top, z1);
      });
      g = merge([box(GAP, 0, z0 - 0.05, w - GAP, 0.16, z1 + 0.05), box(GAP, top - bar, z0, w - GAP, top, z1), box(GAP, top * 0.5, z0, w - GAP, top * 0.5 + bar * 0.7, z1), ...posts]);
      break;
    }
    case "window": {
      const z0 = d * 0.2, z1 = d * 0.8, t = 0.16;
      g = merge([box(GAP, 0, z0, t, top, z1), box(w - t, 0, z0, w - GAP, top, z1), box(GAP, 0, GAP, w - GAP, t, d - GAP), box(GAP, top - t, z0, w - GAP, top, z1), box(w / 2 - 0.04, t, 0.48, w / 2 + 0.04, top - t, 0.52)]);
      break;
    }
    case "door": {
      const t = 0.18;
      g = merge([
        box(GAP, 0, GAP, t, top, d - GAP),
        box(w - t, 0, GAP, w - GAP, top, d - GAP),
        box(GAP, top - 0.3, GAP, w - GAP, top, d - GAP),
        box(t + 0.03, 0.02, 0.38, w - t - 0.03, top - 0.32, 0.62),
        box(w - t - 0.45, top * 0.45, 0.3, w - t - 0.3, top * 0.45 + 0.12, 0.7),
      ]);
      break;
    }
    case "arch":
    case "box":
    default:
      g = merge(
        localSolids(def).map(([x0, z0, x1, z1, y0, y1]) =>
          box(x0 + GAP, y0 * PLATE_H, z0 + GAP, x1 - GAP, Math.min(y1 * PLATE_H, top), z1 - GAP),
        ),
      );
  }
  g.translate(-w / 2, 0, -d / 2);
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
    const s = new THREE.CylinderGeometry(STUD_R, STUD_R, STUD_H, 12).toNonIndexed();
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
