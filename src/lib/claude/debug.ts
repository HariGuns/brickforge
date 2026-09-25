import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "../config";

/** Per-run debug folder: debug/<timestamp>-<slug>/ holding raw outputs and validator results. */
export class DebugRun {
  readonly dir!: string;

  constructor(label: string, existingDir?: string) {
    if (existingDir) {
      // Resuming: keep writing into the interrupted run's folder.
      this.dir = path.resolve(/*turbopackIgnore: true*/ existingDir);
      if (!fs.existsSync(this.dir)) throw new Error(`No debug folder at ${this.dir}`);
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "run";
    const base = path.resolve(/*turbopackIgnore: true*/ CONFIG.debugDir, `${stamp}-${slug}`);
    fs.mkdirSync(path.dirname(base), { recursive: true });
    // Create atomically; two runs of the same prompt in the same second get -2, -3, …
    for (let n = 1; ; n++) {
      const dir = n === 1 ? base : `${base}-${n}`;
      try {
        fs.mkdirSync(dir);
        this.dir = dir;
        return;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
    }
  }

  /** Continue an existing run's folder (for resume). */
  static open(dir: string): DebugRun {
    return new DebugRun("", dir);
  }

  write(name: string, data: unknown) {
    const body = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    try {
      fs.writeFileSync(path.join(/*turbopackIgnore: true*/ this.dir, name), body);
    } catch (err) {
      console.error(`[debug] failed to write ${name}:`, err);
    }
  }

  writeBinary(name: string, data: Buffer) {
    try {
      fs.writeFileSync(path.join(/*turbopackIgnore: true*/ this.dir, name), data);
    } catch (err) {
      console.error(`[debug] failed to write ${name}:`, err);
    }
  }
}
