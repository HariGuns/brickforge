/**
 * Catalog part meshes (public/parts/<id>.bin, written by scripts/build-catalog.ts):
 *   "BFM2", u32 vertex count, u32 index count, u32 group count,
 *   groups: i32 LDraw colour (16 = the part's own colour), u32 first index, u32 index count,
 *   int16 x/y/z per vertex in ¼ LDU (local frame: x/z from the footprint's min corner,
 *   y up from its bottom), padding to 4 bytes, then u16 indices (u32 above 65535 vertices).
 * Fixed-colour groups are e.g. black tyres on a wheel or clear glass in a window.
 * Shared by the browser viewer and the server-side renderer.
 */
export interface PartMesh {
  /** Vertex positions in LDU, local frame (x right, y up, z front). */
  positions: Float32Array;
  indices: Uint16Array | Uint32Array;
  /** Index ranges by LDraw colour code (16 = the part's colour). */
  groups: { color: number; start: number; count: number }[];
}

export function parseMesh(buf: ArrayBuffer): PartMesh {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== "BFM2") throw new Error("Not a BrickForge mesh");
  const nv = dv.getUint32(4, true), ni = dv.getUint32(8, true), ng = dv.getUint32(12, true);
  const groups = [...Array(ng).keys()].map((g) => ({ color: dv.getInt32(16 + g * 12, true), start: dv.getUint32(20 + g * 12, true), count: dv.getUint32(24 + g * 12, true) }));
  const head = 16 + ng * 12;
  const positions = new Float32Array(nv * 3);
  for (let i = 0; i < nv * 3; i++) positions[i] = dv.getInt16(head + i * 2, true) / 4;
  const off = head + nv * 6 + ((head + nv * 6) % 4);
  const indices = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  for (let i = 0; i < ni; i++) indices[i] = nv > 65535 ? dv.getUint32(off + i * 4, true) : dv.getUint16(off + i * 2, true);
  return { positions, indices, groups };
}
