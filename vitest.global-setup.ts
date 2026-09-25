import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Tests run the generators with a fake Claude, which write debug runs (and may
 * write builds and exports). Point them at a throwaway data folder so they never
 * land in the real debug/ (the Library and the token report read it).
 */
export default function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brickforge-test-"));
  process.env.BRICKFORGE_DATA_DIR = dir;
  return () => fs.rmSync(dir, { recursive: true, force: true });
}
