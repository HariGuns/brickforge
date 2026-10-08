import { COLORS } from "../parts/colors";
import { PARTS, SNOT_PARTS, type PartDef } from "../parts/library";
import { CONFIG } from "../config";
import { approxGrid, type Frame } from "../sideways/frame";
import { rotatedSize } from "../model/geometry";
import type { BrickModel, Placement, Rot } from "../model/schema";
import { flipRot, ldrawTransform, LDU_PLATE, LDU_STUD, type Mat3 } from "./export";

export interface ImportResult {
  model: BrickModel;
  /** Type-1 lines that couldn't be mapped (unknown part/colour, tilted, off-grid, submodel loop). */
  skipped: { line: number; reason: string }[];
}

const byFile = new Map<string, PartDef>(PARTS.map((p) => [p.ldraw.file.toLowerCase(), p]));
const snotByFile = new Map<string, PartDef>(SNOT_PARTS.map((p) => [p.ldraw.file.toLowerCase(), p]));

/**
 * The frame of a part line turned onto its side (the inverse of frameTransform):
 * F R F = M · m0ᵀ and t = F (pos − F R F · p0), where m0, p0 place the part upright
 * at the origin. Null unless M is an axis-aligned rotation (not mirrored).
 */
function sidewaysFrame(lm: Mat3, pos: [number, number, number], def: PartDef): Frame | null {
  if (!lm.every((v) => near(v, Math.round(v)))) return null;
  const det = lm[0] * (lm[4] * lm[8] - lm[5] * lm[7]) - lm[1] * (lm[3] * lm[8] - lm[5] * lm[6]) + lm[2] * (lm[3] * lm[7] - lm[4] * lm[6]);
  if (!near(det, 1)) return null;
  const up = ldrawTransform({ part: def.id, color: "", x: 0, y: 0, z: 0, rot: 0 }, def);
  const m0t: Mat3 = [up.m[0], up.m[3], up.m[6], up.m[1], up.m[4], up.m[7], up.m[2], up.m[5], up.m[8]];
  const frf = mul(lm, m0t).map((v) => Math.round(v)) as Mat3;
  const fp = apply(frf, up.pos);
  const r3 = (n: number) => Math.round(n * 1000) / 1000 + 0;
  return { m: flipRot(frf).map((v) => v + 0) as Frame["m"], t: [r3(pos[0] - fp[0]), r3(-(pos[1] - fp[1])), r3(-(pos[2] - fp[2]))] };
}
const byColor = new Map<number, string>(COLORS.map((c) => [c.ldraw, c.id]));
/** Parts written as extras of a library part (e.g. the door in a door frame): skipped on import. */
const extraFiles = new Set(PARTS.flatMap((p) => (p.ldraw.extra ?? []).map((e) => e.file.toLowerCase())));
const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;
const INHERIT = 16;
const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

interface File {
  name: string;
  /** [original line number, text] */
  lines: [number, string][];
}

/** Split an .mpd into its files; a plain .ldr is one file. */
function splitFiles(text: string): File[] {
  const files: File[] = [];
  let cur: File | null = null;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    const m = line.match(/^0\s+FILE\s+(.+)$/i);
    if (m) {
      cur = { name: m[1].trim(), lines: [] };
      files.push(cur);
      return;
    }
    if (/^0\s+NOFILE\b/i.test(line)) {
      cur = null;
      return;
    }
    if (!cur) {
      if (files.length) return; // stray text between files
      cur = { name: "", lines: [] };
      files.push(cur);
    }
    (cur as File).lines.push([i + 1, line]);
  });
  return files;
}

const mul = (a: Mat3, b: Mat3): Mat3 => {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
};
const apply = (m: Mat3, v: [number, number, number]): [number, number, number] => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

/**
 * Parse an .ldr/.mpd written by the exporter (or any file that only uses library
 * parts in grid-aligned, upright orientations) back into a flat grid model.
 * Submodel references in an .mpd are expanded recursively. Part lines are the
 * inverse of ldrawTransform: undo the origin shift, then the centre/top placement.
 */
export function importLdr(text: string, fallbackName = "Imported model"): ImportResult {
  const files = splitFiles(text);
  const byName = new Map(files.map((f) => [f.name.toLowerCase(), f]));
  const parts: Placement[] = [];
  const skipped: ImportResult["skipped"] = [];
  let name = "";
  let description = "";

  // Name and description come from the main (first) file's header comments.
  for (const [, line] of files[0]?.lines ?? []) {
    if (!line.startsWith("0")) continue;
    const rest = line.slice(1).trim();
    if (/^(STEP|Name:|Author:|!)/.test(rest)) continue;
    if (rest.startsWith("//")) {
      const comment = rest.slice(2).trim();
      if (!description && !/^Step \d+$/.test(comment)) description = comment;
    } else if (!name && rest) name = rest;
  }

  function walk(file: File, m: Mat3, t: [number, number, number], color: number, stack: string[]) {
    for (const [lineNo, line] of file.lines) {
      const tok = line.split(/\s+/);
      if (tok[0] !== "1" || tok.length < 15) continue;
      const ref = tok.slice(14).join(" ").replace(/\\/g, "/");
      const c = Number(tok[1]) === INHERIT ? color : Number(tok[1]);
      const pos = apply(m, tok.slice(2, 5).map(Number) as [number, number, number]);
      const X = pos[0] + t[0], Y = pos[1] + t[1], Z = pos[2] + t[2];
      const lm = mul(m, tok.slice(5, 14).map(Number) as Mat3);

      const sub = byName.get(ref.toLowerCase());
      if (sub && sub !== files[0]) {
        if (stack.includes(sub.name.toLowerCase())) {
          skipped.push({ line: lineNo, reason: `submodel ${ref} includes itself` });
          continue;
        }
        walk(sub, lm, [X, Y, Z], c, [...stack, sub.name.toLowerCase()]);
        continue;
      }

      if (extraFiles.has(ref.toLowerCase())) continue;
      const def = byFile.get(ref.toLowerCase()) ?? (CONFIG.sideways.enabled ? snotByFile.get(ref.toLowerCase()) : undefined);
      if (!def) {
        skipped.push({ line: lineNo, reason: `unknown part ${ref.toLowerCase()}` });
        continue;
      }
      const colorId = byColor.get(c);
      if (!colorId) {
        skipped.push({ line: lineNo, reason: `unknown colour ${c}` });
        continue;
      }
      // Only upright yaw rotations: [c,0,s, 0,1,0, -s,0,c] with c,s ∈ {-1,0,1}.
      const upright = near(lm[1], 0) && near(lm[3], 0) && near(lm[4], 1) && near(lm[5], 0) && near(lm[7], 0) && near(lm[0], lm[8]) && near(lm[2], -lm[6]);
      if (!upright) {
        // Sideways building: a part turned onto its side becomes a part with an exact frame.
        const frame = CONFIG.sideways.enabled ? sidewaysFrame(lm, [X, Y, Z], def) : null;
        if (frame) parts.push({ part: def.id, color: colorId, ...approxGrid(frame), rot: 0, frame });
        else skipped.push({ line: lineNo, reason: "part is tilted or mirrored" });
        continue;
      }
      const theta = (((Math.round((Math.atan2(lm[2], lm[0]) * 180) / Math.PI) - def.ldraw.yaw) % 360) + 360) % 360;
      if (theta % 90 !== 0) {
        skipped.push({ line: lineNo, reason: "rotation is not a multiple of 90°" });
        continue;
      }
      const rot = theta as Rot;
      const [ox, oy, oz] = def.ldraw.origin ?? [0, 0, 0];
      const cx = (X + lm[0] * ox + lm[1] * oy + lm[2] * oz) / LDU_STUD;
      const top = -(Y + lm[3] * ox + lm[4] * oy + lm[5] * oz) / LDU_PLATE;
      const cz = -(Z + lm[6] * ox + lm[7] * oy + lm[8] * oz) / LDU_STUD;
      const { sx, sz } = rotatedSize(def, rot);
      const x = cx - sx / 2, y = top - def.h, z = cz - sz / 2;
      if (![x, y, z].every((v) => near(v, Math.round(v)))) {
        skipped.push({ line: lineNo, reason: "part is off the stud grid" });
        continue;
      }
      // + 0 turns -0 into 0 (a baseplate's top at LDraw Y 0 gives y = -0).
      parts.push({ part: def.id, color: colorId, x: Math.round(x) + 0, y: Math.round(y) + 0, z: Math.round(z) + 0, rot });
    }
  }

  if (files[0]) walk(files[0], IDENTITY, [0, 0, 0], INHERIT, [files[0].name.toLowerCase()]);
  return { model: { name: name || fallbackName, description, parts }, skipped };
}
