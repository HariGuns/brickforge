import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { listBuilds, loadBuild, saveBuild } from "./store";
import { commitVersion, createWorkspace } from "./doc";
import { P, SAMPLE_HOUSE } from "../fixtures/samples";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "builds-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("build store", () => {
  it("saves, lists and loads a build with all versions", () => {
    let ws = createWorkspace(SAMPLE_HOUSE, "Built", { kind: "build", prompt: "a house" });
    ws = commitVersion(ws, { ...SAMPLE_HOUSE, parts: [...SAMPLE_HOUSE.parts, P("brick_1x1", "white", 0, 17, 2)] }, "Edit: chimney", { kind: "edit" });
    saveBuild(ws.doc, dir);
    expect(listBuilds(dir)).toEqual([expect.objectContaining({ id: ws.doc.id, versions: 2, parts: 27 })]);
    expect(loadBuild(ws.doc.id, dir)).toEqual(ws.doc);
  });
  it("rejects bad ids and invalid documents", () => {
    expect(loadBuild("../etc/passwd", dir)).toBeNull();
    expect(() => saveBuild({ id: "../x", name: "x" }, dir)).toThrow();
    const ws = createWorkspace(SAMPLE_HOUSE, "Built", { kind: "build" });
    expect(() => saveBuild({ ...ws.doc, currentId: "missing" }, dir)).toThrow(/currentId/);
  });
});
