import { describe, expect, it } from "vitest";
import { BuildDocSchema, canRedo, canUndo, commitVersion, createWorkspace, currentVersion, isDirty, markSaved, openWorkspace, redo, restoreVersion, undo } from "./doc";
import { P, SAMPLE_HOUSE, SAMPLE_STACK } from "../fixtures/samples";

const withChimney = { ...SAMPLE_HOUSE, parts: [...SAMPLE_HOUSE.parts, P("brick_1x1", "white", 0, 17, 2)] };
const withFlag = { ...withChimney, name: "Flag house", parts: [...withChimney.parts, P("plate_1x1", "red", 0, 20, 2)] };

describe("build documents", () => {
  it("starts with one version, unsaved, nothing to undo", () => {
    const ws = createWorkspace(SAMPLE_HOUSE, "Built", { kind: "build" });
    expect(ws.doc.versions).toHaveLength(1);
    expect(currentVersion(ws).model).toBe(SAMPLE_HOUSE);
    expect([canUndo(ws), canRedo(ws), isDirty(ws)]).toEqual([false, false, true]);
    expect(BuildDocSchema.safeParse(ws.doc).success).toBe(true);
  });

  it("undo/redo walks edits; a new edit drops the redo tail but keeps every version", () => {
    let ws = createWorkspace(SAMPLE_HOUSE, "Built", { kind: "build" });
    ws = commitVersion(ws, withChimney, "Edit: chimney", { kind: "edit" });
    ws = commitVersion(ws, withFlag, "Edit: flag", { kind: "edit" });
    expect(currentVersion(ws).model.name).toBe("Flag house");
    expect(ws.doc.name).toBe("Flag house");
    ws = undo(ws);
    expect(currentVersion(ws).label).toBe("Edit: chimney");
    expect(ws.doc.name).toBe(SAMPLE_HOUSE.name);
    ws = undo(ws);
    expect(currentVersion(ws).label).toBe("Built");
    expect(canUndo(ws)).toBe(false);
    ws = redo(ws);
    expect(currentVersion(ws).label).toBe("Edit: chimney");
    ws = commitVersion(ws, SAMPLE_STACK, "Edit: other", { kind: "edit" });
    expect(canRedo(ws)).toBe(false);
    expect(ws.doc.versions.map((v) => v.label)).toEqual(["Built", "Edit: chimney", "Edit: flag", "Edit: other"]);
    ws = undo(ws);
    expect(currentVersion(ws).label).toBe("Edit: chimney");
  });

  it("restoring a version is undoable", () => {
    let ws = createWorkspace(SAMPLE_HOUSE, "Built", { kind: "build" });
    ws = commitVersion(ws, withChimney, "Edit: chimney", { kind: "edit" });
    const first = ws.doc.versions[0].id;
    ws = restoreVersion(ws, first);
    expect(currentVersion(ws).id).toBe(first);
    expect(ws.doc.currentId).toBe(first);
    ws = undo(ws);
    expect(currentVersion(ws).label).toBe("Edit: chimney");
    expect(restoreVersion(ws, "nope")).toBe(ws);
  });

  it("tracks unsaved changes", () => {
    let ws = markSaved(createWorkspace(SAMPLE_HOUSE, "Built", { kind: "build" }));
    expect(isDirty(ws)).toBe(false);
    ws = commitVersion(ws, withChimney, "Edit", { kind: "edit" });
    expect(isDirty(ws)).toBe(true);
    ws = markSaved(ws);
    ws = undo(ws);
    expect(isDirty(ws)).toBe(true);
  });

  it("opens a saved build at its current version", () => {
    let ws = createWorkspace(SAMPLE_HOUSE, "Built", { kind: "build" });
    ws = commitVersion(ws, withChimney, "Edit", { kind: "edit" });
    ws = undo(ws);
    const reopened = openWorkspace(JSON.parse(JSON.stringify(ws.doc)));
    expect(currentVersion(reopened).label).toBe("Built");
    expect(reopened.doc.versions).toHaveLength(2);
    expect([canUndo(reopened), isDirty(reopened)]).toEqual([false, false]);
  });
});
