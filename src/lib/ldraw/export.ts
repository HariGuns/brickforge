import { COLOR_MAP } from "../parts/colors";
import { getPart, type PartDef } from "../parts/library";
import { mirrorPlacement } from "../parts/mirror";
import { footprint } from "../model/geometry";
import type { BrickModel, Placement } from "../model/schema";
import type { BuildStep } from "../steps/steps";
import type { BrickDesign, Instance } from "../design/schema";
import type { Box, CompileResult } from "../design/compile";

/**
 * LDraw units: 1 stud = 20 LDU, 1 plate = 8 LDU, -Y is up.
 * Grid → LDraw is a 180° turn about the x axis (X = x, Y = -y, Z = -z), which
 * keeps handedness so parts are never mirrored.
 */
export const LDU_STUD = 20;
export const LDU_PLATE = 8;

export type Mat3 = [number, number, number, number, number, number, number, number, number];

/** Rotation about LDraw's vertical axis. Grid rot θ maps local +x to world +z, i.e. LDraw -Z. */
export function yawMatrix(deg: number): Mat3 {
  const r = (((deg % 360) + 360) % 360) * (Math.PI / 180);
  const c = Math.round(Math.cos(r));
  const s = Math.round(Math.sin(r));
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

/** Position and orientation of a placed part in LDraw space. */
export function ldrawTransform(pl: Placement, def: PartDef): { pos: [number, number, number]; m: Mat3 } {
  const fp = footprint(pl, def);
  const cx = fp.x0 + fp.sx / 2;
  const cz = fp.z0 + fp.sz / 2;
  const m = yawMatrix(pl.rot + def.ldraw.yaw);
  // Shift so the part's native `origin` point lands on the footprint's top centre.
  const [ox, oy, oz] = def.ldraw.origin ?? [0, 0, 0];
  const pos: [number, number, number] = [
    cx * LDU_STUD - (m[0] * ox + m[1] * oy + m[2] * oz),
    -fp.y1 * LDU_PLATE - (m[3] * ox + m[4] * oy + m[5] * oz),
    -cz * LDU_STUD - (m[6] * ox + m[7] * oy + m[8] * oz),
  ];
  return { pos, m };
}

const fmt = (n: number) => (Object.is(n, -0) ? "0" : String(Math.round(n * 1000) / 1000));

/** LDraw line(s) for a placement: the part, plus any extra parts it includes (e.g. a door in its frame). */
export function partLine(pl: Placement): string {
  const def = getPart(pl.part);
  if (!def) throw new Error(`Unknown part ${pl.part}`);
  const color = COLOR_MAP.get(pl.color)?.ldraw ?? 16;
  const { pos, m } = ldrawTransform(pl, def);
  const line = (file: string, p: number[]) => ["1", color, ...p.map(fmt), ...m.map(fmt), file].join(" ");
  const out = [line(def.ldraw.file, pos)];
  for (const e of def.ldraw.extra ?? []) {
    const [ox, oy, oz] = e.offset;
    out.push(line(e.file, [pos[0] + m[0] * ox + m[1] * oy + m[2] * oz, pos[1] + m[3] * ox + m[4] * oy + m[5] * oz, pos[2] + m[6] * ox + m[7] * oy + m[8] * oz]));
  }
  return out.join("\r\n");
}

function safeName(name: string): string {
  // Decompose accented letters (á → a + ◌́) and drop the combining marks, so they convert instead of vanishing.
  const ascii = name.normalize("NFD").replace(/[̀-ͯ]/g, "");
  return (ascii.trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "_") || "model").slice(0, 60);
}

/** Model body: header + part lines, with `0 STEP` after each build step. */
export function exportLdr(model: BrickModel, steps: BuildStep[], fileName = `${safeName(model.name)}.ldr`): string {
  const lines = [
    `0 ${model.name}`,
    `0 Name: ${fileName}`,
    `0 Author: Brick Builder`,
    `0 !LDRAW_ORG Unofficial_Model`,
    `0 // ${model.description.replace(/\s+/g, " ")}`,
    "",
  ];
  const emitted = new Set<number>();
  for (const s of steps) {
    lines.push(`0 // Step ${s.n}`);
    for (const i of s.parts) {
      lines.push(partLine(model.parts[i]));
      emitted.add(i);
    }
    lines.push("0 STEP");
  }
  // Anything not covered by steps (shouldn't happen for valid models) goes last.
  const rest = model.parts.map((_, i) => i).filter((i) => !emitted.has(i));
  if (rest.length) {
    for (const i of rest) lines.push(partLine(model.parts[i]));
    lines.push("0 STEP");
  }
  return lines.join("\r\n") + "\r\n";
}

/** Single-file multi-part document wrapping the main model. */
export function exportMpd(model: BrickModel, steps: BuildStep[]): string {
  const name = `${safeName(model.name)}.ldr`;
  return `0 FILE ${name}\r\n` + exportLdr(model, steps, name) + "0 NOFILE\r\n";
}

export function exportFileNames(model: BrickModel): { ldr: string; mpd: string } {
  const base = safeName(model.name);
  return { ldr: `${base}.ldr`, mpd: `${base}.mpd` };
}

// ---- designs: one submodel per unique sub-build --------------------------------

/** LDraw type-1 line placing a copy of a submodel, matching the compiler's copy transform. */
export function instanceLine(inst: Instance, box: Box, file: string): string {
  const u = -box.minX, v = -box.minZ; // local grid origin, relative to the box's min corner
  const W = box.maxX - box.minX, D = box.maxZ - box.minZ;
  const [ru, rv] = inst.rot === 0 ? [u, v] : inst.rot === 90 ? [D - v, u] : inst.rot === 180 ? [W - u, D - v] : [v, W - u];
  const pos = [(inst.x + ru) * LDU_STUD, -inst.y * LDU_PLATE, -(inst.z + rv) * LDU_STUD];
  return ["1", 16, ...pos.map(fmt), ...yawMatrix(inst.rot).map(fmt), file].join(" ");
}

/** Submodel file for a sub-build (prefixed so it can't collide with the main model's file). */
export function submodelFile(id: string, mirror = false): string {
  return `sub_${id}${mirror ? "_mirrored" : ""}.ldr`;
}

/** Group placements (parts or copies) by height into STEP blocks, bottom first. */
function stepBlocks(items: { y: number; line: string }[]): string[] {
  const out: string[] = [];
  const ys = [...new Set(items.map((i) => i.y))].sort((a, b) => a - b);
  for (const y of ys) {
    for (const i of items) if (i.y === y) out.push(i.line);
    out.push("0 STEP");
  }
  return out;
}

/**
 * .mpd for a design: the main model first, then one submodel per unique
 * sub-build. Copies are references to their submodel, so nesting is preserved.
 * Requires a successful compile (for each sub-build's local box).
 */
export function exportDesignMpd(design: BrickDesign, compiled: Pick<CompileResult, "boxes">): string {
  const subFiles = new Set(design.subBuilds.flatMap((s) => [submodelFile(s.id), submodelFile(s.id, true)].map((f) => f.toLowerCase())));
  let mainName = `${safeName(design.name)}.ldr`;
  if (subFiles.has(mainName.toLowerCase())) mainName = `main_${mainName}`;
  const byId = new Map(design.subBuilds.map((s) => [s.id, s]));
  const block = (file: string, title: string, description: string, parts: Placement[], uses: Instance[]) => {
    const items = [
      ...parts.map((p) => ({ y: p.y, line: partLine(p) })),
      ...uses.filter((u) => compiled.boxes[u.sub]).map((u) => ({ y: u.y, line: instanceLine(u, compiled.boxes[u.sub], submodelFile(u.sub, !!u.mirror)) })),
    ];
    return [`0 FILE ${file}`, `0 ${title}`, `0 Name: ${file}`, `0 Author: Brick Builder`, `0 !LDRAW_ORG Unofficial_Model`, ...(description ? [`0 // ${description.replace(/\s+/g, " ")}`] : []), "", ...stepBlocks(items), "0 NOFILE"];
  };
  const lines = block(mainName, design.name, design.description, design.main.parts, design.main.uses);
  // Every (sub-build, mirrored?) variant the model reaches gets its own submodel: a mirror
  // image is a real build with left/right parts swapped, not an LDraw mirror matrix.
  const done = new Set<string>();
  const queue: [string, boolean][] = design.main.uses.map((u) => [u.sub, !!u.mirror]);
  while (queue.length) {
    const [id, mirror] = queue.shift()!;
    const s = byId.get(id), box = compiled.boxes[id];
    if (!s || !box || done.has(`${id}|${mirror}`)) continue; // unused or broken
    done.add(`${id}|${mirror}`);
    const W = box.maxX - box.minX;
    const parts = mirror ? s.parts.map((p) => mirrorPlacement(p, box.minX, W) ?? p) : s.parts;
    const uses = mirror ? s.uses.map((u) => mirrorInstance(u, compiled.boxes[u.sub], box.minX, W)) : s.uses;
    for (const u of uses) queue.push([u.sub, !!u.mirror]);
    lines.push(...block(submodelFile(id, mirror), `${s.name}${mirror ? " (mirrored)" : ""}`, "", parts, uses));
  }
  return lines.join("\r\n") + "\r\n";
}

/** A nested copy seen in a mirror: mirrored position in the parent's box, rotation negated, mirror flag toggled. */
function mirrorInstance(u: Instance, childBox: Box | undefined, minX: number, width: number): Instance {
  if (!childBox) return u;
  const W = childBox.maxX - childBox.minX, D = childBox.maxZ - childBox.minZ;
  const sx = u.rot === 90 || u.rot === 270 ? D : W;
  return { ...u, x: minX + (width - (u.x - minX) - sx), rot: ((360 - u.rot) % 360) as Instance["rot"], mirror: !u.mirror };
}
