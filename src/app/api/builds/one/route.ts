import { loadBuild } from "@/lib/builds/store";

/** GET ?id=… → the full build document. */
export async function GET(req: Request) {
  const doc = loadBuild(new URL(req.url).searchParams.get("id") ?? "");
  return doc ? Response.json({ doc }) : Response.json({ error: "Build not found" }, { status: 404 });
}
