import type { GenerateEvent } from "../claude/generate";

/** POST to /api/generate and yield server-sent events as they arrive. */
export async function* streamGenerate(body: unknown, signal?: AbortSignal): AsyncGenerator<GenerateEvent> {
  const res = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const msg = await res.text().catch(() => "");
    let parsed = msg;
    try {
      parsed = JSON.parse(msg).error ?? msg;
    } catch {}
    throw new Error(parsed || `Request failed (${res.status})`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = chunk.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
      if (data) yield JSON.parse(data) as GenerateEvent;
    }
  }
}
