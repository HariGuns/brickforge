import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "../config";
import { BUILD_ID, BuildDocSchema, type BuildDoc } from "./doc";

export interface BuildSummary {
  id: string;
  name: string;
  description: string;
  versions: number;
  parts: number;
  updatedAt: string;
}

const root = (dir?: string) => path.resolve(/*turbopackIgnore: true*/ dir ?? CONFIG.buildsDir);
const file = (id: string, dir?: string) => path.join(/*turbopackIgnore: true*/ root(dir), `${id}.json`);

export function saveBuild(input: unknown, dir?: string): BuildDoc {
  const doc = BuildDocSchema.parse(input);
  if (!doc.versions.some((v) => v.id === doc.currentId)) throw new Error("currentId doesn't match any version");
  if (doc.versions.some((v) => v.model.parts.length > CONFIG.maxParts)) throw new Error(`A version has more than ${CONFIG.maxParts} parts`);
  fs.mkdirSync(root(dir), { recursive: true });
  // Write then rename, so a crash never leaves a half-written build.
  const tmp = `${file(doc.id, dir)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc));
  fs.renameSync(tmp, file(doc.id, dir));
  return doc;
}

export function loadBuild(id: string, dir?: string): BuildDoc | null {
  if (!BUILD_ID.test(id)) return null;
  try {
    const r = BuildDocSchema.safeParse(JSON.parse(fs.readFileSync(file(id, dir), "utf8")));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export function listBuilds(dir?: string): BuildSummary[] {
  if (!fs.existsSync(root(dir))) return [];
  const out: BuildSummary[] = [];
  for (const f of fs.readdirSync(root(dir))) {
    if (!f.endsWith(".json")) continue;
    const doc = loadBuild(f.slice(0, -5), dir);
    if (!doc) continue;
    const cur = doc.versions.find((v) => v.id === doc.currentId) ?? doc.versions.at(-1)!;
    out.push({ id: doc.id, name: doc.name, description: cur.model.description, versions: doc.versions.length, parts: cur.model.parts.length, updatedAt: doc.updatedAt });
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
