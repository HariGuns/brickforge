import fs from "node:fs";
import path from "node:path";

/**
 * Desktop-app settings, stored in BRICKFORGE_CONFIG_DIR/settings.json
 * (~/.config/BrickForge, readable by the user only). Without that variable
 * (development, the launcher) there are no settings and the API key comes
 * from ANTHROPIC_API_KEY in .env.local.
 */

export interface Settings {
  apiKey?: string;
  /** The first-run screen (key, import) has been completed or dismissed. */
  setupDone?: boolean;
}

export const KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,}$/;

const dir = () => process.env.BRICKFORGE_CONFIG_DIR;
export const settingsEnabled = () => !!dir();
const file = () => path.join(/*turbopackIgnore: true*/ dir()!, "settings.json");

export function readSettings(): Settings {
  if (!settingsEnabled()) return {};
  try {
    return JSON.parse(fs.readFileSync(file(), "utf8"));
  } catch {
    return {};
  }
}

export function writeSettings(patch: Partial<Settings>): Settings {
  if (!settingsEnabled()) throw new Error("Settings are only available in the desktop app");
  const next = { ...readSettings(), ...patch };
  for (const k of Object.keys(next) as (keyof Settings)[]) if (next[k] === undefined) delete next[k];
  fs.mkdirSync(dir()!, { recursive: true });
  const tmp = `${file()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file());
  return next;
}

/** The key to use: Settings first, then the environment (.env.local). */
export function apiKey(): { key: string | null; source: "settings" | "env" | null } {
  const saved = readSettings().apiKey;
  if (saved) return { key: saved, source: "settings" };
  if (process.env.ANTHROPIC_API_KEY) return { key: process.env.ANTHROPIC_API_KEY, source: "env" };
  return { key: null, source: null };
}

/** "sk-ant-…WXYZ": enough to recognise a key without showing it. */
export const keyHint = (key: string) => `${key.slice(0, 7)}…${key.slice(-4)}`;
