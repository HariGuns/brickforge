import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "../config";
import { BrickDesignSchema, type SubBuild } from "../design/schema";
import { BrickModelSchema } from "../model/schema";
import { loadLibrary, makeComponent, saveComponent, subtreeOf, type Library } from "./library";

/**
 * Seed the component library from what's already there: the valid sub-builds
 * of every generation run (their sub-build rounds that passed, and the final
 * design) and of every saved build. Invalid ones are skipped, duplicates are
 * saved once. `npm run seed-components`; the default library also seeds itself
 * the first time it's used.
 */

export interface SeedReport {
  runs: number;
  builds: number;
  found: number;
  added: number;
  duplicates: number;
  invalid: number;
  /** Why candidates were skipped, first few. */
  skipped: string[];
}

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};
const list = (dir: string) => {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
};

interface Candidate {
  subBuilds: SubBuild[];
  root: string;
  description?: string;
  context: string[];
  sideways?: boolean;
  cost: number;
  run?: string;
  request?: string;
}

/** Cost of a run's stages, by debug-file prefix. */
function stageCost(dir: string, files: string[], prefix: string): number {
  return files
    .filter((f) => f.startsWith(prefix) && f.endsWith(".validation.json"))
    .reduce((sum, f) => sum + (((readJson(path.join(/*turbopackIgnore: true*/ dir, f)) as { summary?: { usage?: { cost?: number } } } | null)?.summary?.usage?.cost) ?? 0), 0);
}

function fromRun(dir: string): Candidate[] {
  const files = list(dir);
  const input = readJson(path.join(/*turbopackIgnore: true*/ dir, "input.json")) as { text?: string | null } | null;
  const request = input?.text ?? undefined;
  // What the plans said about each sub-build (top plan and a tree's nodes).
  type Info = { name?: string; purpose?: string; sideways?: boolean };
  const info = new Map<string, Info>();
  const plan = readJson(path.join(/*turbopackIgnore: true*/ dir, "plan.json")) as { name?: string; subBuilds?: ({ id: string } & Info)[] } | null;
  for (const s of plan?.subBuilds ?? []) info.set(s.id, s);
  const tree = readJson(path.join(/*turbopackIgnore: true*/ dir, "tree.json")) as { nodes?: ({ id: string } & Info)[] } | null;
  for (const s of tree?.nodes ?? []) info.set(s.id, s);
  const context = [plan?.name ?? "", request ?? ""];
  const out: Candidate[] = [];
  const costOf = (subBuilds: SubBuild[], root: string) => subtreeOf(subBuilds, root).reduce((n, s) => n + stageCost(dir, files, `sub-${s.id}.`) + stageCost(dir, files, `asm-${s.id}.`) + stageCost(dir, files, `plan-${s.id}.`), 0);

  // Sub-builds designed directly: the last round that passed.
  for (const f of files) {
    const m = f.match(/^sub-([a-z][a-z0-9_]*)\.round-(\d+)\.validation\.json$/);
    if (!m) continue;
    const v = readJson(path.join(/*turbopackIgnore: true*/ dir, f)) as { errors?: unknown[] } | null;
    if (!v || v.errors?.length) continue;
    const later = files.some((g) => {
      const n = g.match(new RegExp(`^sub-${m[1]}\\.round-(\\d+)\\.validation\\.json$`));
      return n && Number(n[1]) > Number(m[2]) && !((readJson(path.join(/*turbopackIgnore: true*/ dir, g)) as { errors?: unknown[] } | null)?.errors?.length);
    });
    if (later) continue;
    const model = BrickModelSchema.safeParse(readJson(path.join(/*turbopackIgnore: true*/ dir, `sub-${m[1]}.round-${m[2]}.model.json`)));
    if (!model.success) continue;
    const i = info.get(m[1]);
    const sub: SubBuild = { id: m[1], name: i?.name ?? model.data.name, parts: model.data.parts, uses: [] };
    out.push({ subBuilds: [sub], root: sub.id, description: i?.purpose, context, sideways: i?.sideways, cost: stageCost(dir, files, `sub-${m[1]}.`), run: path.basename(dir), request });
  }
  // Every sub-build of the final design (split ones, and ones changed by edits or the photo comparison).
  const design = BrickDesignSchema.safeParse(readJson(path.join(/*turbopackIgnore: true*/ dir, "final-design.json")));
  if (design.success) {
    const mounted = new Set([...design.data.main.uses, ...design.data.subBuilds.flatMap((s) => s.uses)].filter((u) => u.mount).map((u) => u.sub));
    for (const s of design.data.subBuilds) {
      const i = info.get(s.id);
      out.push({ subBuilds: design.data.subBuilds, root: s.id, description: i?.purpose, context: [design.data.name, ...context], sideways: i?.sideways ?? mounted.has(s.id), cost: costOf(design.data.subBuilds, s.id), run: path.basename(dir), request });
    }
  }
  return out;
}

function fromBuild(file: string): Candidate[] {
  const doc = readJson(file) as { name?: string; versions?: { design?: unknown }[] } | null;
  const out: Candidate[] = [];
  for (const v of doc?.versions ?? []) {
    const design = BrickDesignSchema.safeParse(v.design);
    if (!design.success) continue;
    const mounted = new Set([...design.data.main.uses, ...design.data.subBuilds.flatMap((s) => s.uses)].filter((u) => u.mount).map((u) => u.sub));
    for (const s of design.data.subBuilds) out.push({ subBuilds: design.data.subBuilds, root: s.id, context: [design.data.name, doc?.name ?? ""], sideways: mounted.has(s.id), cost: 0 });
  }
  return out;
}

export function seedLibrary(o: { dir?: string; debugDir?: string; buildsDir?: string; dryRun?: boolean } = {}): SeedReport {
  const debugDir = o.debugDir ?? CONFIG.debugDir;
  const buildsDir = o.buildsDir ?? CONFIG.buildsDir;
  const lib = loadLibrary(o.dir ?? CONFIG.componentsDir);
  const report: SeedReport = { runs: 0, builds: 0, found: 0, added: 0, duplicates: 0, invalid: 0, skipped: [] };
  const candidates: Candidate[] = [];
  for (const r of list(debugDir).sort()) {
    const dir = path.join(/*turbopackIgnore: true*/ debugDir, r);
    if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue; // gone since the listing
    const c = fromRun(dir);
    if (c.length) report.runs++;
    candidates.push(...c);
  }
  for (const b of list(buildsDir).filter((f) => f.endsWith(".json")).sort()) {
    const c = fromBuild(path.join(/*turbopackIgnore: true*/ buildsDir, b));
    if (c.length) report.builds++;
    candidates.push(...c);
  }
  report.found = candidates.length;
  for (const c of candidates) {
    const comp = makeComponent(c.subBuilds, c.root, c);
    if (!comp) {
      report.invalid++;
      if (report.skipped.length < 10) report.skipped.push(`${c.run ?? "build"}: ${c.root} isn't valid on its own`);
      continue;
    }
    if (o.dryRun) {
      if (lib.components.some((x) => x.hash === comp.hash)) report.duplicates++;
      else (report.added++, lib.components.push(comp));
      continue;
    }
    const { added } = saveComponent(lib, comp);
    if (added) report.added++;
    else report.duplicates++;
  }
  return report;
}

/** Save one run's valid sub-builds (e.g. a run stopped at its budget cap). Returns how many were new. */
export function seedRun(lib: Library, dir: string): number {
  let added = 0;
  for (const c of fromRun(dir)) {
    const comp = makeComponent(c.subBuilds, c.root, c);
    if (comp && saveComponent(lib, comp).added) added++;
  }
  return added;
}
