import * as THREE from "three";
import { COLOR_MAP } from "@/lib/parts/colors";
import { depthBelow, getPart } from "@/lib/parts/library";
import { footprint } from "@/lib/model/geometry";
import type { BrickModel } from "@/lib/model/schema";
import type { BuildStep } from "@/lib/steps/steps";
import { loadPartMeshes, partEdges, partFixedPieces, partGeometry, PLATE_H } from "../brickGeometry";
import { placementBox, placementMatrix } from "../placement";

/**
 * Offscreen renderer for instruction pages. One shared WebGL context renders
 * step images and part icons to PNG blob URLs, cached per model object so paging
 * and PDF export reuse them. Renders run one at a time (the context is shared).
 */

export const STEP_SIZE = { w: 1200, h: 900 } as const;
export const THUMB_SIZE = { w: 240, h: 160 } as const;
/** Part icons use a fixed scale (CSS px per stud) so bigger parts look bigger; rendered at 2× density. */
export const ICON_PX_PER_UNIT = 17;
const ICON_DENSITY = 2;

/** Camera looks from front-right-above along the classic isometric diagonal. */
const ISO_DIR = new THREE.Vector3(1, 1, 1).normalize();
const NEW_EDGE = new THREE.LineBasicMaterial({ color: "#dd4b25" });
const OLD_EDGE = new THREE.LineBasicMaterial({ color: "#000000", transparent: true, opacity: 0.22 });
/** Parts from earlier steps are pushed slightly toward the page colour so new parts stand out. */
const FADE_TOWARD = new THREE.Color("#fdf7ea");
const FADE = 0.14;

let renderer: THREE.WebGLRenderer | null = null;
function getRenderer(): THREE.WebGLRenderer {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, canvas: document.createElement("canvas") });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  return renderer;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function material(colorId: string, faded: boolean): THREE.MeshStandardMaterial {
  const key = `${colorId}|${faded}`;
  let m = matCache.get(key);
  if (!m) {
    const c = COLOR_MAP.get(colorId);
    const color = new THREE.Color(c?.hex ?? "#ff00ff");
    if (faded) color.lerp(FADE_TOWARD, FADE);
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0, transparent: !!c?.transparent, opacity: c?.transparent ? 0.6 : 1, side: THREE.DoubleSide });
    matCache.set(key, m);
  }
  return m;
}

function lights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9a8f80, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(-0.6, 1.4, 1.0); // from front-left-above, so the right faces sit in shade like printed manuals
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(1, 0.3, -0.4);
  scene.add(fill);
}

/** Iso camera looking at `box`, plus the box's extents in view space. */
function isoView(box: THREE.Box3) {
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, radius * 10 + 10);
  cam.position.copy(center).addScaledVector(ISO_DIR, radius * 2 + 5);
  cam.up.set(0, 1, 0);
  cam.lookAt(center);
  cam.updateMatrixWorld();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const p = new THREE.Vector3(x, y, z).applyMatrix4(cam.matrixWorldInverse);
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  return { cam, x0, x1, y0, y1 };
}

function setFrustum(cam: THREE.OrthographicCamera, cx: number, cy: number, hw: number, hh: number) {
  cam.left = cx - hw; cam.right = cx + hw; cam.top = cy + hh; cam.bottom = cy - hh;
  cam.updateProjectionMatrix();
}

/** Orthographic iso camera framing `box` at the given aspect, with a margin. */
function isoCamera(box: THREE.Box3, aspect: number, margin = 1.08): THREE.OrthographicCamera {
  const { cam, x0, x1, y0, y1 } = isoView(box);
  let hw = ((x1 - x0) / 2) * margin, hh = ((y1 - y0) / 2) * margin;
  if (hw / hh < aspect) hw = hh * aspect;
  else hh = hw / aspect;
  setFrustum(cam, (x0 + x1) / 2, (y0 + y1) / 2, hw, hh);
  return cam;
}

async function snapshot(scene: THREE.Scene, cam: THREE.Camera, size: { w: number; h: number }): Promise<string> {
  const r = getRenderer();
  r.setPixelRatio(1);
  r.setSize(size.w, size.h, false);
  r.render(scene, cam);
  const canvas = r.domElement;
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!blob) throw new Error("Couldn't capture the render");
  const url = URL.createObjectURL(blob);
  // Decode now so showing a cached page later doesn't wait on image decoding.
  const img = new Image();
  img.src = url;
  await img.decode().catch(() => {});
  return url;
}

// ---- serialised queue (one shared context) ---------------------------------
// Page renders jump ahead of thumbnail renders so paging stays fast while the strip fills in.
type Task = () => Promise<void>;
const high: Task[] = [], low: Task[] = [];
let busy = false;
async function pump() {
  if (busy) return;
  busy = true;
  for (let t = high.shift() ?? low.shift(); t; t = high.shift() ?? low.shift()) await t();
  busy = false;
}
function enqueue<T>(fn: () => Promise<T>, priority: "high" | "low" = "high"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    (priority === "high" ? high : low).push(() => fn().then(resolve, reject));
    pump();
  });
}

// ---- per-model scene + cache ---------------------------------------------------
interface ModelScene {
  scene: THREE.Scene;
  groups: THREE.Group[];
  edges: THREE.LineSegments[];
  meshes: THREE.Mesh[];
  box: THREE.Box3;
  /** Per-part world bounds, for framing partial builds. */
  bounds: THREE.Box3[];
}
const scenes = new WeakMap<BrickModel, ModelScene>();

/** Per-model render caches (kept apart from the scene, which is only built once meshes have loaded). */
interface RenderCache {
  cache: Map<string, Promise<string>>;
  /** Finished renders, readable synchronously so cached pages show without a flash. */
  done: Map<string, string>;
}
const caches = new WeakMap<BrickModel, RenderCache>();
/** Renders are blob URLs, which stay in memory until revoked: free them once their model is gone. */
const release = new FinalizationRegistry<Map<string, string>>((done) => done.forEach((url) => URL.revokeObjectURL(url)));
function renderCache(model: BrickModel): RenderCache {
  let c = caches.get(model);
  if (!c) {
    caches.set(model, (c = { cache: new Map(), done: new Map() }));
    release.register(model, c.done);
  }
  return c;
}

/** The model's scene, built after its catalog parts' meshes have loaded. */
async function readyScene(model: BrickModel): Promise<ModelScene> {
  await loadPartMeshes(model.parts.map((p) => p.part));
  return modelScene(model);
}

function modelScene(model: BrickModel): ModelScene {
  let ms = scenes.get(model);
  if (ms) return ms;
  const scene = new THREE.Scene();
  lights(scene);
  const groups: THREE.Group[] = [], edges: THREE.LineSegments[] = [], meshes: THREE.Mesh[] = [];
  const box = new THREE.Box3();
  const bounds: THREE.Box3[] = [];
  model.parts.forEach((pl) => {
    const def = getPart(pl.part), geo = partGeometry(pl.part), eg = partEdges(pl.part);
    const g = new THREE.Group();
    if (def && geo && eg) {
      const fp = footprint(pl, def);
      if (pl.frame) {
        g.matrixAutoUpdate = false;
        g.matrix.copy(placementMatrix(pl, def));
      } else {
        g.position.set(fp.x0 + fp.sx / 2, fp.y0 * PLATE_H, fp.z0 + fp.sz / 2);
        g.rotation.y = (-pl.rot * Math.PI) / 180;
      }
      const mesh = new THREE.Mesh(geo, material(pl.color, false));
      const line = new THREE.LineSegments(eg, OLD_EDGE);
      g.add(mesh, line);
      for (const piece of partFixedPieces(pl.part)) g.add(new THREE.Mesh(piece.geo, material(piece.colorId, false)));
      meshes.push(mesh);
      edges.push(line);
      const b = pl.frame ? placementBox(pl, def) : new THREE.Box3(new THREE.Vector3(fp.x0, (fp.y0 - depthBelow(def)) * PLATE_H, fp.z0), new THREE.Vector3(fp.x0 + fp.sx, fp.y1 * PLATE_H + 0.2, fp.z0 + fp.sz));
      bounds.push(b);
      box.union(b);
    } else {
      meshes.push(new THREE.Mesh());
      edges.push(new THREE.LineSegments());
      bounds.push(new THREE.Box3());
    }
    groups.push(g);
    scene.add(g);
  });
  if (box.isEmpty()) box.set(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
  ms = { scene, groups, edges, meshes, box, bounds };
  scenes.set(model, ms);
  return ms;
}

const stepKey = (n: number, size: { w: number; h: number }) => `step|${n}|${size.w}x${size.h}`;

/** A finished render if it's already cached (synchronous), else undefined. */
export function peekStep(model: BrickModel, n: number, size: { w: number; h: number } = STEP_SIZE): string | undefined {
  return caches.get(model)?.done.get(stepKey(n, size));
}

/**
 * Framing for step n: the finished model's full footprint (so the base doesn't
 * rescale page to page), and the height built so far (so early steps aren't tiny).
 */
function stepBox(ms: ModelScene, visible: Set<number>): THREE.Box3 {
  let top = ms.box.min.y + 3 * PLATE_H;
  for (const i of visible) if (!ms.bounds[i].isEmpty()) top = Math.max(top, ms.bounds[i].max.y);
  return new THREE.Box3(ms.box.min.clone(), new THREE.Vector3(ms.box.max.x, Math.min(top, ms.box.max.y), ms.box.max.z));
}

/**
 * Render the model as it looks after step `n` (1-based): earlier parts slightly
 * faded, parts added in step n in full colour with orange outlines. The iso angle
 * is fixed; framing covers the full footprint and the height built so far.
 */
export function renderStep(model: BrickModel, steps: BuildStep[], n: number, size: { w: number; h: number } = STEP_SIZE, priority: "high" | "low" = "high"): Promise<string> {
  const rc = renderCache(model);
  const key = stepKey(n, size);
  let p = rc.cache.get(key);
  if (!p) {
    p = enqueue(async () => {
      const ms = await readyScene(model);
      const placed = new Set(steps.slice(0, n - 1).flatMap((s) => s.parts));
      const fresh = new Set(steps[n - 1]?.parts ?? []);
      const visible = new Set<number>();
      model.parts.forEach((pl, i) => {
        const isNew = fresh.has(i);
        ms.groups[i].visible = isNew || placed.has(i);
        if (ms.groups[i].visible) visible.add(i);
        ms.meshes[i].material = material(pl.color, !isNew);
        ms.edges[i].material = isNew ? NEW_EDGE : OLD_EDGE;
      });
      const url = await snapshot(ms.scene, isoCamera(stepBox(ms, visible), size.w / size.h), size);
      rc.done.set(key, url);
      return url;
    }, priority);
    rc.cache.set(key, p);
    p.catch(() => rc.cache.delete(key));
  }
  return p;
}

// ---- part icons -------------------------------------------------------------
export interface PartIcon {
  url: string;
  /** Natural display size in CSS px at the fixed icon scale. */
  w: number;
  h: number;
}
const iconCache = new Map<string, Promise<PartIcon>>();

/** Isometric icon of a single part in a colour, at a fixed scale (shared across models). */
export function renderPartIcon(partId: string, colorId: string): Promise<PartIcon> {
  const key = `${partId}|${colorId}`;
  let p = iconCache.get(key);
  if (!p) {
    p = enqueue(async () => {
      await loadPartMeshes([partId]);
      const def = getPart(partId), geo = partGeometry(partId), eg = partEdges(partId);
      const scene = new THREE.Scene();
      lights(scene);
      const box = new THREE.Box3();
      if (def && geo && eg) {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(geo, material(colorId, false)), new THREE.LineSegments(eg, OLD_EDGE));
        for (const piece of partFixedPieces(partId)) g.add(new THREE.Mesh(piece.geo, material(piece.colorId, false)));
        scene.add(g);
        box.set(new THREE.Vector3(-def.w / 2, -depthBelow(def) * PLATE_H, -def.d / 2), new THREE.Vector3(def.w / 2, def.h * PLATE_H + 0.2, def.d / 2));
      } else box.set(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
      const { cam, x0, x1, y0, y1 } = isoView(box);
      const pad = 0.12;
      const hw = (x1 - x0) / 2 + pad, hh = (y1 - y0) / 2 + pad;
      setFrustum(cam, (x0 + x1) / 2, (y0 + y1) / 2, hw, hh);
      const w = Math.round(hw * 2 * ICON_PX_PER_UNIT), h = Math.round(hh * 2 * ICON_PX_PER_UNIT);
      const url = await snapshot(scene, cam, { w: w * ICON_DENSITY, h: h * ICON_DENSITY });
      return { url, w, h };
    });
    iconCache.set(key, p);
    p.catch(() => iconCache.delete(key));
  }
  return p;
}

// ---- whole-model icons (sub-build copies in callouts) ---------------------------
export const MODEL_ICON_SIZE = { w: 240, h: 180 } as const;

/** The whole model in its own colours (nothing faded or outlined), for a sub-build's callout icon. */
export function renderModelIcon(model: BrickModel): Promise<string> {
  const rc = renderCache(model);
  const key = "icon";
  let p = rc.cache.get(key);
  if (!p) {
    p = enqueue(async () => {
      const ms = await readyScene(model);
      model.parts.forEach((pl, i) => {
        ms.groups[i].visible = true;
        ms.meshes[i].material = material(pl.color, false);
        ms.edges[i].material = OLD_EDGE;
      });
      const url = await snapshot(ms.scene, isoCamera(ms.box, MODEL_ICON_SIZE.w / MODEL_ICON_SIZE.h, 1.02), MODEL_ICON_SIZE);
      rc.done.set(key, url);
      return url;
    });
    rc.cache.set(key, p);
    p.catch(() => rc.cache.delete(key));
  }
  return p;
}
