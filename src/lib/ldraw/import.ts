import { COLORS } from "../parts/colors";
import { PARTS, type PartDef } from "../parts/library";
import { rotatedSize } from "../model/geometry";
import type { BrickModel, Placement, Rot } from "../model/schema";
import { LDU_PLATE, LDU_STUD } from "./export";

export interface ImportResult {
  model: BrickModel;
  /** Type-1 lines that couldn't be mapped (unknown part/colour, tilted, off-grid). */
  skipped: { line: number; reason: string }[];
}

const byFile = new Map<string, PartDef>(PARTS.map((p) => [p.ldraw.file.toLowerCase(), p]));
const byColor = new Map<number, string>(COLORS.map((c) => [c.ldraw, c.id]));
const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;

/**
 * Parse an .ldr/.mpd written by the exporter (or any file that only uses library
 * parts in grid-aligned, upright orientations) back into a grid model.
 * Inverse of ldrawTransform: undo the origin shift, then the centre/top placement.
 */
export function importLdr(text: string, fallbackName = "Imported model"): ImportResult {
  const lines = text.split(/\r?\n/);
  const parts: Placement[] = [];
  const skipped: ImportResult["skipped"] = [];
  let name = "";
  let description = "";

  lines.forEach((raw, i) => {
    const line = raw.trim();
    const tok = line.split(/\s+/);
    if (tok[0] === "0") {
      const rest = line.slice(1).trim();
      if (/^(FILE|NOFILE|STEP|Name:|Author:|!)/.test(rest)) return;
      if (rest.startsWith("//")) {
        const comment = rest.slice(2).trim();
        if (!description && !/^Step \d+$/.test(comment)) description = comment;
      } else if (!name && rest) name = rest;
      return;
    }
    if (tok[0] !== "1" || tok.length < 15) return;

    const file = tok.slice(14).join(" ").replace(/\\/g, "/").toLowerCase();
    const def = byFile.get(file);
    if (!def) return void skipped.push({ line: i + 1, reason: `unknown part ${file}` });
    const color = byColor.get(Number(tok[1]));
    if (!color) return void skipped.push({ line: i + 1, reason: `unknown colour ${tok[1]}` });

    const [X, Y, Z] = tok.slice(2, 5).map(Number);
    const m = tok.slice(5, 14).map(Number);
    // Only upright yaw rotations: [c,0,s, 0,1,0, -s,0,c] with c,s ∈ {-1,0,1}.
    const upright = near(m[1], 0) && near(m[3], 0) && near(m[4], 1) && near(m[5], 0) && near(m[7], 0) && near(m[0], m[8]) && near(m[2], -m[6]);
    if (!upright) return void skipped.push({ line: i + 1, reason: "part is tilted or mirrored" });
    const theta = (((Math.round((Math.atan2(m[2], m[0]) * 180) / Math.PI) - def.ldraw.yaw) % 360) + 360) % 360;
    if (theta % 90 !== 0) return void skipped.push({ line: i + 1, reason: "rotation is not a multiple of 90°" });
    const rot = theta as Rot;

    const [ox, oy, oz] = def.ldraw.origin ?? [0, 0, 0];
    const cx = (X + m[0] * ox + m[1] * oy + m[2] * oz) / LDU_STUD;
    const top = -(Y + m[3] * ox + m[4] * oy + m[5] * oz) / LDU_PLATE;
    const cz = -(Z + m[6] * ox + m[7] * oy + m[8] * oz) / LDU_STUD;
    const { sx, sz } = rotatedSize(def, rot);
    const x = cx - sx / 2;
    const y = top - def.h;
    const z = cz - sz / 2;
    if (![x, y, z].every((v) => near(v, Math.round(v)))) return void skipped.push({ line: i + 1, reason: "part is off the stud grid" });
    parts.push({ part: def.id, color, x: Math.round(x), y: Math.round(y), z: Math.round(z), rot });
  });

  return { model: { name: name || fallbackName, description, parts }, skipped };
}
