import { CONFIG } from "../config";
import { getPart } from "../parts/library";
import { rotatedSize } from "../model/geometry";
import type { BrickModel, Placement, Rot } from "../model/schema";
import { validate, type Issue, type ValidationResult } from "../validate/validator";
import type { BrickDesign, Instance, SubBuild } from "./schema";

/**
 * Deterministic compiler: expands a design (tree of sub-builds) into a flat
 * BrickModel, keeps track of which copy every part came from, validates the
 * result, and checks the joins between sub-builds.
 */

export interface CompiledInstance {
  index: number;
  sub: string;
  name: string;
  /** 1-based copy number of this sub-build across the whole model. */
  copy: number;
  /** e.g. "Tower #1 › Window #2". */
  path: string;
  /** Parent instance index, or -1 for the main build. */
  parent: number;
  depth: number;
  /** Indices into model.parts of every part in this copy (including nested copies). */
  parts: number[];
}

export interface SubBuildInfo {
  id: string;
  name: string;
  /** Parts in one copy, including nested sub-builds. */
  parts: number;
  /** Total copies in the compiled model. */
  copies: number;
  /** Direct child sub-builds and how many copies each copy contains. */
  children: { sub: string; count: number }[];
  /** Footprint (studs) and height (plates) of one copy. */
  size: { w: number; d: number; h: number };
}

export interface TreeNode {
  sub: string | null; // null = main build
  name: string;
  /** Copies of this node per copy of its parent. */
  count: number;
  parts: number;
  children: TreeNode[];
}

export interface CompileStats {
  pieces: number;
  uniqueSubBuilds: number;
  copies: number;
  compileMs: number;
  errors: number;
  warnings: number;
  /** Real-world size: 1 stud = 0.8 cm, 1 plate = 0.32 cm, plus stud height on top. */
  sizeCm: { w: number; d: number; h: number };
}

export interface CompileResult {
  model: BrickModel;
  /** Per part: the innermost copy it belongs to (instance index), or -1 for main-build parts. */
  origin: number[];
  instances: CompiledInstance[];
  subBuilds: SubBuildInfo[];
  tree: TreeNode;
  /** Footprint box of each sub-build in its own local frame (copies rotate inside it). */
  boxes: Record<string, Box>;
  errors: Issue[];
  warnings: Issue[];
  validation: ValidationResult | null;
  stats: CompileStats;
}

export interface CompileOptions {
  grid?: { x: number; z: number; y: number };
  maxParts?: number;
  maxDepth?: number;
  /** Structural checks, passed to the validator (default "warn"). */
  structure?: "off" | "warn" | "error";
}

interface Tagged {
  pl: Placement;
  /** Path of `uses` indices from the container down to the part's innermost copy. */
  tag: number[];
}

export interface Box {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  maxY: number;
}

const STUD_CM = 0.8;
const PLATE_CM = 0.32;
const STUD_TOP_CM = 0.17;

function bbox(parts: Placement[]): Box {
  const b = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity, maxY: 0 };
  for (const pl of parts) {
    const def = getPart(pl.part);
    const { sx, sz } = def ? rotatedSize(def, pl.rot) : { sx: 1, sz: 1 };
    b.minX = Math.min(b.minX, pl.x);
    b.minZ = Math.min(b.minZ, pl.z);
    b.maxX = Math.max(b.maxX, pl.x + sx);
    b.maxZ = Math.max(b.maxZ, pl.z + sz);
    b.maxY = Math.max(b.maxY, pl.y + (def?.h ?? 1));
  }
  if (!parts.length) return { minX: 0, minZ: 0, maxX: 0, maxZ: 0, maxY: 0 };
  return b;
}

/**
 * Place a part from a sub-build's local frame into its parent's frame. The copy
 * turns about the vertical axis (same sense as part rotation) inside the
 * sub-build's footprint box, then that box's min corner goes to (inst.x, inst.z).
 */
export function transformPlacement(pl: Placement, box: Box, inst: Pick<Instance, "x" | "y" | "z" | "rot">): Placement {
  const def = getPart(pl.part);
  const { sx, sz } = def ? rotatedSize(def, pl.rot) : { sx: 1, sz: 1 };
  const ox = pl.x - box.minX, oz = pl.z - box.minZ;
  const W = box.maxX - box.minX, D = box.maxZ - box.minZ;
  let nx: number, nz: number;
  switch (inst.rot) {
    case 0:
      [nx, nz] = [ox, oz];
      break;
    case 90:
      [nx, nz] = [D - oz - sz, ox];
      break;
    case 180:
      [nx, nz] = [W - ox - sx, D - oz - sz];
      break;
    case 270:
      [nx, nz] = [oz, W - ox - sx];
      break;
  }
  return { ...pl, x: inst.x + nx, y: inst.y + pl.y, z: inst.z + nz, rot: ((pl.rot + inst.rot) % 360) as Rot };
}

const err = (code: Issue["code"], message: string, parts: number[] = []): Issue => ({ code, severity: "error", parts, message });
const warn = (code: Issue["code"], message: string, parts: number[] = []): Issue => ({ code, severity: "warning", parts, message });

export function compileDesign(design: BrickDesign, opts: CompileOptions = {}): CompileResult {
  const t0 = performance.now();
  const maxDepth = opts.maxDepth ?? CONFIG.design.maxDepth;
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  // --- sub-build table ---------------------------------------------------------
  const subs = new Map<string, SubBuild>();
  for (const s of design.subBuilds) {
    if (subs.has(s.id)) errors.push(err("DUPLICATE_SUBBUILD", `Sub-build id "${s.id}" is defined more than once.`));
    else subs.set(s.id, s);
  }

  // --- local expansion (memoised per sub-build, in its own frame) --------------
  const memo = new Map<string, Tagged[]>();
  const boxes = new Map<string, Box>();
  const broken = new Set<string>();
  const reported = new Set<string>();

  function expandUses(uses: Instance[], owner: string, visiting: string[], out: Tagged[]) {
    uses.forEach((u, ui) => {
      const child = local(u.sub, [...visiting, owner], owner);
      if (!child || !child.length) return;
      const box = boxes.get(u.sub)!;
      for (const c of child) out.push({ pl: transformPlacement(c.pl, box, u), tag: [ui, ...c.tag] });
    });
  }

  function local(id: string, visiting: string[], from: string): Tagged[] | null {
    const sub = subs.get(id);
    const once = (key: string, issue: Issue) => {
      if (!reported.has(key)) (reported.add(key), errors.push(issue));
    };
    if (!sub) {
      once(`unknown:${id}`, err("UNKNOWN_SUBBUILD", `"${from}" uses sub-build "${id}", which isn't defined. Defined sub-builds: ${[...subs.keys()].join(", ") || "none"}.`));
      return null;
    }
    if (visiting.includes(id)) {
      once(`cycle:${id}`, err("SUBBUILD_CYCLE", `Sub-builds use each other in a loop: ${[...visiting.slice(visiting.indexOf(id)), id].join(" → ")}.`));
      broken.add(id);
      return null;
    }
    if (visiting.length > maxDepth) {
      once(`deep:${id}`, err("TOO_DEEP", `Sub-builds are nested more than ${maxDepth} levels deep (${[...visiting.slice(1), id].join(" → ")}).`));
      return null;
    }
    const cached = memo.get(id);
    if (cached) return cached;
    const out: Tagged[] = sub.parts.map((pl) => ({ pl, tag: [] }));
    expandUses(sub.uses, id, visiting, out);
    if (!out.length) once(`empty:${id}`, err("EMPTY_SUBBUILD", `Sub-build "${id}" has no parts.`));
    memo.set(id, out);
    boxes.set(id, bbox(out.map((t) => t.pl)));
    return out;
  }

  const flat: Tagged[] = design.main.parts.map((pl) => ({ pl, tag: [] }));
  expandUses(design.main.uses, "main", [], flat);

  for (const id of subs.keys()) {
    if (!memo.has(id) && !broken.has(id)) warnings.push(warn("UNUSED_SUBBUILD", `Sub-build "${id}" is defined but never used.`));
  }

  // --- instances from tags ---------------------------------------------------------
  const instances: CompiledInstance[] = [];
  const byTag = new Map<string, number>();
  const copyCount = new Map<string, number>();
  const origin: number[] = new Array(flat.length).fill(-1);

  function usesAt(tag: number[]): Instance | null {
    let uses = design.main.uses;
    let inst: Instance | null = null;
    for (const i of tag) {
      inst = uses[i] ?? null;
      if (!inst) return null;
      uses = subs.get(inst.sub)?.uses ?? [];
    }
    return inst;
  }
  function instanceFor(tag: number[]): number {
    const key = tag.join(".");
    const found = byTag.get(key);
    if (found !== undefined) return found;
    const parent = tag.length > 1 ? instanceFor(tag.slice(0, -1)) : -1;
    const inst = usesAt(tag)!;
    const name = subs.get(inst.sub)?.name ?? inst.sub;
    const copy = (copyCount.get(inst.sub) ?? 0) + 1;
    copyCount.set(inst.sub, copy);
    const index = instances.length;
    instances.push({ index, sub: inst.sub, name, copy, path: `${parent >= 0 ? `${instances[parent].path} › ` : ""}${name} #${copy}`, parent, depth: tag.length, parts: [] });
    byTag.set(key, index);
    return index;
  }
  flat.forEach((t, i) => {
    if (!t.tag.length) return;
    origin[i] = instanceFor(t.tag);
    for (let k = 1; k <= t.tag.length; k++) instances[instanceFor(t.tag.slice(0, k))].parts.push(i);
  });

  const model: BrickModel = { name: design.name, description: design.description, parts: flat.map((t) => t.pl) };

  // --- validation ------------------------------------------------------------------------
  let validation: ValidationResult | null = null;
  if (!errors.some((e) => ["SUBBUILD_CYCLE", "DUPLICATE_SUBBUILD"].includes(e.code))) {
    validation = validate(model, { grid: opts.grid ?? CONFIG.design.grid, maxParts: opts.maxParts ?? CONFIG.design.maxParts, structure: opts.structure });
    const joins = joinChecks(model, validation, instances, origin);
    const suppress = joins.suppress;
    const where = (e: Issue) => {
      const owners = [...new Set(e.parts.map((p) => origin[p]).filter((o) => o >= 0))];
      return owners.length && owners.length <= 3 ? `${e.message} [in ${owners.map((o) => instances[o].path).join("; ")}]` : e.message;
    };
    errors.push(...validation.errors.filter((e) => !suppress(e)).map((e) => ({ ...e, message: where(e) })), ...joins.errors);
    warnings.push(...validation.warnings.map((e) => ({ ...e, message: where(e) })));
  }

  // --- sub-build info + tree ----------------------------------------------------------
  const subBuilds: SubBuildInfo[] = [...subs.values()]
    .filter((s) => memo.has(s.id))
    .map((s) => {
      const counts = new Map<string, number>();
      for (const u of s.uses) counts.set(u.sub, (counts.get(u.sub) ?? 0) + 1);
      const b = boxes.get(s.id)!;
      return {
        id: s.id,
        name: s.name,
        parts: memo.get(s.id)!.length,
        copies: copyCount.get(s.id) ?? 0,
        children: [...counts].map(([sub, count]) => ({ sub, count })),
        size: { w: b.maxX - b.minX, d: b.maxZ - b.minZ, h: b.maxY },
      };
    });
  const info = new Map(subBuilds.map((s) => [s.id, s]));
  const node = (sub: string, count: number, depth: number): TreeNode => ({
    sub,
    name: info.get(sub)?.name ?? sub,
    count,
    parts: info.get(sub)?.parts ?? 0,
    children: depth > maxDepth ? [] : (info.get(sub)?.children ?? []).filter((c) => info.has(c.sub)).map((c) => node(c.sub, c.count, depth + 1)),
  });
  const mainCounts = new Map<string, number>();
  for (const u of design.main.uses) if (info.has(u.sub)) mainCounts.set(u.sub, (mainCounts.get(u.sub) ?? 0) + 1);
  const tree: TreeNode = { sub: null, name: design.name, count: 1, parts: model.parts.length, children: [...mainCounts].map(([sub, count]) => node(sub, count, 1)) };

  // --- stats ------------------------------------------------------------------------------
  const whole = bbox(model.parts);
  const hasParts = model.parts.length > 0;
  return {
    model,
    origin,
    instances,
    subBuilds,
    tree,
    boxes: Object.fromEntries(boxes),
    errors,
    warnings,
    validation,
    stats: {
      pieces: model.parts.length,
      uniqueSubBuilds: subBuilds.length,
      copies: instances.length,
      compileMs: Math.round((performance.now() - t0) * 10) / 10,
      errors: errors.length,
      warnings: warnings.length,
      sizeCm: hasParts
        ? {
            w: round1((whole.maxX - whole.minX) * STUD_CM),
            d: round1((whole.maxZ - whole.minZ) * STUD_CM),
            h: round1(whole.maxY * PLATE_CM + STUD_TOP_CM),
          }
        : { w: 0, d: 0, h: 0 },
    },
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Join checks, at every level of the tree. In each container (the main build or
 * a copy of a sub-build), the "units" are its own parts and its direct child
 * copies. Each child copy must be attached by studs, must rest on something
 * (another unit or the ground), and copies must not interlock (A sits on B and
 * B sits on A), because each copy is placed as one piece.
 */
function joinChecks(model: BrickModel, v: ValidationResult, instances: CompiledInstance[], origin: number[]) {
  const errors: Issue[] = [];
  const detachedParts = new Set<number>();

  // For each part, its chain of copies from outermost to innermost.
  const chain = (p: number): number[] => {
    const out: number[] = [];
    for (let i = origin[p]; i >= 0; i = instances[i].parent) out.unshift(i);
    return out;
  };
  const chains = model.parts.map((_, p) => chain(p));

  // Containers: -1 (main) and every instance. Unit of part p inside container c:
  // the child copy of c that contains p, or the part itself (as "p<index>").
  const containers = [-1, ...instances.map((i) => i.index)];
  for (const c of containers) {
    const depth = c < 0 ? 0 : instances[c].depth;
    const inC = (p: number) => c < 0 || chains[p][depth - 1] === c;
    const unitOf = (p: number) => (chains[p].length > depth ? `i${chains[p][depth]}` : `p${p}`);
    const childCopies = instances.filter((i) => i.parent === c);
    if (!childCopies.length) continue;

    const out = new Map<string, Set<string>>();
    const incoming = new Map<string, number>();
    const touched = new Set<string>();
    for (const e of v.connections) {
      if (!inC(e.lower) || !inC(e.upper)) continue;
      const a = unitOf(e.lower), b = unitOf(e.upper);
      if (a === b) continue;
      touched.add(a).add(b);
      if (!out.has(a)) out.set(a, new Set());
      if (!out.get(a)!.has(b)) {
        out.get(a)!.add(b);
        incoming.set(b, (incoming.get(b) ?? 0) + 1);
      }
    }
    const siblings = childCopies.length + model.parts.filter((_, p) => inC(p) && chains[p].length === depth).length;

    for (const inst of childCopies) {
      const u = `i${inst.index}`;
      const minY = Math.min(...inst.parts.map((p) => model.parts[p].y));
      if (!touched.has(u) && siblings > 1) {
        errors.push(err("DETACHED_SUBBUILD", `${inst.path} isn't attached to the rest of ${c < 0 ? "the model" : instances[c].path} by any stud. Move it so its bottom sits on studs (or put something on its top studs).`, inst.parts));
        inst.parts.forEach((p) => detachedParts.add(p));
      } else if (touched.has(u) && !incoming.get(u) && minY > (c < 0 ? 0 : Math.min(...instances[c].parts.map((p) => model.parts[p].y)))) {
        errors.push(err("SUBBUILD_UNSUPPORTED", `${inst.path} doesn't rest on anything: nothing below holds it, only parts above. Each copy is placed as one piece, so its bottom must sit on studs or on the ground.`, inst.parts));
      }
    }

    // Interlocking: strongly connected groups of 2+ units.
    for (const group of sccs(out)) {
      if (group.length < 2) continue;
      const names = group.map((u) => (u.startsWith("i") ? instances[Number(u.slice(1))].path : `part #${u.slice(1)}`));
      const parts = group.flatMap((u) => (u.startsWith("i") ? instances[Number(u.slice(1))].parts : [Number(u.slice(1))]));
      errors.push(err("INTERLOCKED", `${names.slice(0, 4).join(", ")}${names.length > 4 ? ", …" : ""} interlock: each sits on studs of another, so they can't be placed one after the other. Merge them into one sub-build or separate their layers.`, parts));
    }
  }

  // A fully detached copy is already reported above; drop the validator's generic duplicates.
  const suppress = (e: Issue) => (e.code === "DISCONNECTED" || e.code === "FLOATING") && e.parts.length > 0 && e.parts.every((p) => detachedParts.has(p));
  return { errors, suppress };
}

/** Tarjan's strongly connected components (recursive; units per level stay in the low thousands). */
function sccs(graph: Map<string, Set<string>>): string[][] {
  let index = 0;
  const idx = new Map<string, number>(), low = new Map<string, number>(), on = new Set<string>(), stack: string[] = [], out: string[][] = [];
  const nodes = new Set<string>([...graph.keys(), ...[...graph.values()].flatMap((s) => [...s])]);
  const visit = (v: string) => {
    idx.set(v, index);
    low.set(v, index++);
    stack.push(v);
    on.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!idx.has(w)) (visit(w), low.set(v, Math.min(low.get(v)!, low.get(w)!)));
      else if (on.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const g: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        on.delete(w);
        g.push(w);
      } while (w !== v);
      out.push(g);
    }
  };
  for (const n of nodes) if (!idx.has(n)) visit(n);
  return out;
}

/** Compile one sub-build on its own (at the origin), for its standalone repair loop. */
export function compileSubBuild(design: BrickDesign, id: string, opts: CompileOptions = {}): CompileResult {
  return compileDesign({ ...design, main: { parts: [], uses: [{ sub: id, x: 0, y: 0, z: 0, rot: 0 }] } }, opts);
}
