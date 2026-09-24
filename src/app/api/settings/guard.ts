/**
 * Settings changes only from the app's own pages: JSON bodies (a cross-site
 * form can't send those without a CORS preflight) and a same-host Origin.
 */
export function rejectForeign(req: Request): Response | null {
  if (!req.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "Expected JSON" }, { status: 415 });
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return Response.json({ error: "Forbidden" }, { status: 403 });
  return null;
}
