import { COLOR_MAP } from "../parts/colors";
import { getPart, type PartDef } from "../parts/library";
import { footprint } from "../model/geometry";
import type { BrickModel, Placement } from "../model/schema";
import type { BuildStep } from "../steps/steps";

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

export function partLine(pl: Placement): string {
  const def = getPart(pl.part);
  if (!def) throw new Error(`Unknown part ${pl.part}`);
  const color = COLOR_MAP.get(pl.color)?.ldraw ?? 16;
  const { pos, m } = ldrawTransform(pl, def);
  return ["1", color, ...pos.map(fmt), ...m.map(fmt), def.ldraw.file].join(" ");
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
