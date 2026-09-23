"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";
import type { GenerateEvent, GenerateResult, RoundSummary } from "@/lib/claude/generate";
import type { Issue } from "@/lib/validate/validator";
import { validate } from "@/lib/validate/validator";
import { buildSteps } from "@/lib/steps/steps";
import { exportFileNames, exportLdr, exportMpd } from "@/lib/ldraw/export";
import { BrickModelSchema, type BrickModel } from "@/lib/model/schema";
import { SAMPLE_HOUSE } from "@/lib/fixtures/samples";
import { streamGenerate } from "@/lib/client/sse";
import { download, prepareImage } from "@/lib/client/image";
import { PartsList } from "@/components/PartsList";

const Viewer = dynamic(() => import("@/components/Viewer"), { ssr: false, loading: () => <div className="viewer-loading">Loading 3D viewer…</div> });

interface RoundState {
  round: number;
  kind: "design" | "repair";
  thinkingChars: number;
  outputChars: number;
  thinking?: string;
  summary?: RoundSummary;
  errors?: Issue[];
}

const usd = (n: number) => `$${n.toFixed(n < 0.1 ? 4 : 3)}`;

export default function Page() {
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ mediaType: "image/jpeg"; data: string; previewUrl: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [rounds, setRounds] = useState<RoundState[]>([]);
  const [gen, setGen] = useState<Pick<GenerateResult, "usage" | "debugDir" | "valid"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<BrickModel | null>(null);
  const [modelKey, setModelKey] = useState("empty");
  const [mode, setMode] = useState<"model" | "steps">("model");
  const [step, setStep] = useState(1);
  const [focus, setFocus] = useState<Set<number> | undefined>();
  const abortRef = useRef<AbortController | null>(null);

  const validation = useMemo(() => (model ? validate(model) : null), [model]);
  const steps = useMemo(() => (model ? buildSteps(model) : []), [model]);
  const errorParts = useMemo(() => new Set(validation?.errors.flatMap((e) => e.parts) ?? []), [validation]);

  const current = steps[Math.min(step, steps.length) - 1];
  const visible = useMemo(() => {
    if (mode !== "steps" || !current) return undefined;
    return new Set(steps.slice(0, current.n).flatMap((s) => s.parts));
  }, [mode, steps, current]);
  const highlight = mode === "steps" ? new Set(current?.parts ?? []) : focus;

  function showModel(m: BrickModel, key: string) {
    setModel(m);
    setModelKey(key);
    setStep(1);
    setFocus(undefined);
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return setImage(null);
    try {
      setImage(await prepareImage(file));
    } catch (e) {
      setError(`Couldn't read that image: ${(e as Error).message}`);
    }
  }

  async function generate() {
    setError(null);
    setRounds([]);
    setGen(null);
    setRunning(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      for await (const ev of streamGenerate({ text, image: image ? { mediaType: image.mediaType, data: image.data } : undefined }, ac.signal)) {
        handleEvent(ev);
      }
    } catch (e) {
      if (!ac.signal.aborted) setError((e as Error).message);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function handleEvent(ev: GenerateEvent) {
    switch (ev.type) {
      case "round_start":
        setRounds((r) => [...r, { round: ev.round, kind: ev.kind, thinkingChars: 0, outputChars: 0 }]);
        break;
      case "progress":
        setRounds((r) => r.map((x) => (x.round === ev.round ? { ...x, thinkingChars: ev.thinkingChars, outputChars: ev.outputChars, thinking: ev.thinking } : x)));
        break;
      case "round_end":
        setRounds((r) => r.map((x) => (x.round === ev.summary.round ? { ...x, summary: ev.summary, errors: ev.errors } : x)));
        break;
      case "done":
        setGen({ usage: ev.result.usage, debugDir: ev.result.debugDir, valid: ev.result.valid });
        if (ev.result.model) showModel(ev.result.model, `gen-${Date.now()}`);
        else setError("Claude didn't return a usable model. See the debug folder for the raw output.");
        break;
      case "error":
        setError(ev.message);
        break;
    }
  }

  async function openJson(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = BrickModelSchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) throw new Error(parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      setGen(null);
      setRounds([]);
      showModel(parsed.data, `file-${file.name}-${Date.now()}`);
    } catch (e) {
      setError(`Couldn't load model: ${(e as Error).message}`);
    }
  }

  function exportFile(kind: "ldr" | "mpd" | "json") {
    if (!model) return;
    const names = exportFileNames(model);
    if (kind === "ldr") download(names.ldr, exportLdr(model, steps));
    if (kind === "mpd") download(names.mpd, exportMpd(model, steps));
    if (kind === "json") download(names.ldr.replace(/\.ldr$/, ".json"), JSON.stringify(model, null, 2), "application/json");
  }

  const canGenerate = !running && (text.trim().length > 0 || !!image);
  const liveCost = rounds.reduce((s, r) => s + (r.summary?.usage.cost ?? 0), 0);

  return (
    <div className="app">
      <aside className="sidebar">
        <header className="brand">
          <h1>Brick Builder</h1>
          <p>Describe something or add a photo. Claude designs a buildable model.</p>
        </header>

        <section className="card">
          <label className="label" htmlFor="desc">Description</label>
          <textarea
            id="desc"
            rows={3}
            placeholder="e.g. a red fire truck with a ladder"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canGenerate) generate();
            }}
          />
          <div className="row">
            <label className="btn secondary file">
              {image ? "Change photo" : "Add photo"}
              <input type="file" accept="image/*" onChange={(e) => onPhoto(e.target.files?.[0])} hidden />
            </label>
            {image && (
              <button className="btn ghost" onClick={() => setImage(null)}>
                Remove photo
              </button>
            )}
          </div>
          {image && <img className="preview" src={image.previewUrl} alt="Selected photo" />}
          <div className="row">
            <button className="btn primary" disabled={!canGenerate} onClick={generate}>
              {running ? "Generating…" : "Generate model"}
            </button>
            {running && (
              <button className="btn ghost" onClick={() => abortRef.current?.abort()}>
                Cancel
              </button>
            )}
          </div>
          <div className="row small">
            <button className="link" onClick={() => showModel(SAMPLE_HOUSE, `sample-${Date.now()}`)}>Load sample house</button>
            <label className="link">
              Open model JSON
              <input type="file" accept="application/json,.json" onChange={(e) => openJson(e.target.files?.[0])} hidden />
            </label>
          </div>
        </section>

        {error && <div className="alert">{error}</div>}

        {rounds.length > 0 && (
          <section className="card">
            <h2>Generation</h2>
            <ol className="rounds">
              {rounds.map((r) => (
                <li key={r.round} className={r.summary ? (r.summary.errorCount === 0 ? "ok" : "bad") : "live"}>
                  <div className="round-head">
                    <strong>{r.round === 0 ? "Design" : `Repair ${r.round}`}</strong>
                    {r.summary ? (
                      <span>
                        {r.summary.partCount} parts · {r.summary.errorCount === 0 ? "valid" : `${r.summary.errorCount} errors`} · {r.summary.seconds.toFixed(0)}s · {usd(r.summary.usage.cost)}
                      </span>
                    ) : (
                      <span className="muted">
                        thinking {Math.round(r.thinkingChars / 100) / 10}k chars · output {Math.round(r.outputChars / 100) / 10}k chars
                      </span>
                    )}
                  </div>
                  {!r.summary && r.thinking && <p className="thinking">{r.thinking.slice(-220)}</p>}
                  {r.summary && r.summary.errorCount > 0 && (
                    <div className="codes">
                      {Object.entries(r.summary.errorCodes).map(([c, n]) => (
                        <span key={c} className="chip">{n}× {c}</span>
                      ))}
                    </div>
                  )}
                  {r.summary && (
                    <div className="tokens muted">
                      in {r.summary.usage.input.toLocaleString()} · out {r.summary.usage.output.toLocaleString()} · cache read {r.summary.usage.cacheRead.toLocaleString()} · cache write {r.summary.usage.cacheWrite.toLocaleString()}
                    </div>
                  )}
                </li>
              ))}
            </ol>
            <div className="total">
              Total: <strong>{usd(gen?.usage.cost ?? liveCost)}</strong>
              {gen && (
                <span className="muted">
                  {" "}· {gen.usage.input.toLocaleString()} in / {gen.usage.output.toLocaleString()} out
                </span>
              )}
            </div>
            {gen && <div className="muted small mono">debug: {gen.debugDir}</div>}
          </section>
        )}

        {model && validation && (
          <section className="card">
            <h2>{model.name}</h2>
            <p className="muted">{model.description}</p>
            <div className={`status ${validation.valid ? "ok" : "bad"}`}>
              {validation.valid ? `Buildable: ${model.parts.length} parts, ${steps.length} steps` : `${validation.errors.length} problems remain (best attempt)`}
            </div>
            {!validation.valid && (
              <ul className="issues">
                {validation.errors.slice(0, 30).map((e, i) => (
                  <li key={i}>
                    <button className="link" onClick={() => (setMode("model"), setFocus(new Set(e.parts)))}>
                      <span className="chip">{e.code}</span> {e.message}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {validation.warnings.length > 0 && <p className="muted small">{validation.warnings.length} warning(s): single-stud connections.</p>}
            <div className="row">
              <button className="btn secondary" onClick={() => exportFile("ldr")}>Download .ldr</button>
              <button className="btn secondary" onClick={() => exportFile("mpd")}>Download .mpd</button>
              <button className="btn ghost" onClick={() => exportFile("json")}>JSON</button>
            </div>
          </section>
        )}
      </aside>

      <main className="stage">
        {model && (
          <div className="toolbar">
            <div className="tabs">
              <button className={mode === "model" ? "on" : ""} onClick={() => setMode("model")}>3D model</button>
              <button className={mode === "steps" ? "on" : ""} onClick={() => (setMode("steps"), setFocus(undefined))}>Instructions</button>
            </div>
            {mode === "steps" && current && (
              <div className="stepper">
                <button className="btn secondary" disabled={step <= 1} onClick={() => setStep((s) => Math.max(1, s - 1))}>◀ Prev</button>
                <input type="range" min={1} max={steps.length} value={Math.min(step, steps.length)} onChange={(e) => setStep(Number(e.target.value))} />
                <span className="step-label">Step {current.n} / {steps.length}</span>
                <button className="btn primary" disabled={step >= steps.length} onClick={() => setStep((s) => Math.min(steps.length, s + 1))}>Next ▶</button>
              </div>
            )}
            {mode === "model" && focus && (
              <button className="btn ghost" onClick={() => setFocus(undefined)}>Clear highlight</button>
            )}
          </div>
        )}
        <div className="viewer">
          {model ? (
            <Viewer model={model} visible={visible} highlight={highlight} errorParts={mode === "model" ? errorParts : undefined} fitKey={modelKey} />
          ) : (
            <div className="empty">
              <p>No model yet.</p>
              <p className="muted">Generate one, or load the sample house to try the viewer.</p>
            </div>
          )}
        </div>
        {model && (
          <div className="parts-panel">
            {mode === "steps" && current ? (
              <>
                <h3>Step {current.n}: add these parts</h3>
                <PartsList model={model} indices={current.parts} />
                <h3 className="muted">All parts</h3>
                <PartsList model={model} compact />
              </>
            ) : (
              <>
                <h3>Parts list · {model.parts.length} pieces</h3>
                <PartsList model={model} />
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
