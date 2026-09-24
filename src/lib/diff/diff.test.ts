import { describe, expect, it } from "vitest";
import { applyDesignDiff, applyModelDiff } from "./diff";
import { jsonCodec } from "./codec";
import { P, SAMPLE_HOUSE } from "../fixtures/samples";
import { SAMPLE_VILLAGE } from "../fixtures/designs";

const d = (x: object) => ({ name: "", description: "", remove: [], set: [], add: [], ...x });

describe("model diffs", () => {
  it("removes, replaces and adds by index into the listing Claude saw", () => {
    const r = applyModelDiff(SAMPLE_HOUSE, d({ remove: [0], set: [{ index: 1, ...P("brick_1x1", "blue", 9, 9, 9) }], add: [P("tile_1x1", "white", 1, 1, 1)] }), jsonCodec);
    expect(r.issues).toEqual([]);
    expect(r.value!.parts).toEqual([P("brick_1x1", "blue", 9, 9, 9), ...SAMPLE_HOUSE.parts.slice(2), P("tile_1x1", "white", 1, 1, 1)]);
    expect(r.value!.name).toBe(SAMPLE_HOUSE.name); // empty = keep
  });

  it("reports bad indices, parts changed twice and bad placements", () => {
    const n = SAMPLE_HOUSE.parts.length;
    const msgs = (x: object) => applyModelDiff(SAMPLE_HOUSE, d(x), jsonCodec).issues.map((i) => i.message).join(" ");
    expect(msgs({ remove: [n] })).toMatch(/doesn't exist/);
    expect(msgs({ remove: [0], set: [{ index: 0, ...P("brick_1x1", "red", 0, 0, 0) }] })).toMatch(/both replaced and removed/);
    expect(msgs({ add: [{ part: "brick_1x1", color: "red", x: 0, y: 0, z: 0, rot: 45 }] })).toMatch(/rot/);
  });

  it("is much smaller than re-sending the model for a small repair", () => {
    const full = JSON.stringify(SAMPLE_HOUSE).length;
    const change = JSON.stringify(d({ set: [{ index: 3, ...P("brick_1x2", "red", 2, 3, 0) }] })).length;
    expect(change).toBeLessThan(full / 5);
  });
});

describe("design diffs", () => {
  it("changes one sub-build's parts and the main build's copies, adds and removes sub-builds", () => {
    const r = applyDesignDiff(
      SAMPLE_VILLAGE,
      {
        name: "Village",
        description: "",
        changes: [
          { id: "pine_tree", remove: [], set: [], add: [P("plate_1x1", "yellow", 0, 11, 0)], removeCopies: [], setCopies: [], addCopies: [] },
          { id: "main", remove: [], set: [], add: [], removeCopies: [0], setCopies: [], addCopies: [{ sub: "shed", x: 0, y: 1, z: 0, rot: 0, mirror: true }] },
        ],
        newSubBuilds: [{ id: "shed", name: "Shed", parts: [P("brick_2x2", "tan", 0, 0, 0)], uses: [] }],
        removeSubBuilds: [],
      },
      jsonCodec,
    );
    expect(r.issues).toEqual([]);
    const v = r.value!;
    expect(v.name).toBe("Village");
    expect(v.subBuilds.find((s) => s.id === "pine_tree")!.parts.at(-1)).toEqual(P("plate_1x1", "yellow", 0, 11, 0));
    expect(v.main.uses).toEqual([...SAMPLE_VILLAGE.main.uses.slice(1), { sub: "shed", x: 0, y: 1, z: 0, rot: 0, mirror: true }]);
    expect(v.subBuilds.map((s) => s.id)).toContain("shed");
  });

  it("rejects changes to unknown sub-builds and clashing new ids", () => {
    const msgs = applyDesignDiff(SAMPLE_VILLAGE, { changes: [{ id: "nope" }], newSubBuilds: [{ id: "pine_tree", parts: [], uses: [] }] }, jsonCodec).issues.map((i) => i.message).join(" ");
    expect(msgs).toMatch(/unknown sub-build "nope"/);
    expect(msgs).toMatch(/already exists/);
  });
});
