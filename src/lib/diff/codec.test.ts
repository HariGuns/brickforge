import { describe, expect, it } from "vitest";
import { compactCodec, decodeAnswer, jsonCodec } from "./codec";
import { P, SAMPLE_HOUSE } from "../fixtures/samples";
import { SAMPLE_VILLAGE } from "../fixtures/designs";

describe("compact output format", () => {
  it("round-trips parts and copies (including mirror images)", () => {
    for (const p of SAMPLE_HOUSE.parts) expect(compactCodec.parsePlacement(compactCodec.formatPlacement(p))).toEqual(p);
    const u = { sub: "side_panel", x: -2, y: 1, z: 3, rot: 270 as const, mirror: true };
    expect(compactCodec.formatInstance(u)).toBe("side_panel -2 1 3 270 m");
    expect(compactCodec.parseInstance("side_panel -2 1 3 270 m")).toEqual(u);
    expect(compactCodec.parseInstance("pine_tree 4 1 0 90")).toEqual({ sub: "pine_tree", x: 4, y: 1, z: 0, rot: 90 });
  });

  it("explains malformed lines", () => {
    expect(compactCodec.parsePlacement("brick_2x4 red 1 2 3")).toMatch(/isn't "<part id> <color>/);
    expect(compactCodec.parsePlacement("brick_2x4 red 1 2 3 45")).toMatch(/rot must be/);
    expect(compactCodec.parsePlacement("brick_2x4 red 1.5 2 3 0")).toMatch(/whole numbers/);
  });

  it("decodes parts and copies anywhere in an answer, and reports bad lines with their path", () => {
    const answer = { name: "v", description: "", subBuilds: [{ id: "t", name: "T", parts: ["brick_1x1 green 0 0 0 0"], uses: [] }], main: { parts: ["plate_4x4 green 0 0 0 0", "bad"], uses: ["t 1 1 1 0 m"] } };
    const d = decodeAnswer(answer, compactCodec);
    expect(d.problems).toEqual(['main.parts.1: "bad" isn\'t "<part id> <color> <x> <y> <z> <rot>" with whole numbers']);
    const j = d.json as typeof answer & { main: { uses: unknown[] }; subBuilds: { parts: unknown[] }[] };
    expect(j.subBuilds[0].parts[0]).toEqual(P("brick_1x1", "green", 0, 0, 0));
    expect(j.main.uses[0]).toEqual({ sub: "t", x: 1, y: 1, z: 1, rot: 0, mirror: true });
  });

  it("uses about a third of the characters of the JSON objects", () => {
    const parts = SAMPLE_VILLAGE.subBuilds.flatMap((s) => s.parts);
    const json = parts.map(jsonCodec.formatPlacement).join(",").length;
    const compact = parts.map((p) => JSON.stringify(compactCodec.formatPlacement(p))).join(",").length;
    expect(compact / json).toBeLessThan(0.45);
  });
});
