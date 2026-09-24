import { COLORS } from "../parts/colors";
import { PARTS, type PartDef } from "../parts/library";
import { rotatedSize } from "../model/geometry";
import type { BrickModel, Placement, Rot } from "../model/schema";
import { LDU_PLATE, LDU_STUD, type Mat3 } from "./export";

export interface ImportResult {
  model: BrickModel;
  /** Type-1 lines that couldn't be mapped (unknown part/colour, tilted, off-grid, submodel loop). */
  skipped: { line: number; reason: string }[];
}

const byFile = new Map<string, PartDef>(PARTS.map((p) => [p.ldraw.file.toLowerCase(), p]));
const byColor = new Map<number, string>(COLORS.map((c) => [c.ldraw, c.id]));
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

      const def = byFile.get(ref.toLowerCase());
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
        skipped.push({ line: lineNo, reason: "part is tilted or mirrored" });
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
      parts.push({ part: def.id, color: colorId, x: Math.round(x), y: Math.round(y), z: Math.round(z), rot });
    }
  }

  if (files[0]) walk(files[0], IDENTITY, [0, 0, 0], INHERIT, [files[0].name.toLowerCase()]);
  return { model: { name: name || fallbackName, description, parts }, skipped };
}
