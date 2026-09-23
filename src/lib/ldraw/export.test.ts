import { describe, expect, it } from "vitest";
import { exportFileNames, exportLdr, exportMpd, partLine, yawMatrix } from "./export";
import { buildSteps } from "../steps/steps";
import { SAMPLE_HOUSE, SAMPLE_STACK, P } from "../fixtures/samples";

describe("LDraw export", () => {
  it("yaw matrices are proper rotations", () => {
    expect(yawMatrix(0)).toEqual([1, 0, 0, 0, 1, 0, -0, 0, 1]);
    expect(yawMatrix(90)).toEqual([0, 0, 1, 0, 1, 0, -1, 0, 0]);
  });

  it("writes a 2x4 brick with its top-centre at the right LDU position", () => {
    expect(partLine(P("brick_2x4", "red", 0, 0, 0))).toBe("1 4 40 -24 -20 1 0 0 0 1 0 0 0 1 3001.dat");
  });

  it("writes one type-1 line per part", () => {
    const ldr = exportLdr(SAMPLE_HOUSE, buildSteps(SAMPLE_HOUSE));
    expect(ldr.split(/\r\n/).filter((l) => l.startsWith("1 "))).toHaveLength(SAMPLE_HOUSE.parts.length);
  });

  it("converts accented letters in file names instead of dropping them", () => {
    const names = (name: string) => exportFileNames({ ...SAMPLE_STACK, name });
    expect(names("Red Lamborghini Huracán")).toEqual({ ldr: "Red_Lamborghini_Huracan.ldr", mpd: "Red_Lamborghini_Huracan.mpd" });
    expect(names("Crème Brûlée Café").ldr).toBe("Creme_Brulee_Cafe.ldr");
    expect(names("Rock & Roll!").ldr).toBe("Rock_Roll.ldr");
    expect(names("★★★").ldr).toBe("model.ldr");
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
