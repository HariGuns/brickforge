"use client";

import { useEffect, useMemo, useRef } from "react";
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
  /** Changes to this value re-fit the camera. */
  fitKey?: string;
}

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

function Parts({ model, visible, highlight, errorParts }: ViewerProps) {
  if (!model) return null;
  return (
    <group>
      {model.parts.map((pl, i) => {
        if (visible && !visible.has(i)) return null;
        const def = getPart(pl.part);
        const geo = partGeometry(pl.part);
        const edges = partEdges(pl.part);
        if (!def || !geo || !edges) return null;
        const fp = footprint(pl, def);
        const hi = highlight?.has(i) ?? false;
        const err = errorParts?.has(i) ?? false;
        return (
          <group key={i} position={[fp.x0 + fp.sx / 2, fp.y0 * PLATE_H, fp.z0 + fp.sz / 2]} rotation={[0, (-pl.rot * Math.PI) / 180, 0]}>
            <mesh geometry={geo} material={material(pl.color, hi ? "highlight" : "normal")} castShadow receiveShadow />
            <lineSegments geometry={edges} material={err ? errorEdgeMat : hi ? highlightEdgeMat : edgeMat} />
          </group>
        );
      })}
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

function CameraFit({ model, fitKey, controls }: { model: BrickModel | null; fitKey?: string; controls: React.RefObject<OrbitControlsImpl | null> }) {
  const { camera } = useThree();
  useEffect(() => {
    const box = bounds(model);
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    const dist = Math.max(radius * 2.6, 6);
    camera.position.set(center.x + dist * 0.65, center.y + dist * 0.55, center.z + dist * 0.75);
    camera.near = 0.05;
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    controls.current?.target.copy(center);
    controls.current?.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return null;
}

export default function Viewer(props: ViewerProps) {
  const controls = useRef<OrbitControlsImpl | null>(null);
  const box = useMemo(() => bounds(props.model), [props.model]);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const gridSize = Math.max(16, Math.ceil(Math.max(size.x, size.z) / 8) * 8 + 16);

  return (
    <Canvas shadows="percentage" camera={{ fov: 40, position: [20, 16, 24] }} gl={{ antialias: true, preserveDrawingBuffer: true }}>
      <color attach="background" args={["#eef1f5"]} />
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
      <gridHelper args={[gridSize, gridSize, "#b8c0cc", "#d5dae2"]} position={[Math.round(center.x), -0.001, Math.round(center.z)]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[center.x, -0.002, center.z]} receiveShadow>
        <planeGeometry args={[gridSize, gridSize]} />
        <shadowMaterial opacity={0.18} />
      </mesh>
      <Parts {...props} />
      <OrbitControls ref={controls} makeDefault enableDamping />
      <CameraFit model={props.model} fitKey={props.fitKey} controls={controls} />
    </Canvas>
  );
}
