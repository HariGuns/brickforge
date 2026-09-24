/**
 * Diffs: for repairs, chat edits and photo comparisons, Claude returns only
 * what changes (parts to remove, replace or add, by index into the listing it
 * was shown; the same for copies; new and removed sub-builds), and code applies
 * it. Much less output than re-sending the whole model.
 */
import type { BrickModel, Placement } from "../model/schema";
import type { BrickDesign, Instance } from "../design/schema";
import { SUB_ID } from "../design/schema";
import type { Issue } from "../validate/validator";
import type { Codec } from "./codec";

const invalid = (message: string): Issue => ({ code: "INVALID_OUTPUT", severity: "error", parts: [], message });

/** Diff of one container (a model, a sub-build or the main build): parts, and copies if it has them. */
function containerProps(codec: Codec, copies: boolean): Record<string, unknown> {
  const withIndex = (inner: Record<string, unknown>) =>
    inner.type === "object"
      ? { ...inner, properties: { index: { type: "integer" }, ...(inner.properties as object) }, required: ["index", ...((inner.required as string[]) ?? [])] }
      : { type: "object", properties: { index: { type: "integer" }, value: inner }, required: ["index", "value"], additionalProperties: false };
  return {
    remove: { type: "array", items: { type: "integer" }, description: "Indices (#n) of parts to delete." },
    set: { type: "array", items: withIndex(codec.placementSchema), description: "Parts to replace: index plus the new placement." },
    add: { type: "array", items: codec.placementSchema, description: "New parts." },
    ...(copies
      ? {
          removeCopies: { type: "array", items: { type: "integer" } },
          setCopies: { type: "array", items: withIndex(codec.instanceSchema) },
          addCopies: { type: "array", items: codec.instanceSchema },
        }
      : {}),
  };
}

export function modelDiffJsonSchema(codec: Codec): Record<string, unknown> {
  const props = containerProps(codec, false);
  return {
    type: "object",
    properties: { name: { type: "string", description: "New name, or empty to keep it." }, description: { type: "string", description: "New description, or empty to keep it." }, ...props },
    required: ["name", "description", ...Object.keys(props)],
    additionalProperties: false,
  };
}

/** For the sub-build path's assembly (main build only: parts and copies). */
export function assemblyDiffJsonSchema(codec: Codec): Record<string, unknown> {
  const props = containerProps(codec, true);
  return { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, ...props }, required: ["name", "description", ...Object.keys(props)], additionalProperties: false };
}

export function designDiffJsonSchema(codec: Codec): Record<string, unknown> {
  const container = { type: "object", properties: { id: { type: "string", description: '"main" or a sub-build id.' }, ...containerProps(codec, true) }, required: ["id", "remove", "set", "add", "removeCopies", "setCopies", "addCopies"], additionalProperties: false };
  const sub = {
    type: "object",
    properties: { id: { type: "string" }, name: { type: "string" }, parts: { type: "array", items: codec.placementSchema }, uses: { type: "array", items: codec.instanceSchema } },
    required: ["id", "name", "parts", "uses"],
    additionalProperties: false,
  };
  return {
    type: "object",
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      changes: { type: "array", items: container, description: "Changes per container (main build or sub-build)." },
      newSubBuilds: { type: "array", items: sub },
      removeSubBuilds: { type: "array", items: { type: "string" } },
    },
    required: ["name", "description", "changes", "newSubBuilds", "removeSubBuilds"],
    additionalProperties: false,
  };
}

type Json = Record<string, unknown>;
const arr = (v: unknown) => (Array.isArray(v) ? v : []);

function applyList<T>(list: T[], remove: unknown, set: unknown, add: unknown, parse: (v: unknown) => T | string, what: string, where: string, issues: Issue[]): T[] {
  const out: (T | null)[] = [...list];
  const touched = new Set<number>();
  const bad = (i: unknown) => typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= list.length;
  for (const r of arr(set)) {
    const { index, value, ...rest } = (r ?? {}) as Json;
    if (bad(index)) {
      issues.push(invalid(`${where}: set ${what} index ${String(index)} doesn't exist (valid: 0–${list.length - 1}).`));
      continue;
    }
    const p = parse(value !== undefined ? value : rest);
    if (typeof p === "string") issues.push(invalid(`${where}: set ${what} #${index}: ${p}`));
    else if (touched.has(index as number)) issues.push(invalid(`${where}: ${what} #${index} is changed twice.`));
    else (touched.add(index as number), (out[index as number] = p));
  }
  for (const i of arr(remove)) {
    if (bad(i)) issues.push(invalid(`${where}: remove ${what} index ${String(i)} doesn't exist (valid: 0–${list.length - 1}).`));
    else if (touched.has(i as number)) issues.push(invalid(`${where}: ${what} #${i} is both replaced and removed.`));
    else (touched.add(i as number), (out[i as number] = null));
  }
  const added: T[] = [];
  for (const a of arr(add)) {
    const p = parse(a);
    if (typeof p === "string") issues.push(invalid(`${where}: added ${what}: ${p}`));
    else added.push(p);
  }
  return [...out.filter((x): x is T => x !== null), ...added];
}

export function applyModelDiff(base: BrickModel, json: unknown, codec: Codec): { value: BrickModel | null; issues: Issue[] } {
  if (!json || typeof json !== "object") return { value: null, issues: [invalid("Expected an object with remove / set / add.")] };
  const d = json as Json;
  const issues: Issue[] = [];
  const parts = applyList(base.parts, d.remove, d.set, d.add, codec.parsePlacement, "part", "model", issues);
  if (issues.length) return { value: null, issues };
  return { value: { name: String(d.name || base.name), description: String(d.description || base.description), parts }, issues: [] };
}

export interface Container {
  parts: Placement[];
  uses: Instance[];
}

function applyContainer(c: Container, d: Json, codec: Codec, where: string, issues: Issue[]): Container {
  return {
    parts: applyList(c.parts, d.remove, d.set, d.add, codec.parsePlacement, "part", where, issues),
    uses: applyList(c.uses, d.removeCopies, d.setCopies, d.addCopies, codec.parseInstance, "copy", where, issues),
  };
}

/** Assembly (main build) diff → the new assembly. */
export function applyAssemblyDiff<A extends Container & { name: string; description: string }>(base: A, json: unknown, codec: Codec): { value: A | null; issues: Issue[] } {
  if (!json || typeof json !== "object") return { value: null, issues: [invalid("Expected an object with the changes.")] };
  const d = json as Json;
  const issues: Issue[] = [];
  const c = applyContainer(base, d, codec, "main", issues);
  if (issues.length) return { value: null, issues };
  return { value: { ...base, name: String(d.name || base.name), description: String(d.description || base.description), ...c }, issues: [] };
}

export function applyDesignDiff(base: BrickDesign, json: unknown, codec: Codec): { value: BrickDesign | null; issues: Issue[] } {
  if (!json || typeof json !== "object") return { value: null, issues: [invalid("Expected an object with the changes.")] };
  const d = json as Json;
  const issues: Issue[] = [];
  let subs = base.subBuilds.map((s) => ({ ...s }));
  let main: Container = { ...base.main };
  const seen = new Set<string>();
  for (const ch of arr(d.changes) as Json[]) {
    const id = String(ch?.id ?? "");
    if (seen.has(id)) {
      issues.push(invalid(`"${id}" has two change entries; put all its changes in one.`));
      continue;
    }
    seen.add(id);
    if (id === "main") main = applyContainer(main, ch, codec, "main", issues);
    else {
      const k = subs.findIndex((s) => s.id === id);
      if (k < 0) issues.push(invalid(`Changes for unknown sub-build "${id}". Existing: ${subs.map((s) => s.id).join(", ") || "none"}; add new ones under newSubBuilds.`));
      else subs[k] = { ...subs[k], ...applyContainer(subs[k], ch, codec, id, issues) };
    }
  }
  const removed = new Set(arr(d.removeSubBuilds).map(String));
  subs = subs.filter((s) => !removed.has(s.id));
  for (const n of arr(d.newSubBuilds) as Json[]) {
    const id = String(n?.id ?? "");
    if (!SUB_ID.test(id)) issues.push(invalid(`New sub-build id "${id}": lowercase letters, digits and _, starting with a letter.`));
    else if (subs.some((s) => s.id === id)) issues.push(invalid(`New sub-build "${id}" already exists; change it under changes instead.`));
    else {
      const parts = arr(n.parts).map(codec.parsePlacement);
      const uses = arr(n.uses).map(codec.parseInstance);
      const errs = [...parts, ...uses].filter((x): x is string => typeof x === "string");
      if (errs.length) issues.push(invalid(`New sub-build "${id}": ${errs.slice(0, 3).join("; ")}`));
      else subs.push({ id, name: String(n.name || id), parts: parts as Placement[], uses: uses as Instance[] });
    }
  }
  if (issues.length) return { value: null, issues };
  return { value: { name: String(d.name || base.name), description: String(d.description || base.description), subBuilds: subs, main }, issues: [] };
}

/** How to write changes, for prompts. */
export const DIFF_INSTRUCTIONS = `Return only the changes, as indices into the listing above: remove (indices of parts to delete), set (index plus the corrected placement, for parts to move, recolour or swap), add (new parts). Indices always refer to the listing as shown, before any of your changes. Leave the name and description empty to keep them. Everything you don't mention stays exactly as it is.`;

export const DESIGN_DIFF_INSTRUCTIONS = `Return only the changes. For each container you change ("main" or a sub-build id), one entry with: remove / set / add for its parts and removeCopies / setCopies / addCopies for its copies, all by index into that container's listing above (before your changes). New sub-builds go in newSubBuilds (complete), unused ones in removeSubBuilds. Leave the name and description empty to keep them. Everything you don't mention stays exactly as it is.`;
