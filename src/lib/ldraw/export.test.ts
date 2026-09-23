import { describe, expect, it } from "vitest";
import { exportLdr, exportMpd, partLine, yawMatrix } from "./export";
import { buildSteps } from "../steps/steps";
import { SAMPLE_HOUSE, SAMPLE_STACK, P } from "../fixtures/samples";
import { COLORS } from "../parts/colors";
import { PARTS } from "../parts/library";
import { footprint } from "../model/geometry";
import type { Placement, Rot } from "../model/schema";

/** Parse a type-1 line back into a grid placement (inverse of the exporter). */
function parseLine(line: string): Placement {
  const t = line.trim().split(/\s+/);
  const [X, Y, Z] = t.slice(2, 5).map(Number);
  const m = t.slice(5, 14).map(Number);
  const file = t[14];
  const color = COLORS.find((c) => c.ldraw === Number(t[1]))!.id;
  const def = PARTS.find((p) => p.ldraw.file === file)!;
  const theta = (Math.round((Math.atan2(m[2], m[0]) * 180) / Math.PI) + 360) % 360; // m = [c,0,s,...]
  const rot = (((theta - def.ldraw.yaw) % 360) + 360) % 360 as Rot;
  // Undo the origin shift, then the centre/top placement.
  const [ox, oy, oz] = def.ldraw.origin ?? [0, 0, 0];
  const cx = (X + m[0] * ox + m[1] * oy + m[2] * oz) / 20;
  const top = -(Y + m[3] * ox + m[4] * oy + m[5] * oz) / 8;
  const cz = -(Z + m[6] * ox + m[7] * oy + m[8] * oz) / 20;
  const probe = footprint({ part: def.id, color, x: 0, y: 0, z: 0, rot }, def);
  return { part: def.id, color, x: cx - probe.sx / 2, y: top - def.h, z: cz - probe.sz / 2, rot };
}
describe("LDraw export", () => {
  it("yaw matrices are proper rotations", () => {
    expect(yawMatrix(0)).toEqual([1, 0, 0, 0, 1, 0, -0, 0, 1]);
    expect(yawMatrix(90)).toEqual([0, 0, 1, 0, 1, 0, -1, 0, 0]);
  });

  it("writes a 2x4 brick with its top-centre at the right LDU position", () => {
    expect(partLine(P("brick_2x4", "red", 0, 0, 0))).toBe("1 4 40 -24 -20 1 0 0 0 1 0 0 0 1 3001.dat");
  });

  it("round-trips the sample house through .ldr", () => {
    const ldr = exportLdr(SAMPLE_HOUSE, buildSteps(SAMPLE_HOUSE));
    const lines = ldr.split(/\r\n/).filter((l) => l.startsWith("1 "));
    expect(lines).toHaveLength(SAMPLE_HOUSE.parts.length);
    const back = lines.map(parseLine);
    const key = (p: Placement) => `${p.part}|${p.color}|${p.x}|${p.y}|${p.z}|${p.rot}`;
    expect(back.map(key).sort()).toEqual(SAMPLE_HOUSE.parts.map(key).sort());
  });

  it("emits one STEP per build step and wraps .mpd", () => {
    const steps = buildSteps(SAMPLE_HOUSE);
    const ldr = exportLdr(SAMPLE_HOUSE, steps);
    expect(ldr.match(/^0 STEP$/gm)).toHaveLength(steps.length);
    const mpd = exportMpd(SAMPLE_HOUSE, steps);
    expect(mpd.startsWith("0 FILE Tiny_house.ldr\r\n")).toBe(true);
    expect(mpd.trimEnd().endsWith("0 NOFILE")).toBe(true);
  });
});
