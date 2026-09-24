import { describe, expect, it } from "vitest";
import { parseModelFile } from "./openFile";
import { compileDesign } from "./compile";
import { SAMPLE_VILLAGE } from "../fixtures/designs";
import { SAMPLE_HOUSE } from "../fixtures/samples";
import { compactJson, designJson } from "../../components/DesignTab";

describe("Open model JSON", () => {
  it("opens a flat model", () => {
    const r = parseModelFile(compactJson(SAMPLE_HOUSE));
    expect(r.design).toBeUndefined();
    expect(r.model.parts).toEqual(SAMPLE_HOUSE.parts);
  });

  it("opens a design with sub-builds, as downloaded, and compiles it", () => {
    for (const text of [JSON.stringify(SAMPLE_VILLAGE, null, 1), designJson(SAMPLE_VILLAGE)]) {
      const r = parseModelFile(text);
      expect(r.design?.subBuilds.map((s) => s.id)).toEqual(SAMPLE_VILLAGE.subBuilds.map((s) => s.id));
      expect(r.model.parts).toEqual(compileDesign(SAMPLE_VILLAGE).model.parts);
    }
  });

  it("explains what's wrong with a bad file", () => {
    expect(() => parseModelFile("{")).toThrow();
    expect(() => parseModelFile(JSON.stringify({ name: "x", description: "", parts: [{ part: "nope" }] }))).toThrow(/parts\.0/);
    expect(() => parseModelFile(JSON.stringify({ name: "x", description: "", main: { parts: "no" } }))).toThrow(/Not a valid design/);
    expect(() => parseModelFile(JSON.stringify({ name: "x", description: "", main: { parts: [], uses: [{ sub: "ghost", x: 0, y: 0, z: 0, rot: 0 }] } }))).toThrow(/ghost/);
  });
});
