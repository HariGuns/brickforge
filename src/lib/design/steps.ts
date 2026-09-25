import type { BrickModel } from "../model/schema";
import { hangers, type BuildStep } from "../steps/steps";
import { compileDesign, compileSubBuild, type CompileResult } from "./compile";
import type { BrickDesign } from "./schema";
import { getPart } from "../parts/library";

/**
 * Build steps for a design, like printed manuals: each unique sub-build is
 * built on its own first (deepest first), then the main build, where a
 * sub-build copy goes on in a single step. Within a container (a sub-build or
 * the main build) the units are its own parts and its direct child copies,
 * layered by the height of their bottoms, so everything sits on something
 * already placed.
 */

export interface CopyItem {
  /** Sub-build id, with "~m" for mirrored copies (they're a different build: see variantKey). */
  sub: string;
  name: string;
  count: number;
}

export interface DesignStep extends BuildStep {
  /** Container's own parts added in this step (for the parts callout). */
  ownParts: number[];
  /** Child copies added in this step, grouped by sub-build. */
  copies: CopyItem[];
}

/** Section / copy key: the sub-build id, plus "~m" for its mirror image. */
export const variantKey = (sub: string, mirror: boolean) => (mirror ? `${sub}~m` : sub);

export interface StepSection {
  /** Sub-build id ("~m" suffix for its mirror image), or null for the main build. */
  sub: string | null;
  /** "Pine tree" or the model's name for the main build. */
  name: string;
  /** Copies of this sub-build in the whole model (1 for the main build). */
  copies: number;
  /** The model the pages render: the sub-build on its own, or the whole model. */
  model: BrickModel;
  steps: DesignStep[];
}

export interface DesignSteps {
  sections: StepSection[];
  /** Main-build steps as plain part-index steps, for playback on the whole model. */
  mainSteps: DesignStep[];
  compiled: CompileResult;
}

const MAX_PARTS_PER_STEP = 6;
const MAX_COPIES_PER_STEP = 4;

/** Steps for one container, given its compiled model and the copies directly inside it. */
function containerSteps(model: BrickModel, compiled: CompileResult, parent: number): DesignStep[] {
  const units: { y: number; z: number; x: number; parts: number[]; copy?: { sub: string; name: string } }[] = [];
  model.parts.forEach((p, i) => {
    if (compiled.origin[i] === parent) units.push({ y: p.y, z: p.z, x: p.x, parts: [i] });
  });
  for (const inst of compiled.instances.filter((c) => c.parent === parent)) {
    const ps = inst.parts.map((i) => model.parts[i]);
    units.push({
      y: Math.min(...ps.map((p) => p.y)),
      z: Math.min(...ps.map((p) => p.z)),
      x: Math.min(...ps.map((p) => p.x)),
      parts: inst.parts,
      copy: { sub: variantKey(inst.sub, inst.mirror), name: `${inst.name}${inst.mirror ? " (mirrored)" : ""}` },
    });
  }
  // Wheel holders hanging under a part go on with that part (same step): merge them into its unit,
  // or into its layer if it's inside a copy.
  const hang = hangers(model, compiled.validation?.connections ?? []);
  for (const [h, upper] of hang) {
    const hu = units.findIndex((u) => !u.copy && u.parts.length === 1 && u.parts[0] === h);
    const uu = units.find((u) => u.parts.includes(upper));
    if (hu < 0 || !uu) continue;
    if (uu.copy) units[hu].y = uu.y;
    else (uu.parts.push(h), units.splice(hu, 1));
  }
  // Wheels go on last, after the holders they hang from.
  const isWheel = (u: (typeof units)[number]) => (!u.copy && u.parts.length === 1 && !!getPart(model.parts[u.parts[0]].part)?.hub) || u.parts.some((i) => model.parts[i].frame);
  units.sort((a, b) => Number(isWheel(a)) - Number(isWheel(b)) || a.y - b.y || a.z - b.z || a.x - b.x);

  const steps: DesignStep[] = [];
  const push = (y: number, group: typeof units) => {
    const copies = new Map<string, CopyItem>();
    for (const u of group) if (u.copy) (copies.get(u.copy.sub) ?? copies.set(u.copy.sub, { sub: u.copy.sub, name: u.copy.name, count: 0 }).get(u.copy.sub)!).count++;
    steps.push({ n: 0, y, parts: group.flatMap((u) => u.parts), ownParts: group.filter((u) => !u.copy).flatMap((u) => u.parts), copies: [...copies.values()] });
  };
  // Per layer: copies of the same sub-build together (up to 4 per step), loose parts in balanced chunks.
  const layerOf = (u: (typeof units)[number]) => (isWheel(u) ? Infinity : u.y);
  const ys = [...new Set(units.map(layerOf))];
  for (const ly of ys) {
    const layer = units.filter((u) => layerOf(u) === ly);
    const y = ly === Infinity ? Math.min(...layer.map((u) => u.y)) : ly;
    const bySub = new Map<string, typeof units>();
    for (const u of layer.filter((u) => u.copy)) (bySub.get(u.copy!.sub) ?? bySub.set(u.copy!.sub, []).get(u.copy!.sub)!).push(u);
    for (const group of bySub.values()) for (let i = 0; i < group.length; i += MAX_COPIES_PER_STEP) push(y, group.slice(i, i + MAX_COPIES_PER_STEP));
    const loose = layer.filter((u) => !u.copy);
    if (loose.length) {
      const size = Math.ceil(loose.length / Math.ceil(loose.length / MAX_PARTS_PER_STEP));
      for (let i = 0; i < loose.length; i += size) push(y, loose.slice(i, i + size));
    }
  }
  return steps;
}

/** Sub-builds in build order: children before the sub-builds that use them, then by first use. */
function buildOrder(design: BrickDesign, compiled: CompileResult): string[] {
  const used = new Set(compiled.subBuilds.map((s) => s.id));
  const byId = new Map(design.subBuilds.map((s) => [s.id, s]));
  const order: string[] = [];
  const visit = (id: string, seen: Set<string>) => {
    if (order.includes(id) || seen.has(id) || !used.has(id)) return;
    seen.add(id);
    for (const u of byId.get(id)?.uses ?? []) visit(u.sub, seen);
    order.push(id);
  };
  for (const u of design.main.uses) visit(u.sub, new Set());
  return order;
}

export function designSteps(design: BrickDesign, compiled: CompileResult = compileDesign(design)): DesignSteps {
  const sections: StepSection[] = [];
  for (const id of buildOrder(design, compiled)) {
    const info = compiled.subBuilds.find((s) => s.id === id)!;
    // A sub-build and its mirror image (if any copies are mirrored) are built separately.
    for (const mirror of [false, true]) {
      const copies = compiled.instances.filter((c) => c.sub === id && c.mirror === mirror).length;
      if (!copies) continue;
      const alone = compileSubBuild(design, id, { structure: "off", mirror });
      // The sub-build alone is one copy at index 0; its container is that copy.
      sections.push({ sub: variantKey(id, mirror), name: `${info.name}${mirror ? " (mirrored)" : ""}`, copies, model: alone.model, steps: containerSteps(alone.model, alone, 0) });
    }
  }
  const mainSteps = containerSteps(compiled.model, compiled, -1);
  sections.push({ sub: null, name: design.name, copies: 1, model: compiled.model, steps: mainSteps });

  let n = 1;
  for (const s of sections) for (const st of s.steps) st.n = n++;
  // Playback numbers the main steps on their own.
  const playback = mainSteps.map((st, i) => ({ ...st, n: i + 1 }));
  return { sections, mainSteps: playback, compiled };
}
