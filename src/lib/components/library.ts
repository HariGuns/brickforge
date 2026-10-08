import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CONFIG } from "../config";
import { compileSubBuild } from "../design/compile";
import { SubBuildSchema, type BrickDesign, type SubBuild } from "../design/schema";
import { surfaceMaps } from "../design/surface";
import { getPart } from "../parts/library";
import { COLOR_MAP } from "../parts/colors";
import { seedLibrary } from "./seed";
import { placementCheck } from "./placement";

/**
 * Component library: every valid sub-build saved as a reusable component, with
 * a name, size, tags and connection points (its top studs, underside and side
 * studs). Planners are offered the components that match what they're
 * planning, and reuse one with from: "library:<id>" instead of designing it.
 * One JSON file per component in CONFIG.componentsDir.
 */

export const ComponentSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  /** Footprint (studs) and height (plates) of one copy; for a sideways panel w × d is its face. */
  size: z.object({ w: z.number(), d: z.number(), h: z.number() }),
  parts: z.number(),
  /** Levels of sub-builds, the component itself included (1 = no sub-builds inside). */
  depth: z.number(),
  colors: z.array(z.string()),
  sideways: z.boolean(),
  /** Connection points: top surface and studs by height, underside, side studs. */
  connections: z.object({ top: z.array(z.string()), bottom: z.array(z.string()), studsByHeight: z.array(z.string()), sideStuds: z.number() }),
  /** The component's own sub-build id in `subBuilds`, which holds it and everything inside it. */
  root: z.string(),
  subBuilds: z.array(SubBuildSchema),
  /** Content hash of the sub-build tree (ids don't matter), to skip duplicates. */
  hash: z.string(),
  source: z.object({ run: z.string().optional(), request: z.string().optional(), at: z.string() }),
  /** What designing it cost (its own stages and everything inside it, once), USD. */
  cost: z.number(),
  /** How many runs reused it. */
  reused: z.number(),
});
export type Component = z.infer<typeof ComponentSchema>;

export interface Library {
  dir: string;
  components: Component[];
  byId: Map<string, Component>;
}

const STOP = new Set("a an and the of with for on in at to its it is as by from one two three four five six small large big little tiny sub build builds piece part parts simulated model".split(" "));

/** Search words: lowercase, singular, no stop words. */
export function words(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[a-z]+/g) ?? []).map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)).filter((w) => w.length > 2 && !STOP.has(w)))];
}

/** A sub-build and everything inside it, from a list of sub-builds. */
export function subtreeOf(subBuilds: SubBuild[], root: string): SubBuild[] {
  const byId = new Map(subBuilds.map((s) => [s.id, s]));
  const out = new Map<string, SubBuild>();
  const walk = (id: string) => {
    const s = byId.get(id);
    if (!s || out.has(id)) return;
    out.set(id, s);
    s.uses.forEach((u) => walk(u.sub));
  };
  walk(root);
  return [...out.values()];
}

/** The subtree with ids replaced by their order of first appearance (root = s0), for hashing and comparing. */
function canonical(subBuilds: SubBuild[], root: string): string {
  const byId = new Map(subBuilds.map((s) => [s.id, s]));
  const names = new Map<string, string>();
  const order: SubBuild[] = [];
  const walk = (id: string) => {
    if (names.has(id)) return;
    const s = byId.get(id);
    if (!s) return;
    names.set(id, `s${names.size}`);
    order.push(s);
    s.uses.forEach((u) => walk(u.sub));
  };
  walk(root);
  return JSON.stringify(order.map((s) => ({ parts: s.parts, uses: s.uses.map((u) => ({ ...u, sub: names.get(u.sub) })) })));
}

export const contentHash = (subBuilds: SubBuild[], root: string) => crypto.createHash("sha1").update(canonical(subBuilds, root)).digest("hex").slice(0, 12);

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(?=[0-9])/, "c_").slice(0, 32) || "component";

/**
 * A component from a sub-build (and everything inside it), or null if it isn't
 * valid on its own. `context` adds tags (its parents, the model, the request).
 */
export function makeComponent(
  subBuilds: SubBuild[],
  root: string,
  meta: { description?: string; context?: string[]; sideways?: boolean; cost?: number; run?: string; request?: string; rejected?: (why: string) => void },
): Component | null {
  const tree = subtreeOf(subBuilds, root);
  const me = tree.find((s) => s.id === root);
  if (!me) return null;
  const design: BrickDesign = { name: me.name, description: "", subBuilds: tree, main: { parts: [], uses: [] } };
  const c = compileSubBuild(design, root, { structure: "warn" });
  if (c.errors.length || !c.model.parts.length) return null;
  // Gate: it must also hold when placed on studs, not only standing on its own (see placement.ts).
  if (!meta.sideways) {
    const placed = placementCheck(c.model);
    if (placed.errors.length) {
      meta.rejected?.(`fails when placed: ${placed.errors.map((e) => e.code).join(", ")} (${placed.errors[0].message.slice(0, 160)})`);
      return null;
    }
  }
  const maps = surfaceMaps(c.model);
  const depthOf = (n: { children: unknown[] }): number => 1 + Math.max(0, ...n.children.map((x) => depthOf(x as { children: unknown[] })));
  const hash = contentHash(tree, root);
  const colors = [...new Set(c.model.parts.map((p) => p.color))];
  const sideStuds = c.model.parts.reduce((n, p) => n + (getPart(p.part)?.sideStuds?.length ?? 0), 0);
  return {
    id: `${slug(me.name)}_${hash.slice(0, 6)}`,
    name: me.name,
    description: meta.description ?? "",
    tags: words([me.name, root.replace(/_/g, " "), meta.description ?? "", ...(meta.context ?? [])].join(" ")).slice(0, 16),
    size: { w: maps.w, d: maps.d, h: maps.h },
    parts: c.model.parts.length,
    depth: depthOf(c.tree) - 1,
    colors,
    sideways: !!meta.sideways,
    connections: { top: maps.top, bottom: maps.bottom, studsByHeight: maps.studsByHeight, sideStuds },
    root,
    subBuilds: tree,
    hash,
    source: { ...(meta.run ? { run: meta.run } : {}), ...(meta.request ? { request: meta.request } : {}), at: new Date().toISOString() },
    cost: Math.round((meta.cost ?? 0) * 10000) / 10000,
    reused: 0,
  };
}

/**
 * Load a library folder. The default folder seeds itself from the data
 * folder's runs and saved builds the first time (e.g. runs copied into the
 * desktop app); an explicit folder is used as it is.
 */
export function loadLibrary(dir?: string): Library {
  const d = dir ?? CONFIG.componentsDir;
  if (!dir && !fs.existsSync(d)) {
    fs.mkdirSync(d, { recursive: true });
    seedLibrary({ dir: d });
  }
  const components: Component[] = [];
  let files: string[] = [];
  try {
    files = fs.readdirSync(d).filter((f) => f.endsWith(".json"));
  } catch {
    // no library yet
  }
  for (const f of files) {
    try {
      const r = ComponentSchema.safeParse(JSON.parse(fs.readFileSync(path.join(/*turbopackIgnore: true*/ d, f), "utf8")));
      if (r.success) components.push(r.data);
    } catch {
      // skip unreadable files
    }
  }
  components.sort((a, b) => a.id.localeCompare(b.id));
  return { dir: d, components, byId: new Map(components.map((c) => [c.id, c])) };
}

/** Save a component unless one with the same content is already there. Returns the saved or existing one. */
export function saveComponent(lib: Library, c: Component): { component: Component; added: boolean } {
  const same = lib.components.find((x) => x.hash === c.hash);
  if (same) return { component: same, added: false };
  fs.mkdirSync(lib.dir, { recursive: true });
  fs.writeFileSync(path.join(/*turbopackIgnore: true*/ lib.dir, `${c.id}.json`), JSON.stringify(c, null, 1));
  lib.components.push(c);
  lib.byId.set(c.id, c);
  return { component: c, added: true };
}

/** Count a reuse (written back to its file). */
export function markReused(lib: Library, id: string) {
  const c = lib.byId.get(id);
  if (!c) return;
  c.reused++;
  try {
    fs.writeFileSync(path.join(/*turbopackIgnore: true*/ lib.dir, `${c.id}.json`), JSON.stringify(c, null, 1));
  } catch {
    // counting is best effort
  }
}

/**
 * Components that match a query (name and tag words) and fit inside an
 * envelope, best first. Name matches count most.
 */
export function searchLibrary(lib: Library, query: string, fit: { w: number; d: number; h: number }, limit = CONFIG.library.offer): Component[] {
  const q = words(query);
  if (!q.length) return [];
  const scored = lib.components
    .filter((c) => (c.size.w <= fit.w && c.size.d <= fit.d) || (c.size.d <= fit.w && c.size.w <= fit.d))
    .filter((c) => c.size.h <= fit.h)
    .map((c) => {
      const name = new Set(words(c.name));
      const tags = new Set(c.tags);
      const score = q.reduce((s, w) => s + (name.has(w) ? 3 : tags.has(w) ? 1 : 0), 0);
      return { c, score };
    })
    .filter((x) => x.score > 0);
  // Ties: the one that saves most (bigger, costlier components), then the most reused.
  scored.sort((a, b) => b.score - a.score || b.c.cost - a.c.cost || b.c.parts - a.c.parts || b.c.reused - a.c.reused || a.c.id.localeCompare(b.c.id));
  return scored.slice(0, limit).map((x) => x.c);
}

/** One listing line per component, for a planner's prompt. */
export function libraryListing(cs: Component[]): string[] {
  return cs.map(
    (c) =>
      `- library:${c.id} "${c.name}": ${c.size.w} × ${c.size.d} × ${c.size.h}, ${c.parts} parts, ${c.colors.slice(0, 4).join("/")}${c.depth > 1 ? `, ${c.depth - 1} level${c.depth > 2 ? "s" : ""} of sub-builds inside` : ""}${c.sideways ? ", sideways panel" : ""} — ${c.description || c.tags.slice(0, 8).join(", ")}`,
  );
}

/** Apply "red>blue" colour swaps to a list of sub-builds. */
function recolorAll(subBuilds: SubBuild[], recolor: string[]): SubBuild[] {
  const map = new Map(recolor.map((r) => r.split(">") as [string, string]).filter(([a, b]) => a && COLOR_MAP.has(b)));
  if (!map.size) return subBuilds;
  return subBuilds.map((s) => ({ ...s, parts: s.parts.map((p) => (map.has(p.color) ? { ...p, color: map.get(p.color)! } : p)) }));
}

/**
 * The sub-builds that put a component into a design as sub-build `asId`
 * (recoloured if asked). Sub-builds inside it get fresh ids (not in the design
 * or `reserved`), except where an identical sub-build is already in the
 * design, which is reused.
 */
export function importComponent(c: Component, asId: string, recolor: string[], existing: SubBuild[], reserved: string[] = []): SubBuild[] {
  const tree = recolorAll(c.subBuilds, recolor);
  const taken = new Set([...existing.map((s) => s.id), ...reserved]);
  const ids = new Map<string, string>([[c.root, asId]]);
  taken.add(asId);
  const out: SubBuild[] = [];
  const hashOf = (list: SubBuild[], id: string) => contentHash(list, id);
  const known = new Map(existing.map((s) => [hashOf(existing, s.id), s.id]));
  // Children before parents, so a sub-build's children already have their design ids when it's compared.
  for (const s of tree.slice().reverse()) {
    if (s.id === c.root) continue;
    const renamed = { ...s, id: "__import__", uses: s.uses.map((u) => ({ ...u, sub: ids.get(u.sub) ?? u.sub })) };
    const hash = hashOf([...existing, ...out, renamed], renamed.id);
    const same = known.get(hash);
    if (same) {
      ids.set(s.id, same);
      continue;
    }
    let id = s.id;
    for (let k = 2; taken.has(id); k++) id = `${s.id.slice(0, 44)}_${k}`;
    taken.add(id);
    ids.set(s.id, id);
    out.push({ ...renamed, id });
    known.set(hash, id);
  }
  const root = tree.find((s) => s.id === c.root)!;
  out.push({ ...root, id: asId, uses: root.uses.map((u) => ({ ...u, sub: ids.get(u.sub) ?? u.sub })) });
  return out;
}
