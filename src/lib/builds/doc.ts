import { z } from "zod";
import { BrickModelSchema, type BrickModel } from "../model/schema";
import { BrickDesignSchema } from "../design/schema";

/**
 * A build is a document with an append-only list of versions. Undo/redo is a
 * separate stack of version ids: a new change drops the redo tail from the
 * stack, but never deletes a version, so everything stays in Versions.
 */

export const VersionSchema = z.object({
  id: z.string(),
  /** Compiled parts (always present; everything that displays or exports reads this). */
  model: BrickModelSchema,
  /** The sub-build design this version was compiled from, if any. Absent for flat models and older saves. */
  design: BrickDesignSchema.optional(),
  /** Human label, e.g. "Built from “a lighthouse”", "Edit: add a chimney". */
  label: z.string(),
  createdAt: z.string(),
  source: z.object({
    kind: z.enum(["build", "edit", "open"]),
    prompt: z.string().optional(),
    debugDir: z.string().optional(),
    cost: z.number().optional(),
  }),
});
export type Version = z.infer<typeof VersionSchema>;

export const BUILD_ID = /^[a-z0-9][a-z0-9-]{7,63}$/;

export const BuildDocSchema = z.object({
  id: z.string().regex(BUILD_ID),
  name: z.string().max(200),
  versions: z.array(VersionSchema).min(1).max(500),
  currentId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BuildDoc = z.infer<typeof BuildDocSchema>;

export interface History {
  /** Version ids in undo order. */
  stack: string[];
  index: number;
}

export interface Workspace {
  doc: BuildDoc;
  history: History;
  /** Bumped on every change; compared with savedRev to know if there's unsaved work. */
  rev: number;
  savedRev: number | null;
}

let counter = 0;
export function newId(prefix = "v"): string {
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}-${rand}`.toLowerCase();
}

export function createWorkspace(model: BrickModel, label: string, source: Version["source"], now = new Date().toISOString()): Workspace {
  const v: Version = { id: newId(), model, label, createdAt: now, source };
  const doc: BuildDoc = { id: newId("b"), name: model.name, versions: [v], currentId: v.id, createdAt: now, updatedAt: now };
  return { doc, history: { stack: [v.id], index: 0 }, rev: 0, savedRev: null };
}

/** Open a saved build: history starts at its current version. */
export function openWorkspace(doc: BuildDoc): Workspace {
  const current = doc.versions.some((v) => v.id === doc.currentId) ? doc.currentId : doc.versions.at(-1)!.id;
  return { doc: { ...doc, currentId: current }, history: { stack: [current], index: 0 }, rev: 0, savedRev: 0 };
}

export function currentVersion(ws: Workspace): Version {
  const id = ws.history.stack[ws.history.index];
  return ws.doc.versions.find((v) => v.id === id) ?? ws.doc.versions.at(-1)!;
}

function moveTo(ws: Workspace, history: History, now: string): Workspace {
  const currentId = history.stack[history.index];
  const v = ws.doc.versions.find((x) => x.id === currentId)!;
  return { ...ws, history, doc: { ...ws.doc, currentId, name: v.model.name, updatedAt: now }, rev: ws.rev + 1 };
}

/** Add a new version (from a chat edit) and make it current. */
export function commitVersion(ws: Workspace, model: BrickModel, label: string, source: Version["source"], now = new Date().toISOString()): Workspace {
  const v: Version = { id: newId(), model, label, createdAt: now, source };
  const stack = [...ws.history.stack.slice(0, ws.history.index + 1), v.id];
  return moveTo({ ...ws, doc: { ...ws.doc, versions: [...ws.doc.versions, v] } }, { stack, index: stack.length - 1 }, now);
}

/** Jump to an existing version; undo returns to where you were. */
export function restoreVersion(ws: Workspace, versionId: string, now = new Date().toISOString()): Workspace {
  if (!ws.doc.versions.some((v) => v.id === versionId) || ws.history.stack[ws.history.index] === versionId) return ws;
  const stack = [...ws.history.stack.slice(0, ws.history.index + 1), versionId];
  return moveTo(ws, { stack, index: stack.length - 1 }, now);
}

export const canUndo = (ws: Workspace) => ws.history.index > 0;
export const canRedo = (ws: Workspace) => ws.history.index < ws.history.stack.length - 1;

export function undo(ws: Workspace, now = new Date().toISOString()): Workspace {
  return canUndo(ws) ? moveTo(ws, { ...ws.history, index: ws.history.index - 1 }, now) : ws;
}
export function redo(ws: Workspace, now = new Date().toISOString()): Workspace {
  return canRedo(ws) ? moveTo(ws, { ...ws.history, index: ws.history.index + 1 }, now) : ws;
}

export const isDirty = (ws: Workspace) => ws.savedRev !== ws.rev;
export const markSaved = (ws: Workspace): Workspace => ({ ...ws, savedRev: ws.rev });
