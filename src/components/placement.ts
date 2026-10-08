import * as THREE from "three";
import { footprint } from "@/lib/model/geometry";
import type { Placement } from "@/lib/model/schema";
import { depthBelow, type PartDef } from "@/lib/parts/library";
import { worldBoxes } from "@/lib/sideways/frame";
import { PLATE_H } from "./brickGeometry";

/**
 * Where a part's geometry (centred on its footprint, bottom at y = 0, in viewer
 * units: 1 stud = 1, 1 plate = PLATE_H = 8/20) goes. Upright parts: as always.
 * Sideways parts: their exact frame (LDU; 1 viewer unit = 20 LDU on every axis).
 */
export function placementMatrix(pl: Placement, def: PartDef): THREE.Matrix4 {
  if (!pl.frame) {
    const fp = footprint(pl, def);
    return new THREE.Matrix4().compose(new THREE.Vector3(fp.x0 + fp.sx / 2, fp.y0 * PLATE_H, fp.z0 + fp.sz / 2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (-pl.rot * Math.PI) / 180), new THREE.Vector3(1, 1, 1));
  }
  const m = pl.frame.m, t = pl.frame.t;
  const cx = def.w / 2, cz = def.d / 2;
  // world = R · (g + (w/2, 0, d/2)) + t / 20
  return new THREE.Matrix4().set(
    m[0], m[1], m[2], m[0] * cx + m[2] * cz + t[0] / 20,
    m[3], m[4], m[5], m[3] * cx + m[5] * cz + t[1] / 20,
    m[6], m[7], m[8], m[6] * cx + m[8] * cz + t[2] / 20,
    0, 0, 0, 1,
  );
}

/** A placed part's bounds in viewer units. */
export function placementBox(pl: Placement, def: PartDef): THREE.Box3 {
  if (!pl.frame) {
    const fp = footprint(pl, def);
    return new THREE.Box3(new THREE.Vector3(fp.x0, (fp.y0 - depthBelow(def)) * PLATE_H, fp.z0), new THREE.Vector3(fp.x0 + fp.sx, fp.y1 * PLATE_H, fp.z0 + fp.sz));
  }
  const b = new THREE.Box3();
  for (const [x0, y0, z0, x1, y1, z1] of worldBoxes(pl, def)) b.union(new THREE.Box3(new THREE.Vector3(x0 / 20, y0 / 20, z0 / 20), new THREE.Vector3(x1 / 20, y1 / 20, z1 / 20)));
  return b;
}
