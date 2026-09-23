import Anthropic from "@anthropic-ai/sdk";
import { generateModel, type GenerateEvent, type ImageMediaType } from "@/lib/claude/generate";

const IMAGE_TYPES: ImageMediaType[] = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function friendly(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env.local.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the Anthropic API. Wait a moment and try again.";
  if (err instanceof Anthropic.BadRequestError) return `The API rejected the request: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status ?? ""}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

/** POST { text?, image?: { mediaType, data(base64) } } → text/event-stream of GenerateEvent. */
export async function POST(req: Request) {
  let body: { text?: string; image?: { mediaType: string; data: string } };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.slice(0, 2000) : undefined;
  let image: { mediaType: ImageMediaType; data: string } | undefined;
  if (body.image) {
    if (!IMAGE_TYPES.includes(body.image.mediaType as ImageMediaType)) return Response.json({ error: "Unsupported image type" }, { status: 400 });
    if (body.image.data.length * 0.75 > MAX_IMAGE_BYTES) return Response.json({ error: "Image is larger than 5 MB" }, { status: 400 });
    image = { mediaType: body.image.mediaType as ImageMediaType, data: body.image.data };
  }
  if (!text?.trim() && !image) return Response.json({ error: "Provide a description or a photo" }, { status: 400 });

  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: GenerateEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          // client went away
        }
      };
      try {
        await generateModel({ text, image }, send, { signal: abort.signal });
      } catch (err) {
        if (!abort.signal.aborted) {
          console.error("[generate] failed:", err);
          send({ type: "error", message: friendly(err) });
        }
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
