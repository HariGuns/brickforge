import { listLibrary } from "@/lib/library/scan";

/** GET → saved models: generation runs in debug/ and .ldr files in exports/. */
export async function GET() {
  return Response.json({ entries: listLibrary() });
}
