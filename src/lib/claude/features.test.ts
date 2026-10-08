import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { featureLoss, partLossLimit } from "./features";
import { generateDesign } from "./subbuilds";
import { simulatedClient } from "./simulated";

const parts = (n: number, type = "brick_1x2") => Array.from({ length: n }, () => ({ part: type }));
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe("repairs may not delete planned features", () => {
  it("allows at most 3 parts or 10% of them, whichever is smaller", () => {
    expect(partLossLimit(100)).toBe(3);
    expect(partLossLimit(20)).toBe(2);
    expect(partLossLimit(5)).toBe(0.5);
    const lose = (n: number, k: number) => featureLoss("sub:x", 1, [{ id: "sub:x", parts: parts(n) }], [{ id: "sub:x", parts: parts(n - k) }]);
    expect(lose(100, 3).issues).toEqual([]);
    expect(lose(100, 4).issues.map((i) => i.code)).toEqual(["FEATURE_REMOVED"]);
    expect(lose(20, 2).issues).toEqual([]);
    expect(lose(20, 3).issues).toHaveLength(1);
    expect(lose(9, 1).issues).toHaveLength(1);
    // Accepted removals are still recorded for the summary.
    expect(lose(100, 2).removals).toEqual([expect.objectContaining({ partsLost: 2, rejected: false })]);
  });

  it("flags a part type that disappears completely, even when the count holds", () => {
    const first = [{ id: "asm:clock_tower", parts: [...parts(30), { part: "99781" }] }];
    const swapped = [{ id: "asm:clock_tower", parts: [...parts(30), { part: "brick_1x2" }] }];
    const r = featureLoss("asm:clock_tower", 1, first, swapped);
    expect(r.removals[0]).toMatchObject({ partsLost: 0, typesLost: ["99781"], rejected: true });
    expect(r.issues[0].message).toMatch(/part type 99781 is gone completely/);
    // Replacing one of several parts of a type keeps the type: allowed.
    expect(featureLoss("asm:clock_tower", 1, [{ id: "asm:clock_tower", parts: [...parts(30), { part: "99781" }, { part: "99781" }] }], first).issues).toEqual([]);
  });

  it("flags lost copies of a planned sub-build", () => {
    const first = [{ id: "main", parts: parts(40), uses: [...Array(6)].map(() => ({ sub: "lamp_post" })) }];
    const r = featureLoss("assembly", 1, first, [{ id: "main", parts: parts(40), uses: [] }]);
    expect(r.removals[0]).toMatchObject({ copiesLost: { lamp_post: 6 }, rejected: true });
    expect(r.issues[0].message).toMatch(/6 of 6 "lamp_post" copies are gone/);
  });

  it("an assembly repair that deletes copies fails, and the next repair puts them back (simulated Claude)", async () => {
    const lib = fs.mkdtempSync(path.join(os.tmpdir(), "brickforge-lib-"));
    dirs.push(lib);
    const r = await generateDesign({ text: "a town square", detail: "very_high" }, () => {}, { client: simulatedClient({ dropOnRepair: ["Market stall"] }), library: lib });
    dirs.push(r.debugDir);
    expect(r.valid).toBe(true);
    const stall = r.rounds.filter((x) => x.scope === "asm:market_stall");
    expect(stall.map((x) => Object.keys(x.errorCodes))).toEqual([expect.any(Array), ["FEATURE_REMOVED"], []]);
    expect(r.repairRemovals).toEqual([expect.objectContaining({ scope: "asm:market_stall", round: 1, rejected: true, copiesLost: { stall_counter: 1 } })]);
    const summary = JSON.parse(fs.readFileSync(path.join(r.debugDir, "summary.json"), "utf8"));
    expect(summary.repairRemovals).toHaveLength(1);
    // The stall keeps all its planned children.
    expect(r.design!.subBuilds.find((s) => s.id === "market_stall")!.uses.some((u) => u.sub === "stall_counter")).toBe(true);
  });
});
