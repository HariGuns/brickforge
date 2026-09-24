import Anthropic from "@anthropic-ai/sdk";
import { CONFIG } from "@/lib/config";
import { importCandidate } from "@/lib/settings/importData";
import { apiKey, keyHint, KEY_PATTERN, readSettings, settingsEnabled, writeSettings } from "@/lib/settings/store";
import { rejectForeign } from "./guard";

function status() {
  const { key, source } = apiKey();
  const managed = settingsEnabled();
  const s = readSettings();
  return {
    /** true in the desktop app (key stored in Settings); false with .env.local. */
    managed,
    hasKey: !!key,
    keySource: source,
    keyHint: key ? keyHint(key) : null,
    setupDone: !managed || !!s.setupDone,
    importFrom: managed && !s.setupDone ? importCandidate() : null,
    dataDir: managed ? process.env.BRICKFORGE_DATA_DIR ?? null : null,
  };
}

/** GET → key status (never the key itself), first-run state and import offer. */
export async function GET() {
  return Response.json(status());
}

/** POST { apiKey?: string | null, setupDone?: true } → saves Settings (desktop app only). */
export async function POST(req: Request) {
  const bad = rejectForeign(req);
  if (bad) return bad;
  if (!settingsEnabled()) return Response.json({ error: "Settings are only available in the desktop app. In development the key comes from .env.local." }, { status: 400 });
  let body: { apiKey?: unknown; setupDone?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (body.apiKey === null) writeSettings({ apiKey: undefined });
  else if (body.apiKey !== undefined) {
    const key = String(body.apiKey).trim();
    if (!KEY_PATTERN.test(key)) return Response.json({ error: "That doesn't look like an Anthropic API key. It starts with sk-ant-." }, { status: 400 });
    // Check it with a free call before saving.
    try {
      await new Anthropic({ apiKey: key, maxRetries: 0, timeout: 15000 }).models.retrieve(CONFIG.model);
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return Response.json({ error: "Anthropic rejected this key. Check that you copied all of it." }, { status: 400 });
      if (!(e instanceof Anthropic.APIConnectionError) && !(e instanceof Anthropic.NotFoundError)) return Response.json({ error: `Couldn't check the key: ${(e as Error).message}` }, { status: 400 });
      // Offline, or the model isn't listed for this key: save it anyway; generation will report problems.
    }
    writeSettings({ apiKey: key });
  }
  if (body.setupDone === true) writeSettings({ setupDone: true });
  return Response.json(status());
}
