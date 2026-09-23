import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "../config";

/** Per-run debug folder: debug/<timestamp>-<slug>/ holding raw outputs and validator results. */
export class DebugRun {
  readonly dir: string;

  constructor(label: string) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "run";
    this.dir = path.resolve(CONFIG.debugDir, `${stamp}-${slug}`);
    fs.mkdirSync(this.dir, { recursive: true });
  }

  write(name: string, data: unknown) {
    const body = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    try {
      fs.writeFileSync(path.join(this.dir, name), body);
    } catch (err) {
      console.error(`[debug] failed to write ${name}:`, err);
    }
  }

  writeBinary(name: string, data: Buffer) {
    try {
      fs.writeFileSync(path.join(this.dir, name), data);
    } catch (err) {
      console.error(`[debug] failed to write ${name}:`, err);
    }
  }
}
