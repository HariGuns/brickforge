import { loadLibraryModel } from "@/lib/library/scan";

/** GET ?kind=debug|export&id=… → { model, skipped } */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const result = loadLibraryModel(url.searchParams.get("kind") ?? "", url.searchParams.get("id") ?? "");
  if (!result) return Response.json({ error: "Model not found" }, { status: 404 });
  return Response.json(result);
}
