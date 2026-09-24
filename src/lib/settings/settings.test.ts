import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Settings and data folders are read from the environment when modules load.
let tmp: string;
const env = { ...process.env };
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bf-settings-"));
  vi.resetModules();
});
afterEach(() => {
  process.env = { ...env };
  fs.rmSync(tmp, { recursive: true, force: true });
});

const KEY = "sk-ant-api03-" + "x".repeat(40) + "WXYZ";

describe("desktop settings", () => {
  it("without a config folder, uses the environment key and refuses to save", async () => {
    delete process.env.BRICKFORGE_CONFIG_DIR;
    process.env.ANTHROPIC_API_KEY = KEY;
    const s = await import("./store");
    expect(s.settingsEnabled()).toBe(false);
    expect(s.apiKey()).toEqual({ key: KEY, source: "env" });
    expect(() => s.writeSettings({ apiKey: KEY })).toThrow();
  });

  it("stores the key in settings.json, readable by the user only, and prefers it", async () => {
    process.env.BRICKFORGE_CONFIG_DIR = tmp;
    process.env.ANTHROPIC_API_KEY = "sk-ant-from-env-" + "y".repeat(30);
    const s = await import("./store");
    s.writeSettings({ apiKey: KEY });
    const file = path.join(tmp, "settings.json");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(s.apiKey()).toEqual({ key: KEY, source: "settings" });
    expect(s.keyHint(KEY)).toBe("sk-ant-…WXYZ");
    s.writeSettings({ setupDone: true });
    s.writeSettings({ apiKey: undefined });
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ setupDone: true });
    expect(s.apiKey().source).toBe("env");
  });
});

describe("first-run import", () => {
  function oldFolder() {
    const from = path.join(tmp, "old");
    fs.mkdirSync(path.join(from, "builds"), { recursive: true });
    fs.writeFileSync(path.join(from, "builds", "b1.json"), "{}");
    fs.mkdirSync(path.join(from, "debug", "run-1"), { recursive: true });
    fs.writeFileSync(path.join(from, "debug", "run-1", "final-model.json"), "{}");
    fs.mkdirSync(path.join(from, "debug", "failed-run"), { recursive: true }); // no final model: not a Library entry
    fs.mkdirSync(path.join(from, "exports"), { recursive: true });
    fs.writeFileSync(path.join(from, "exports", "a.ldr"), "0");
    fs.writeFileSync(path.join(from, "exports", "notes.txt"), "");
    return from;
  }

  it("offers the source folder and copies builds, runs and exports without overwriting", async () => {
    const from = oldFolder();
    const data = path.join(tmp, "data");
    process.env.BRICKFORGE_DATA_DIR = data;
    process.env.BRICKFORGE_IMPORT_FROM = from;
    const { importCandidate, importFrom } = await import("./importData");
    expect(importCandidate()).toEqual({ path: from, builds: 1, runs: 1, exports: 1 });
    fs.mkdirSync(path.join(data, "exports"), { recursive: true });
    fs.writeFileSync(path.join(data, "exports", "a.ldr"), "mine");
    expect(importFrom(from)).toEqual({ builds: 1, runs: 1, exports: 0 });
    expect(fs.readFileSync(path.join(data, "exports", "a.ldr"), "utf8")).toBe("mine");
    expect(fs.existsSync(path.join(data, "debug", "run-1", "final-model.json"))).toBe(true);
    expect(importFrom(from)).toEqual({ builds: 0, runs: 0, exports: 0 });
  });

  it("offers nothing when the folder is empty or missing", async () => {
    process.env.BRICKFORGE_DATA_DIR = path.join(tmp, "data");
    process.env.BRICKFORGE_IMPORT_FROM = path.join(tmp, "nowhere");
    const { importCandidate } = await import("./importData");
    expect(importCandidate()).toBeNull();
  });
});
