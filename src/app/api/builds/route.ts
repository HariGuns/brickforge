import { ZodError } from "zod";
import { listBuilds, saveBuild } from "@/lib/builds/store";

/** GET → saved builds (summaries). */
export async function GET() {
  return Response.json({ builds: listBuilds() });
}

/** POST a BuildDoc → saves it (create or overwrite by id). */
export async function POST(req: Request) {
  try {
    const doc = saveBuild(await req.json());
    return Response.json({ ok: true, id: doc.id, updatedAt: doc.updatedAt });
  } catch (e) {
    const msg = e instanceof ZodError ? `Invalid build: ${e.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` : (e as Error).message;
    return Response.json({ error: msg }, { status: 400 });
  }
}
