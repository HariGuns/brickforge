import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "../config";

/**
 * First-run import of builds made before the desktop app: saved builds,
 * generation runs (the Library) and exported .ldr/.mpd files from another
 * BrickForge folder (by default the source folder the app was built from,
 * BRICKFORGE_IMPORT_FROM). Existing files are never overwritten.
 */

export interface ImportCounts {
  builds: number;
  runs: number;
  exports: number;
}

const list = (dir: string, keep: (e: fs.Dirent) => boolean) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(keep).map((e) => e.name);
  } catch {
    return [];
  }
};

function sources(from: string) {
  return {
    builds: list(path.join(from, "builds"), (e) => e.isFile() && e.name.endsWith(".json")),
    runs: list(path.join(from, "debug"), (e) => e.isDirectory() && fs.existsSync(path.join(from, "debug", e.name, "final-model.json"))),
    exports: list(path.join(from, "exports"), (e) => e.isFile() && /\.(ldr|mpd)$/i.test(e.name)),
  };
}

export function countImport(from: string): ImportCounts {
  const s = sources(from);
  return { builds: s.builds.length, runs: s.runs.length, exports: s.exports.length };
}

/** The folder to offer on first run, if it has anything and isn't the app's own data folder. */
export function importCandidate(): ({ path: string } & ImportCounts) | null {
  const from = process.env.BRICKFORGE_IMPORT_FROM;
  if (!from || path.resolve(from) === path.resolve(CONFIG.debugDir, "..")) return null;
  const c = countImport(from);
  return c.builds + c.runs + c.exports ? { path: from, ...c } : null;
}

/** Copy into the data folders, skipping anything already there. Returns what was copied. */
export function importFrom(from: string): ImportCounts {
  const src = sources(path.resolve(from));
  const copied: ImportCounts = { builds: 0, runs: 0, exports: 0 };
  const copy = (kind: keyof ImportCounts, sub: string, name: string, dest: string) => {
    const target = path.join(path.resolve(dest), name);
    if (fs.existsSync(target)) return;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(path.join(path.resolve(from), sub, name), target, { recursive: true, errorOnExist: false, force: false });
    copied[kind]++;
  };
  for (const n of src.builds) copy("builds", "builds", n, CONFIG.buildsDir);
  for (const n of src.runs) copy("runs", "debug", n, CONFIG.debugDir);
  for (const n of src.exports) copy("exports", "exports", n, CONFIG.exportsDir);
  return copied;
}
