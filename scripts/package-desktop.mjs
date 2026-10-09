#!/usr/bin/env node
/**
 * Build the BrickForge desktop app (Electron + the Next.js standalone server) for
 * Linux (AppImage), Windows (installer + portable .exe) or macOS (universal .dmg).
 * Cross-platform: no shell scripts. Output in dist/.
 *
 *   node scripts/package-desktop.mjs                  (this platform)
 *   node scripts/package-desktop.mjs --linux | --win | --mac
 *   node scripts/package-desktop.mjs --linux --import-from-here
 *        (personal builds: offer to copy this folder's runs and builds into the app on first launch)
 *
 * The API key is never bundled. The app asks for it on first launch and keeps it in its
 * own settings. This script deletes .env files from the server folder, and it refuses to
 * package if a key from .env.local, or anything shaped like an Anthropic key, turns up in
 * what gets packaged or in the unpacked app.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const target = args.includes("--win") ? "win" : args.includes("--mac") ? "mac" : args.includes("--linux") ? "linux" : { win32: "win", darwin: "mac" }[process.platform] ?? "linux";
const importFromHere = args.includes("--import-from-here");
const STANDALONE = path.join(ROOT, ".next-app", "standalone");

function run(file, argv, env = {}) {
  const r = spawnSync(process.execPath, [file, ...argv], { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log("▸ Building the standalone server (.next-app/)");
// dist/ goes first: the tracer would copy an old build into the new one.
for (const d of [".next-app", "dist"]) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
run(path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), ["build"], { BRICKFORGE_STANDALONE: "1", NEXT_TELEMETRY_DISABLED: "1" });
fs.cpSync(path.join(ROOT, ".next-app", "static"), path.join(STANDALONE, ".next-app", "static"), { recursive: true });
// Merge public/ in (the tracer already copies public/parts, which the server renderer reads).
if (fs.existsSync(path.join(ROOT, "public"))) fs.cpSync(path.join(ROOT, "public"), path.join(STANDALONE, "public"), { recursive: true });
// sharp (native image libraries for three platforms) is only for next/image optimisation, which the app doesn't use.
for (const d of ["sharp", "@img"]) fs.rmSync(path.join(STANDALONE, "node_modules", d), { recursive: true, force: true });
for (const f of fs.readdirSync(STANDALONE)) if (f.startsWith(".env")) fs.rmSync(path.join(STANDALONE, f), { force: true });
// Next records the build folder in two config files (unused at runtime): keep this machine's path out.
for (const f of ["server.js", path.join(".next-app", "required-server-files.json")]) {
  const file = path.join(STANDALONE, f);
  if (!fs.existsSync(file)) continue;
  const escaped = JSON.stringify(ROOT).slice(1, -1); // as it appears inside JSON (Windows backslashes doubled)
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").split(escaped).join(".").split(ROOT).join("."));
}

// --- no keys in the build ---------------------------------------------------------------------
const localKeys = (() => {
  try {
    return fs
      .readFileSync(path.join(ROOT, ".env.local"), "utf8")
      .split(/\r?\n/)
      .map((l) => l.match(/^[A-Z_]*_KEY\s*=\s*["']?([^"'\s]+)/)?.[1])
      .filter((k) => k && k.length >= 16 && !k.endsWith("..."));
  } catch {
    return [];
  }
})();
const ANTHROPIC_KEY = /sk-ant-[a-z]+\d{2}-[A-Za-z0-9_-]{20,}/;
function findKeys(dir) {
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && fs.statSync(p).size < 50e6) {
        const text = fs.readFileSync(p).toString("latin1");
        if (localKeys.some((k) => text.includes(k)) || ANTHROPIC_KEY.test(text)) hits.push(path.relative(ROOT, p));
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return hits;
}
function refuseKeys(dirs, when) {
  const hits = dirs.flatMap(findKeys);
  if (hits.length) {
    console.error(`✗ ${when}: an API key was found in ${hits.slice(0, 5).join(", ")}. Not packaging.`);
    process.exit(1);
  }
}
refuseKeys([STANDALONE, path.join(ROOT, "electron")], "Before packaging");
if (!importFromHere) {
  const leaks = [STANDALONE].flatMap((d) => grepTree(d, ROOT));
  if (leaks.length) {
    console.error(`✗ This folder's path (${ROOT}) is still in ${leaks.slice(0, 5).join(", ")}. Not packaging.`);
    process.exit(1);
  }
}

// First-run import: only for personal builds, never in a release (it would carry this machine's path).
fs.writeFileSync(path.join(ROOT, "electron", "build-info.json"), JSON.stringify(importFromHere ? { importFrom: ROOT } : {}) + "\n");

console.log(`▸ Packaging for ${target} (dist/)`);
const flags = { linux: ["--linux", "AppImage"], win: ["--win", "nsis", "portable", "--x64"], mac: ["--mac", "dmg", "--universal"] }[target];
// Windows builds made elsewhere can't edit the .exe's icon and details without Wine; CI builds on Windows do.
const extra = target === "win" && process.platform !== "win32" && !hasWine() ? ["-c.win.signAndEditExecutable=false"] : [];
run(path.join(ROOT, "node_modules", "electron-builder", "cli.js"), [...flags, ...extra, "--publish", "never"], { CSC_IDENTITY_AUTO_DISCOVERY: "false" });

// The unpacked app (before it's compressed into the AppImage / installer / dmg) gets the same check.
refuseKeys(
  fs.readdirSync(path.join(ROOT, "dist"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(ROOT, "dist", e.name)),
  "After packaging",
);
fs.rmSync(path.join(ROOT, "electron", "build-info.json"), { force: true });
for (const f of fs.readdirSync(path.join(ROOT, "dist"))) if (/\.(AppImage|exe|dmg)$/.test(f)) console.log(`  dist/${f}  ${(fs.statSync(path.join(ROOT, "dist", f)).size / 1e6).toFixed(0)} MB`);

function grepTree(dir, needle) {
  const hits = [];
  const alt = JSON.stringify(needle).slice(1, -1);
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && fs.statSync(p).size < 50e6) {
        const t = fs.readFileSync(p).toString("latin1");
        if (t.includes(needle) || t.includes(alt)) hits.push(path.relative(ROOT, p));
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return hits;
}

function hasWine() {
  return spawnSync(process.platform === "win32" ? "where" : "which", ["wine"], { stdio: "ignore" }).status === 0;
}
