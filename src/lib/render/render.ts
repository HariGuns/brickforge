/**
 * Server-side software renderer: draws a model to a PNG from a given camera
 * angle, with no GPU and no LeoCAD, so it works in the CLI, the server and the
 * AppImage. It uses the same part shapes as the 3D viewer (hand-made shapes
 * for core parts, LDraw meshes from public/parts for catalog parts), a z-buffer
 * rasteriser with flat shading, outlines where parts meet, and 2× supersampling.
 *
 * Camera: azimuth 0 looks at the model's front (it faces +z), 90 at its right
 * side (max x), ±180 at its back; elevation in degrees above horizontal.
 */
import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { loadPartMeshes, partFixedPieces, partGeometry, PLATE_H, setMeshReader } from "@/components/brickGeometry";
import { COLOR_MAP } from "../parts/colors";
import { getPart } from "../parts/library";
import { footprint } from "../model/geometry";
import type { BrickModel } from "../model/schema";
import { encodePng } from "./png";

export interface View {
  azimuth: number;
  elevation: number;
}

export interface RenderOptions {
  width?: number;
  height?: number;
  /** Vertical field of view, degrees (a typical photo is ~30–50°). */
  fov?: number;
  background?: [number, number, number];
}

let meshesFromDisk = false;
function useDiskMeshes() {
  if (meshesFromDisk) return;
  meshesFromDisk = true;
  const dir = path.resolve(process.cwd(), "public/parts");
  setMeshReader(async (id) => {
    const b = await fs.promises.readFile(path.join(dir, `${id}.bin`));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  });
}

interface Tri {
  /** World-space vertices, 9 numbers. */
  v: Float32Array;
  color: [number, number, number];
  alpha: number;
  part: number;
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Every triangle of the model in world space (viewer units: 1 stud across, PLATE_H per plate). */
async function modelTriangles(model: BrickModel): Promise<{ tris: Tri[]; box: THREE.Box3 }> {
  useDiskMeshes();
  await loadPartMeshes(model.parts.map((p) => p.part));
  const tris: Tri[] = [];
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  model.parts.forEach((pl, i) => {
    const def = getPart(pl.part);
    const geo = partGeometry(pl.part);
    if (!def || !geo) return;
    const fp = footprint(pl, def);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(fp.x0 + fp.sx / 2, fp.y0 * PLATE_H, fp.z0 + fp.sz / 2),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (-pl.rot * Math.PI) / 180),
      new THREE.Vector3(1, 1, 1),
    );
    const add = (g: THREE.BufferGeometry, colorId: string) => {
      const c = COLOR_MAP.get(colorId);
      const color = hexRgb(c?.hex ?? "#ff00ff");
      const alpha = c?.transparent ? 0.45 : 1;
      const pos = (g.index ? g.toNonIndexed() : g).getAttribute("position") as THREE.BufferAttribute;
      for (let k = 0; k + 2 < pos.count; k += 3) {
        const out = new Float32Array(9);
        for (let j = 0; j < 3; j++) {
          v.fromBufferAttribute(pos, k + j).applyMatrix4(m);
          out[j * 3] = v.x;
          out[j * 3 + 1] = v.y;
          out[j * 3 + 2] = v.z;
          box.expandByPoint(v);
        }
        tris.push({ v: out, color, alpha, part: i });
      }
    };
    add(geo, pl.color);
    for (const piece of partFixedPieces(pl.part)) add(piece.geo, piece.colorId);
  });
  return { tris, box };
}

/** Render the model to a PNG from `view`. */
export async function renderModel(model: BrickModel, view: View, opts: RenderOptions = {}): Promise<Buffer> {
  const W = opts.width ?? 768, H = opts.height ?? 512;
  const S = 2; // supersampling
  const w = W * S, h = H * S;
  const { tris, box } = await modelTriangles(model);
  const bg = opts.background ?? [236, 238, 234];

  // Camera on a sphere around the model's centre, fitted to its bounding sphere.
  const centre = box.getCenter(new THREE.Vector3());
  const radius = Math.max(0.5, box.getBoundingSphere(new THREE.Sphere()).radius);
  const fov = ((opts.fov ?? 32) * Math.PI) / 180;
  const aspect = W / H;
  const fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * aspect));
  const dist = (radius * 1.08) / Math.sin(fit / 2);
  const az = (view.azimuth * Math.PI) / 180, el = (view.elevation * Math.PI) / 180;
  const eye = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist).add(centre);
  const cam = new THREE.PerspectiveCamera((fov * 180) / Math.PI, aspect, dist * 0.05, dist * 4);
  cam.position.copy(eye);
  cam.lookAt(centre);
  cam.updateMatrixWorld();
  const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

  const depth = new Float32Array(w * h).fill(Infinity);
  const partBuf = new Int32Array(w * h).fill(-1);
  const rgb = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) (rgb[i * 3] = bg[0]), (rgb[i * 3 + 1] = bg[1]), (rgb[i * 3 + 2] = bg[2]);

  const light1 = new THREE.Vector3(0.45, 0.8, 0.55).normalize();
  const light2 = new THREE.Vector3(-0.6, 0.35, -0.4).normalize();
  const p = new THREE.Vector4();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), toEye = new THREE.Vector3();
  const sx = new Float32Array(3), sy = new Float32Array(3), sz = new Float32Array(3);

  // Opaque first, then transparent (blended, no depth write).
  const ordered = [...tris.filter((t) => t.alpha === 1), ...tris.filter((t) => t.alpha < 1)];
  for (const t of ordered) {
    let behind = false;
    for (let j = 0; j < 3; j++) {
      p.set(t.v[j * 3], t.v[j * 3 + 1], t.v[j * 3 + 2], 1).applyMatrix4(vp);
      if (p.w <= 0) behind = true;
      sx[j] = ((p.x / p.w + 1) / 2) * w;
      sy[j] = ((1 - p.y / p.w) / 2) * h;
      sz[j] = p.z / p.w;
    }
    if (behind) continue;
    // Flat shading, lit from two sides; double-sided (LDraw winding isn't consistent).
    a.set(t.v[0], t.v[1], t.v[2]);
    b.set(t.v[3], t.v[4], t.v[5]);
    c.set(t.v[6], t.v[7], t.v[8]);
    n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
    toEye.subVectors(eye, a).normalize();
    if (n.dot(toEye) < 0) n.negate();
    const shade = Math.min(1.15, 0.42 + 0.55 * Math.max(0, n.dot(light1)) + 0.22 * Math.max(0, n.dot(light2)) + 0.12 * Math.max(0, n.y));
    const cr = t.color[0] * shade, cg = t.color[1] * shade, cb = t.color[2] * shade;

    const minX = Math.max(0, Math.floor(Math.min(sx[0], sx[1], sx[2])));
    const maxX = Math.min(w - 1, Math.ceil(Math.max(sx[0], sx[1], sx[2])));
    const minY = Math.max(0, Math.floor(Math.min(sy[0], sy[1], sy[2])));
    const maxY = Math.min(h - 1, Math.ceil(Math.max(sy[0], sy[1], sy[2])));
    const area = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0]);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const w0 = ((sx[1] - px) * (sy[2] - py) - (sx[2] - px) * (sy[1] - py)) / area;
        const w1 = ((sx[2] - px) * (sy[0] - py) - (sx[0] - px) * (sy[2] - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const z = w0 * sz[0] + w1 * sz[1] + w2 * sz[2];
        const k = y * w + x;
        if (z >= depth[k]) continue;
        if (t.alpha === 1) {
          depth[k] = z;
          partBuf[k] = t.part;
          rgb[k * 3] = cr;
          rgb[k * 3 + 1] = cg;
          rgb[k * 3 + 2] = cb;
        } else {
          rgb[k * 3] = rgb[k * 3] * (1 - t.alpha) + cr * t.alpha;
          rgb[k * 3 + 1] = rgb[k * 3 + 1] * (1 - t.alpha) + cg * t.alpha;
          rgb[k * 3 + 2] = rgb[k * 3 + 2] * (1 - t.alpha) + cb * t.alpha;
        }
      }
    }
  }

  // Outlines: darken where neighbouring pixels belong to different parts (or part vs background).
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const k = y * w + x, me = partBuf[k];
      if (me < 0) continue;
      const edge = partBuf[k + 1] !== me || partBuf[k - 1] !== me || partBuf[k + w] !== me || partBuf[k - w] !== me;
      if (edge) for (let j = 0; j < 3; j++) rgb[k * 3 + j] *= 0.55;
    }

  // Downsample 2×2 → 1.
  const out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      for (let j = 0; j < 3; j++) {
        let s = 0;
        for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) s += rgb[((y * S + dy) * w + x * S + dx) * 3 + j];
        out[(y * W + x) * 3 + j] = Math.max(0, Math.min(255, Math.round(s / (S * S))));
      }
  return encodePng(W, H, out);
}
