import fs from "node:fs";
import { importFrom } from "@/lib/settings/importData";
import { settingsEnabled } from "@/lib/settings/store";
import { rejectForeign } from "../guard";

/** POST { from: folder } → copies its builds, generation runs and exports into the app's data folder. */
export async function POST(req: Request) {
  const bad = rejectForeign(req);
  if (bad) return bad;
  if (!settingsEnabled()) return Response.json({ error: "Import is only available in the desktop app" }, { status: 400 });
  let from: unknown;
  try {
    from = (await req.json()).from;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof from !== "string" || !from.startsWith("/") || !fs.existsSync(from)) return Response.json({ error: "That folder doesn't exist" }, { status: 400 });
  try {
    return Response.json({ copied: importFrom(from) });
  } catch (e) {
    return Response.json({ error: `Import failed: ${(e as Error).message}` }, { status: 500 });
  }
}
