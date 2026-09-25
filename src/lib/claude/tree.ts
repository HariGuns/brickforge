import { CONFIG } from "../config";
import { SUB_ID } from "../design/schema";
import type { Plan, PlannedSubBuild, TreeContext } from "../prompts/subbuilds";
import type { ChildPlan } from "../prompts/tree";
import type { Issue } from "../validate/validator";
import { invalidOutput } from "./generate";

/**
 * The planned tree of a sub-build run: every unique sub-build once, where its
 * copies go (the main build or split sub-builds), and the child plans of the
 * split ones. Planning goes level by level (see generateDesign); a flat plan is
 * a tree with no split sub-builds.
 */

export interface TreeNode extends PlannedSubBuild {
  /** 1 = placed by the main build. A shared sub-build keeps the depth it was first planned at. */
  depth: number;
  /** Where copies are placed: "main" or a split sub-build's id, with copies per copy of it. */
  uses: { parent: string; copies: number }[];
  /** The child plan, once a split sub-build has been planned. */
  child?: ChildPlan;
}

/** A library component a planner may reuse (see components/library.ts). */
export interface LibraryRef {
  id: string;
  w: number;
  d: number;
  h: number;
  parts: number;
  /** Levels of sub-builds inside it (a plain component is 1). */
  depth: number;
}

export const isLibrary = (from: string | undefined): boolean => !!from?.startsWith("library:");
export const libraryId = (from: string | undefined): string => (from ?? "").slice("library:".length);

export class PlanTree {
  readonly nodes = new Map<string, TreeNode>();

  constructor(readonly plan: Plan) {
    for (const s of plan.subBuilds) this.nodes.set(s.id, { ...s, split: !!s.split && !isLibrary(s.from), depth: 1, uses: [{ parent: "main", copies: s.copies }] });
  }

  get(id: string): TreeNode {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`No planned sub-build "${id}".`);
    return n;
  }

  /** Copies of a sub-build in the whole model. */
  totalCopies(id: string): number {
    const n = this.nodes.get(id);
    if (!n) return 0;
    return n.uses.reduce((sum, u) => sum + u.copies * (u.parent === "main" ? 1 : this.totalCopies(u.parent)), 0);
  }

  /** All copies in the whole model. */
  copies(): number {
    return [...this.nodes.keys()].reduce((n, id) => n + this.totalCopies(id), 0);
  }

  /** Split sub-builds still waiting for their child plan, at a depth. */
  unplanned(depth: number): TreeNode[] {
    return [...this.nodes.values()].filter((n) => n.split && !n.child && n.depth === depth);
  }

  /** Sub-builds designed directly (not split, not from the library). */
  leaves(): TreeNode[] {
    return [...this.nodes.values()].filter((n) => !n.split && !isLibrary(n.from));
  }

  /** Split sub-builds, deepest first (each one's children are ready before it's assembled). */
  splits(): TreeNode[] {
    return [...this.nodes.values()].filter((n) => n.split).sort((a, b) => b.depth - a.depth);
  }

  /** The children a split sub-build places, as planned (shared ones resolved to their node). */
  childrenOf(id: string): TreeNode[] {
    return [...this.nodes.values()].filter((n) => n.uses.some((u) => u.parent === id));
  }

  /** The chain of split sub-builds above a node (outermost first), and its siblings, for prompts. */
  context(id: string): TreeContext | undefined {
    const n = this.get(id);
    const parentId = n.uses[0].parent;
    if (parentId === "main") return undefined;
    const path: TreeContext["path"] = [];
    for (let p: string = parentId; p !== "main"; p = this.get(p).uses[0].parent) {
      const pn = this.get(p);
      path.unshift({ name: pn.name, purpose: pn.purpose, layout: pn.child?.layout ?? "" });
    }
    const siblings = this.childrenOf(parentId).map((c) => ({ ...c, copies: c.uses.find((u) => u.parent === parentId)!.copies }));
    return { path, siblings };
  }

  /** Levels of sub-builds below the main build. */
  depth(): number {
    return Math.max(0, ...[...this.nodes.values()].map((n) => n.depth));
  }

  /**
   * Add the checked child plans of one level. New children are added; a child
   * that repeats an id already planned (from: "shared", or the same id in two
   * plans of this level with the same size) becomes another use of that
   * sub-build; a clashing id with a different size is renamed.
   */
  addLevel(plans: { parent: string; child: ChildPlan }[]) {
    for (const { parent, child } of plans) {
      const pn = this.get(parent);
      pn.child = child;
      for (const c of child.children) {
        const existing = this.nodes.get(c.id);
        if (existing && sameSize(existing, c) && !existing.split && !c.split && !isLibrary(c.from) && !isLibrary(existing.from)) {
          existing.uses.push({ parent, copies: c.copies });
          continue;
        }
        let id = c.id;
        for (let k = 2; this.nodes.has(id); k++) id = `${c.id.slice(0, 44)}_${k}`;
        if (id !== c.id) c.id = id; // the child plan's layout text keeps the old id; the assembly sees the new one
        this.nodes.set(id, { ...c, split: !!c.split && !isLibrary(c.from), depth: pn.depth + 1, uses: [{ parent, copies: c.copies }] });
      }
    }
  }
}

const sameSize = (a: PlannedSubBuild, b: PlannedSubBuild) => a.w === b.w && a.d === b.d && a.h === b.h && !!a.sideways === !!b.sideways;

/** Checks shared by the top plan and child plans: a library reference, and the split rules. */
function checkEntry(b: PlannedSubBuild, depth: number, library: Map<string, LibraryRef>, bad: (m: string) => void) {
  const t = CONFIG.tree;
  if (isLibrary(b.from)) {
    const ref = library.get(libraryId(b.from));
    if (!ref) return bad(`${b.id}: "${b.from}" isn't in the component library. Use one of the listed ids, or from: "new".`);
    if (depth - 1 + ref.depth > CONFIG.design.maxDepth) bad(`${b.id}: ${b.from} has ${ref.depth} levels inside; it can't go ${depth} levels deep.`);
    for (const r of b.recolor ?? []) if (!/^[a-z_]+>[a-z_]+$/.test(r)) bad(`${b.id}: recolor "${r}" must look like "red>blue".`);
    return;
  }
  if (b.from && b.from !== "new" && b.from !== "shared") bad(`${b.id}: from must be "new", "shared" or "library:<id>" (got "${b.from}").`);
  if (b.split) {
    if (depth >= t.maxDepth) bad(`${b.id}: sub-builds ${depth} levels deep can't be split further (at most ${t.maxDepth} levels); design it directly (split: false).`);
    if (b.sideways) bad(`${b.id}: a sideways panel can't be split; design it directly.`);
    if (b.parts > t.maxSplitParts) bad(`${b.id}: a split sub-build's part budget is at most ${t.maxSplitParts} (you planned ${b.parts}).`);
  } else if (b.parts > CONFIG.subbuilds.maxSubParts) bad(`${b.id}: part budget ${b.parts} must be at most ${CONFIG.subbuilds.maxSubParts}; split it (split: true) or make it simpler.`);
}

/** Top-plan checks for tree mode and library references (on top of checkPlan's limits). */
export function checkTreePlan(plan: Plan, library: Map<string, LibraryRef>): Issue[] {
  const out: Issue[] = [];
  const bad = (m: string) => out.push(invalidOutput(m));
  for (const b of plan.subBuilds) {
    if (b.from === "shared") bad(`${b.id}: from: "shared" is only for child plans; use "new" here.`);
    checkEntry(b, 1, library, bad);
  }
  return out;
}

/**
 * Check a split sub-build's child plan against what the whole tree may still
 * add (`uniqueLeft` new unique sub-builds, `copiesLeft` copies).
 */
export function checkChildPlan(tree: PlanTree, parent: TreeNode, child: ChildPlan, o: { library: Map<string, LibraryRef>; uniqueLeft: number; copiesLeft: number }): Issue[] {
  const t = CONFIG.tree;
  const out: Issue[] = [];
  const bad = (m: string) => out.push(invalidOutput(m));
  if (!child.children.length) bad("Plan at least one child sub-build.");
  if (child.children.length > t.maxChildren) bad(`Use at most ${t.maxChildren} child sub-builds (you planned ${child.children.length}).`);
  const ids = new Set<string>();
  let fresh = 0;
  for (const c of child.children) {
    if (!SUB_ID.test(c.id)) bad(`Sub-build id "${c.id}" must be lowercase letters, digits and _, starting with a letter.`);
    if (ids.has(c.id)) bad(`Sub-build id "${c.id}" is used twice.`);
    ids.add(c.id);
    if (c.id === parent.id) bad(`${c.id}: a child can't have its parent's id.`);
    if (c.w < 1 || c.d < 1 || c.w > parent.w || c.d > parent.d) bad(`${c.id}: footprint ${c.w}×${c.d} must fit inside the parent's ${parent.w}×${parent.d}.`);
    if (c.h < 1 || c.h > parent.h) bad(`${c.id}: height ${c.h} plates must be between 1 and the parent's ${parent.h}.`);
    if (c.parts < 1) bad(`${c.id}: plan at least one part.`);
    if (c.copies < 1) bad(`${c.id}: plan at least one copy.`);
    if (c.sideways && c.h > 6) bad(`${c.id}: a sideways panel is at most 6 plates thick (you planned ${c.h}); its face is w × d.`);
    if (c.from === "shared") {
      const ex = tree.nodes.get(c.id);
      if (!ex) bad(`${c.id}: from: "shared" needs the id of a sub-build already planned in this model (listed); use from: "new" for a new one.`);
      else if (ex.split || isLibrary(ex.from)) bad(`${c.id}: only sub-builds designed directly can be shared; plan a new one.`);
      else if (!sameSize(ex, c)) bad(`${c.id}: a shared sub-build keeps its size ${ex.w} × ${ex.d} × ${ex.h}.`);
      else if (ex.w > parent.w || ex.d > parent.d || ex.h > parent.h) bad(`${c.id}: the shared sub-build doesn't fit inside ${parent.id}.`);
      else if (c.split) bad(`${c.id}: a shared sub-build isn't split.`);
      continue;
    }
    const ex = tree.nodes.get(c.id);
    if (ex && !(sameSize(ex, c) && !ex.split && !c.split && !isLibrary(c.from) && !isLibrary(ex.from))) bad(`${c.id}: that id is already used by a different sub-build in this model; pick another id (or from: "shared" with its size to reuse it).`);
    if (!ex) fresh++;
    checkEntry(c, parent.depth + 1, o.library, bad);
  }
  const budget = child.children.reduce((n, c) => n + c.parts * c.copies, 0);
  if (budget > parent.parts) bad(`Parts × copies over the children add up to ${budget}; keep it within ${parent.id}'s budget of ${parent.parts}.`);
  if (fresh > o.uniqueLeft) bad(`That's ${fresh} new unique sub-builds; this part of the model can add at most ${o.uniqueLeft}. Share or reuse more, or split less.`);
  const copies = child.children.reduce((n, c) => n + c.copies, 0) * tree.totalCopies(parent.id);
  if (copies > o.copiesLeft) bad(`${parent.id} has ${tree.totalCopies(parent.id)} copies in the model, so these children add ${copies} copies; at most ${o.copiesLeft} are left. Use fewer copies or bigger children.`);
  return out;
}
