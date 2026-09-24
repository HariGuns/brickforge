import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "../config";
import { BrickModelSchema, type BrickModel } from "../model/schema";
import { BrickDesignSchema, type BrickDesign } from "../design/schema";
import { importLdr } from "../ldraw/import";

export const EXPORTS_DIR = CONFIG.exportsDir;

export interface LibraryEntry {
  kind: "debug" | "export";
  /** Folder name (debug) or file name (export). */
  id: string;
  name: string;
  description: string;
  parts: number;
  valid: boolean | null;
  rounds: number | null;
  cost: number | null;
  /** ISO timestamp (debug: from the folder name; export: file mtime). */
  date: string;
  source: string | null;
  /** Unique sub-builds, for runs made with the sub-build generator. */
  subBuilds: number | null;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function debugDesign(dir: string): BrickDesign | null {
  const d = BrickDesignSchema.safeParse(readJson(path.join(dir, "final-design.json")));
  return d.success ? d.data : null;
}

function debugModel(dir: string): BrickModel | null {
  for (const f of ["final-model.json"]) {
    const m = BrickModelSchema.safeParse(readJson(path.join(dir, f)));
    if (m.success) return m.data;
  }
  // Runs without a final model: fall back to the last parsed round.
  const rounds = fs.readdirSync(dir).filter((f) => /^round-\d+\.model\.json$/.test(f)).sort((a, b) => parseInt(b.slice(6)) - parseInt(a.slice(6)));
  for (const f of rounds) {
    const m = BrickModelSchema.safeParse(readJson(path.join(dir, f)));
    if (m.success) return m.data;
  }
  return null;
}

/** "2026-09-23_18-03-56-a-small…" → ISO time (UTC, as written by DebugRun). */
function debugDate(id: string): string {
  const m = id.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}Z` : new Date(0).toISOString();
}

export function listLibrary(): LibraryEntry[] {
  const out: LibraryEntry[] = [];
  const seen = new Set<string>(); // name|parts of generated models, to hide their duplicate exports

  const debugRoot = path.resolve(CONFIG.debugDir);
  if (fs.existsSync(debugRoot)) {
    for (const id of fs.readdirSync(debugRoot)) {
      const dir = path.join(debugRoot, id);
      if (!fs.statSync(dir).isDirectory()) continue;
      const model = debugModel(dir);
      if (!model) continue;
      const summary = readJson(path.join(dir, "summary.json")) as { valid?: boolean; rounds?: { round?: number }[]; total?: { cost?: number } } | null;
      const input = readJson(path.join(dir, "input.json")) as { mode?: string; text?: string | null; hasImage?: boolean } | null;
      seen.add(`${model.name}|${model.parts.length}`);
      out.push({
        kind: "debug",
        id,
        name: model.name,
        description: model.description,
        parts: model.parts.length,
        valid: summary?.valid ?? null,
        // Rounds after the first in each stage are repairs (sub-build runs have one loop per stage).
        rounds: summary?.rounds ? 1 + summary.rounds.filter((r) => (r.round ?? 0) > 0).length : null,
        cost: summary?.total?.cost ?? null,
        date: debugDate(id),
        subBuilds: debugDesign(dir)?.subBuilds.length ?? null,
        source: `${input?.mode === "edit" ? "Edit · " : ""}${input?.hasImage ? `Photo${input.text ? ` · ${input.text}` : ""}` : (input?.text ?? "")}` || null,
      });
    }
  }

  const exportRoot = path.resolve(EXPORTS_DIR);
  if (fs.existsSync(exportRoot)) {
    for (const id of fs.readdirSync(exportRoot)) {
      if (!/\.ldr$/i.test(id)) continue;
      const file = path.join(exportRoot, id);
      const { model } = importLdr(fs.readFileSync(file, "utf8"), id.replace(/\.ldr$/i, ""));
      // Generated models are already listed from their debug run.
      if (seen.has(`${model.name}|${model.parts.length}`)) continue;
      out.push({
        kind: "export",
        id,
        name: model.name,
        description: model.description,
        parts: model.parts.length,
        valid: null,
        rounds: null,
        cost: null,
        date: fs.statSync(file).mtime.toISOString(),
        source: `exports/${id}`,
        subBuilds: null,
      });
    }
  }

  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** Load one entry's model. `id` must name an existing entry (no path traversal). */
export function loadLibraryModel(kind: string, id: string): { model: BrickModel; skipped: number; design?: BrickDesign } | null {
  if (path.basename(id) !== id || id.startsWith(".")) return null;
  if (kind === "debug") {
    const dir = path.join(path.resolve(CONFIG.debugDir), id);
    if (!fs.existsSync(dir)) return null;
    const model = debugModel(dir);
    const design = debugDesign(dir);
    return model ? { model, skipped: 0, ...(design ? { design } : {}) } : null;
  }
  if (kind === "export" && /\.ldr$/i.test(id)) {
    const file = path.join(path.resolve(EXPORTS_DIR), id);
    if (!fs.existsSync(file)) return null;
    const { model, skipped } = importLdr(fs.readFileSync(file, "utf8"), id.replace(/\.ldr$/i, ""));
    return { model, skipped: skipped.length };
  }
  return null;
}
