"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { COLOR_MAP } from "@/lib/parts/colors";
import { getPart } from "@/lib/parts/library";
import { footprint } from "@/lib/model/geometry";
import type { BrickModel } from "@/lib/model/schema";
import { partEdges, partGeometry, PLATE_H } from "./brickGeometry";

export interface ViewerProps {
  model: BrickModel | null;
  /** Indices to draw; undefined = all. */
  visible?: Set<number>;
  /** Indices to highlight as the current step. */
  highlight?: Set<number>;
  /** Indices with validation errors (outlined in red). */
  errorParts?: Set<number>;
  /** Indices with warnings (outlined in amber). */
  warnParts?: Set<number>;
  /** Changes to this value re-fit the camera. */
  fitKey?: string;
  view?: CameraView;
  spin?: boolean;
  theme?: "light" | "dark";
}

export type CameraView = "3/4" | "front" | "top";

const materialCache = new Map<string, THREE.MeshStandardMaterial>();
function material(colorId: string, variant: "normal" | "highlight"): THREE.MeshStandardMaterial {
  const key = `${colorId}|${variant}`;
  let m = materialCache.get(key);
  if (!m) {
    const c = COLOR_MAP.get(colorId);
    m = new THREE.MeshStandardMaterial({
      color: c?.hex ?? "#ff00ff",
      roughness: 0.35,
      metalness: 0.0,
      transparent: !!c?.transparent,
      opacity: c?.transparent ? 0.55 : 1,
      // Highlight brightens the part in its own hue so colours stay recognizable.
      emissive: variant === "highlight" ? new THREE.Color(c?.hex ?? "#ff00ff") : new THREE.Color("#000000"),
      emissiveIntensity: variant === "highlight" ? 0.3 : 0,
    });
    materialCache.set(key, m);
  }
  return m;
}
const edgeMat = new THREE.LineBasicMaterial({ color: "#000000", transparent: true, opacity: 0.25 });
const highlightEdgeMat = new THREE.LineBasicMaterial({ color: "#ffb000" });
const errorEdgeMat = new THREE.LineBasicMaterial({ color: "#ff2d2d" });
const warnEdgeMat = new THREE.LineBasicMaterial({ color: "#f2a900" });

/** One instanced mesh for every copy of a part type in one colour and highlight state. */
function InstancedGroup({ geo, mat, matrices }: { geo: THREE.BufferGeometry; mat: THREE.Material; matrices: THREE.Matrix4[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.count = matrices.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [matrices]);
  return <instancedMesh ref={ref} args={[geo, mat, matrices.length]} castShadow receiveShadow frustumCulled={false} />;
}

/**
 * Instanced rendering: parts are grouped by (part, colour, highlighted) into
 * instanced meshes, and all outlines are merged into one line set per outline
 * style, so thousands of parts take a few dozen draw calls instead of two each.
 */
function Parts({ model, visible, highlight, errorParts, warnParts }: ViewerProps) {
  const scene = useMemo(() => {
    const groups = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material; matrices: THREE.Matrix4[] }>();
    const edgeVerts: Record<"normal" | "highlight" | "error" | "warn", number[]> = { normal: [], highlight: [], error: [], warn: [] };
    const v = new THREE.Vector3();
    model?.parts.forEach((pl, i) => {
      if (visible && !visible.has(i)) return;
      const def = getPart(pl.part);
      const geo = partGeometry(pl.part);
      const edges = partEdges(pl.part);
      if (!def || !geo || !edges) return;
      const fp = footprint(pl, def);
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(fp.x0 + fp.sx / 2, fp.y0 * PLATE_H, fp.z0 + fp.sz / 2),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (-pl.rot * Math.PI) / 180),
        new THREE.Vector3(1, 1, 1),
      );
      const hi = highlight?.has(i) ?? false;
      const key = `${pl.part}|${pl.color}|${hi}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { geo, mat: material(pl.color, hi ? "highlight" : "normal"), matrices: [] }));
      g.matrices.push(m);

      const err = errorParts?.has(i) ?? false;
      const style = err ? "error" : hi ? "highlight" : !err && warnParts?.has(i) ? "warn" : "normal";
      const pos = edges.getAttribute("position") as THREE.BufferAttribute;
      const out = edgeVerts[style];
      for (let k = 0; k < pos.count; k++) {
        v.fromBufferAttribute(pos, k).applyMatrix4(m);
        out.push(v.x, v.y, v.z);
      }
    });
    const lines = (Object.keys(edgeVerts) as (keyof typeof edgeVerts)[])
      .filter((k) => edgeVerts[k].length)
      .map((k) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(edgeVerts[k], 3));
        return { key: k, geo: g, mat: k === "error" ? errorEdgeMat : k === "highlight" ? highlightEdgeMat : k === "warn" ? warnEdgeMat : edgeMat };
      });
    return { groups: [...groups.entries()], lines };
  }, [model, visible, highlight, errorParts, warnParts]);

  // Merged outline geometries are rebuilt on every change; free the old ones.
  useEffect(() => () => scene.lines.forEach((l) => l.geo.dispose()), [scene]);

  if (!model) return null;
  return (
    <group>
      {scene.groups.map(([key, g]) => (
        <InstancedGroup key={`${key}|${g.matrices.length}`} geo={g.geo} mat={g.mat} matrices={g.matrices} />
      ))}
      {scene.lines.map((l) => (
        <lineSegments key={l.key} geometry={l.geo} material={l.mat} frustumCulled={false} />
      ))}
    </group>
  );
}

function bounds(model: BrickModel | null): THREE.Box3 {
  const box = new THREE.Box3();
  for (const pl of model?.parts ?? []) {
    const def = getPart(pl.part);
    if (!def) continue;
    const fp = footprint(pl, def);
    box.expandByPoint(new THREE.Vector3(fp.x0, fp.y0 * PLATE_H, fp.z0));
    box.expandByPoint(new THREE.Vector3(fp.x0 + fp.sx, fp.y1 * PLATE_H, fp.z0 + fp.sz));
  }
  if (box.isEmpty()) box.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(8, 2, 8));
  return box;
}

function CameraFit({ model, fitKey, view, controls }: { model: BrickModel | null; fitKey?: string; view: CameraView; controls: React.RefObject<OrbitControlsImpl | null> }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const box = bounds(model);
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    // Fit to the narrower field of view, so tall, narrow viewports (phones) don't crop the sides.
    const persp = camera as THREE.PerspectiveCamera;
    const vfov = ((persp.fov ?? 40) * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (persp.aspect || 1));
    const dist = Math.max((radius * 0.9) / Math.sin(Math.min(vfov, hfov) / 2), 6);
    const offset =
      view === "front" ? new THREE.Vector3(0, dist * 0.12, dist) : view === "top" ? new THREE.Vector3(0, dist, 0.001) : new THREE.Vector3(dist * 0.65, dist * 0.55, dist * 0.75);
    camera.position.copy(center).add(offset);
    camera.near = 0.05;
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    controls.current?.target.copy(center);
    controls.current?.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, view, size.width, size.height]);
  return null;
}

const SCENE = {
  light: { bg: "#f4f5f3", grid1: "#c9cec7", grid2: "#dfe2dd", shadow: 0.18 },
  dark: { bg: "#202321", grid1: "#3f4541", grid2: "#2d312e", shadow: 0.45 },
};

export default function Viewer(props: ViewerProps) {
  const controls = useRef<OrbitControlsImpl | null>(null);
  const scene = SCENE[props.theme ?? "light"];
  const box = useMemo(() => bounds(props.model), [props.model]);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const gridSize = Math.max(16, Math.ceil(Math.max(size.x, size.z) / 8) * 8 + 16);

  return (
    <Canvas
      shadows="percentage"
      camera={{ fov: 40, position: [20, 16, 24] }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      // Dev only: lets tests read draw-call / triangle counts (renderer.info).
      onCreated={({ gl }) => {
        if (process.env.NODE_ENV !== "production") (window as unknown as { __bfGl?: THREE.WebGLRenderer }).__bfGl = gl;
      }}
    >
      <color attach="background" args={[scene.bg]} />
      <hemisphereLight args={["#ffffff", "#8a8f99", 0.9]} />
      <directionalLight
        position={[center.x + 30, 60, center.z + 40]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-gridSize}
        shadow-camera-right={gridSize}
        shadow-camera-top={gridSize}
        shadow-camera-bottom={-gridSize}
      />
      <directionalLight position={[center.x - 30, 20, center.z - 20]} intensity={0.4} />
      <gridHelper key={props.theme} args={[gridSize, gridSize, scene.grid1, scene.grid2]} position={[Math.round(center.x), -0.001, Math.round(center.z)]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[center.x, -0.002, center.z]} receiveShadow>
        <planeGeometry args={[gridSize, gridSize]} />
        <shadowMaterial opacity={scene.shadow} />
      </mesh>
      <Parts {...props} />
      <OrbitControls ref={controls} makeDefault enableDamping autoRotate={!!props.spin} autoRotateSpeed={1.2} />
      <CameraFit model={props.model} fitKey={props.fitKey} view={props.view ?? "3/4"} controls={controls} />
    </Canvas>
  );
}
