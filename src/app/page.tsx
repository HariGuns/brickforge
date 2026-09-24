"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GenerateEvent } from "@/lib/claude/generate";
import type { LibraryEntry } from "@/lib/library/scan";
import { validate } from "@/lib/validate/validator";
import { buildSteps } from "@/lib/steps/steps";
import { modelStats } from "@/lib/model/stats";
import { describeDiff, diffModels } from "@/lib/model/diff";
import {
  canRedo,
  canUndo,
  commitVersion,
  createWorkspace,
  currentVersion,
  isDirty,
  markSaved,
  openWorkspace,
  redo,
  restoreVersion,
  undo,
  type BuildDoc,
  type Version,
  type Workspace,
} from "@/lib/builds/doc";
import type { BuildSummary } from "@/lib/builds/store";
import { exportFileNames, exportLdr, exportMpd } from "@/lib/ldraw/export";
import { BrickModelSchema, type BrickModel } from "@/lib/model/schema";
import { CONFIG } from "@/lib/config";
import { streamGenerate } from "@/lib/client/sse";
import { download, prepareImage } from "@/lib/client/image";
import { TopBar, type SaveState } from "@/components/TopBar";
import { ChatPanel, type Draft, type Turn } from "@/components/ChatPanel";
import { LibraryPanel } from "@/components/LibraryPanel";
import { ModelTab } from "@/components/ModelTab";
import { ManualTab } from "@/components/ManualTab";
import { PartsTab } from "@/components/PartsTab";
import { DesignTab, compactJson } from "@/components/DesignTab";
import * as I from "@/components/icons";

type Tab = "model" | "manual" | "parts" | "design";
const TABS: { id: Tab; label: string; Icon: (p: { size?: number }) => React.ReactNode }[] = [
  { id: "model", label: "Model", Icon: I.Cube },
  { id: "manual", label: "Manual", Icon: I.Book },
  { id: "parts", label: "Parts", Icon: I.Bricks },
  { id: "design", label: "Design", Icon: I.Code },
];

export default function Page() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [side, setSide] = useState<"chat" | "library">("chat");
  const [tab, setTab] = useState<Tab>("model");
  // The open build: versions plus undo/redo history. The shown model is its current version.
  const [ws, setWs] = useState<Workspace | null>(null);
  const [saving, setSaving] = useState(false);
  // Latest workspace for callbacks that outlive a render (streamed generation results).
  const wsRef = useRef<Workspace | null>(null);
  const [manualStep, setManualStep] = useState(1);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState<Draft>({ text: "", size: "medium", pipeline: CONFIG.generator, image: null });
  const [running, setRunning] = useState(false);
  const [editing, setEditing] = useState(true);
  const [library, setLibrary] = useState<LibraryEntry[] | null>(null);
  const [builds, setBuilds] = useState<BuildSummary[] | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Theme: the layout script already set data-theme before paint; mirror it into state.
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    if (t === "dark" || t === "light") setTheme(t);
  }, []);
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("bf-theme", next);
    } catch {}
  }

  const version = ws ? currentVersion(ws) : null;
  const model = version?.model ?? null;
  const modelKey = ws?.doc.id ?? "none";
  const hasUnsaved = (w: Workspace | null) => !!w && isDirty(w) && (w.doc.versions.length > 1 || w.savedRev !== null);
  const dirtyWork = hasUnsaved(ws);
  wsRef.current = ws;
  const saveState: SaveState = !ws ? "none" : saving ? "saving" : isDirty(ws) ? "dirty" : "saved";

  const validation = useMemo(() => (model ? validate(model) : null), [model]);
  const steps = useMemo(() => (model ? buildSteps(model) : []), [model]);
  const stats = useMemo(() => (model ? modelStats(model) : null), [model]);

  /** Replace the open build. Asks first if that would drop unsaved edits. */
  function open(next: Workspace): boolean {
    const cur = wsRef.current;
    if (hasUnsaved(cur) && !window.confirm(`Discard unsaved changes to “${cur!.doc.name}”? Save first to keep its versions.`)) return false;
    wsRef.current = next;
    setWs(next);
    setManualStep(1);
    // On narrow screens the sidebar sits below the viewer; bring the model into view.
    if (window.matchMedia("(max-width: 959px)").matches) window.scrollTo({ top: 0, behavior: "smooth" });
    return true;
  }
  const openModel = (m: BrickModel, label: string, source: Version["source"]) => open(createWorkspace(m, label, source));

  function apply(fn: (w: Workspace) => Workspace) {
    setWs((w) => (w ? fn(w) : w));
  }

  async function save() {
    if (!ws || saving) return;
    const { doc, rev } = ws;
    setSaving(true);
    try {
      const res = await fetch("/api/builds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(doc) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      // Only mark saved if nothing changed while the request was in flight.
      setWs((w) => (w && w.doc.id === doc.id ? { ...w, savedRev: rev } : w));
      setSelected(`build:${doc.id}`);
      loadLibrary();
    } catch (e) {
      setNotice(`Couldn't save: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  // Keyboard: undo / redo / save (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const typing = (e.target as HTMLElement)?.closest("textarea, input, select");
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        save();
      } else if (!typing && k === "z") {
        e.preventDefault();
        apply(e.shiftKey ? redo : undo);
      } else if (!typing && k === "y") {
        e.preventDefault();
        apply(redo);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirtyWork) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirtyWork]);

  const loadLibrary = useCallback(async () => {
    setLibraryError(null);
    try {
      const [lib, saved] = await Promise.all([fetch("/api/library"), fetch("/api/builds")]);
      if (!lib.ok) throw new Error(`HTTP ${lib.status}`);
      if (!saved.ok) throw new Error(`HTTP ${saved.status}`);
      setLibrary((await lib.json()).entries);
      setBuilds((await saved.json()).builds);
    } catch (e) {
      setLibraryError(`Couldn't load the library (${(e as Error).message}).`);
    }
  }, []);
  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  async function pickEntry(e: LibraryEntry) {
    const key = `${e.kind}:${e.id}`;
    setNotice(null);
    try {
      const res = await fetch(`/api/library/model?kind=${e.kind}&id=${encodeURIComponent(e.id)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (!openModel(body.model, `Opened from ${e.kind === "debug" ? "a generation run" : `exports/${e.id}`}`, { kind: "open", debugDir: e.kind === "debug" ? e.id : undefined })) return;
      setSelected(key);
      if (body.skipped) setNotice(`${body.skipped} line(s) in ${e.id} used parts outside the library and were skipped.`);
    } catch (err) {
      setNotice(`Couldn't open ${e.name}: ${(err as Error).message}`);
    }
  }

  async function attach(file: File) {
    try {
      const img = await prepareImage(file);
      setDraft((d) => ({ ...d, image: { name: file.name, ...img } }));
    } catch (e) {
      setNotice(`Couldn't read that image: ${(e as Error).message}`);
    }
  }

  async function pickBuild(b: BuildSummary) {
    setNotice(null);
    try {
      const res = await fetch(`/api/builds/one?id=${encodeURIComponent(b.id)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (open(openWorkspace(body.doc as BuildDoc))) setSelected(`build:${b.id}`);
    } catch (err) {
      setNotice(`Couldn't open ${b.name}: ${(err as Error).message}`);
    }
  }

  function updateTurn(id: number, fn: (t: Turn) => Turn) {
    setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));
  }

  async function send() {
    const d = draft;
    const id = Date.now();
    const base = editing && model ? model : undefined;
    const docId = ws?.doc.id;
    setTurns((ts) => [
      ...ts,
      { id, kind: base ? "edit" : "build", baseName: base?.name, text: d.text.trim(), size: d.size, image: d.image ? { name: d.image.name, previewUrl: d.image.previewUrl } : undefined, status: "running", rounds: [] },
    ]);
    setDraft((x) => ({ ...x, text: "", image: null }));
    setRunning(true);
    setNotice(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const body = { text: d.text, size: d.size, pipeline: d.pipeline, image: d.image ? { mediaType: d.image.mediaType, data: d.image.data } : undefined, base };
      for await (const ev of streamGenerate(body, ac.signal)) onEvent(id, ev, base, docId, d.text.trim());
    } catch (e) {
      if (ac.signal.aborted) updateTurn(id, (t) => ({ ...t, status: "cancelled" }));
      else updateTurn(id, (t) => ({ ...t, status: "error", error: (e as Error).message }));
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function onEvent(id: number, ev: GenerateEvent, base?: BrickModel, docId?: string, prompt = "") {
    switch (ev.type) {
      case "round_start":
        updateTurn(id, (t) => ({ ...t, rounds: [...t.rounds, { round: ev.round, thinkingChars: 0, outputChars: 0 }] }));
        break;
      case "progress":
        updateTurn(id, (t) => ({ ...t, rounds: t.rounds.map((r) => (r.round === ev.round ? { ...r, thinkingChars: ev.thinkingChars, outputChars: ev.outputChars, thinking: ev.thinking } : r)) }));
        break;
      case "round_end":
        updateTurn(id, (t) => ({ ...t, rounds: t.rounds.map((r) => (r.round === ev.summary.round ? { ...r, summary: ev.summary, errors: ev.errors } : r)) }));
        break;
      case "done": {
        const r = ev.result;
        if (!r.model) {
          updateTurn(id, (t) => ({ ...t, status: "error", error: "Claude didn't return a usable model. The raw output is in the debug folder." }));
          break;
        }
        updateTurn(id, (t) => ({
          ...t,
          status: "done",
          result: {
            name: r.model!.name,
            description: r.model!.description,
            valid: r.valid,
            steps: r.steps.length,
            problems: r.validation?.errors.length ?? 0,
            cost: r.usage.cost,
            debugDir: r.debugDir,
            change: base ? describeDiff(diffModels(base, r.model!)) : undefined,
          },
        }));
        const debugDir = r.debugDir.split("/").pop();
        const source: Version["source"] = { kind: base ? "edit" : "build", prompt, debugDir, cost: r.usage.cost };
        const quote = (t: string) => (t.length > 60 ? `${t.slice(0, 57)}…` : t);
        if (base) {
          if (wsRef.current?.doc.id === docId) {
            // An edit becomes a new version of the open build (undoable).
            apply((w) => (w.doc.id === docId ? commitVersion(w, r.model!, `Edit: ${quote(prompt || "match the photo")}`, source) : w));
          } else {
            setNotice("That edit finished after you opened a different build, so it wasn't applied. It's in the Library under Generated.");
          }
        } else {
          if (openModel(r.model, prompt ? `Built from “${quote(prompt)}”` : "Built from a photo", source)) setSelected(`debug:${debugDir}`);
        }
        setTab("model");
        loadLibrary();
        break;
      }
      case "error":
        updateTurn(id, (t) => ({ ...t, status: "error", error: ev.message }));
        break;
    }
  }

  async function openJson(file: File) {
    try {
      const parsed = BrickModelSchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) throw new Error(parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      setNotice(null);
      if (openModel(parsed.data, `Opened ${file.name}`, { kind: "open" })) setSelected(null);
    } catch (e) {
      setNotice(`Couldn't open ${file.name}: ${(e as Error).message}`);
    }
  }

  function downloadModel(kind: "ldr" | "mpd" | "json") {
    if (!model) return;
    const names = exportFileNames(model);
    if (kind === "ldr") download(names.ldr, exportLdr(model, steps));
    if (kind === "mpd") download(names.mpd, exportMpd(model, steps));
    if (kind === "json") download(names.ldr.replace(/\.ldr$/, ".json"), compactJson(model), "application/json");
  }

  return (
    <div className="page">
      <div className="app">
        <TopBar
          model={model}
          stats={stats}
          steps={steps.length}
          problems={validation?.errors.length ?? 0}
          theme={theme}
          onToggleTheme={toggleTheme}
          onDownload={downloadModel}
          onOpenJson={openJson}
          canUndo={!!ws && canUndo(ws)}
          canRedo={!!ws && canRedo(ws)}
          onUndo={() => apply(undo)}
          onRedo={() => apply(redo)}
          versions={ws?.doc.versions ?? []}
          currentVersionId={version?.id ?? null}
          onRestore={(id) => apply((w) => restoreVersion(w, id))}
          saveState={saveState}
          onSave={save}
        />
        <div className="layout">
          <aside className="sidebar">
            <div className="side-head">
              <div className="seg" role="tablist" aria-label="Sidebar">
                <button role="tab" aria-selected={side === "chat"} className={side === "chat" ? "on" : ""} onClick={() => setSide("chat")}>
                  <I.Chat size={15} />
                  Chat
                </button>
                <button role="tab" aria-selected={side === "library"} className={side === "library" ? "on" : ""} onClick={() => setSide("library")}>
                  <I.Library size={15} />
                  Library
                </button>
              </div>
            </div>
            {side === "chat" ? (
              <ChatPanel
                turns={turns}
                draft={draft}
                running={running}
                modelName={model?.name ?? null}
                editing={editing}
                onToggleEdit={() => setEditing((e) => !e)}
                onDraft={(p) => setDraft((d) => ({ ...d, ...p }))}
                onAttach={attach}
                onSend={send}
                onStop={() => abortRef.current?.abort()}
              />
            ) : (
              <LibraryPanel entries={library} builds={builds} error={libraryError} selected={selected} onPick={pickEntry} onPickBuild={pickBuild} onRefresh={loadLibrary} />
            )}
          </aside>

          <main className="main">
            <div className="tabs" role="tablist" aria-label="View">
              {TABS.map(({ id, label, Icon }) => (
                <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? "on" : ""}`} onClick={() => setTab(id)} disabled={id !== "model" && !model}>
                  <span className="tab-icon"><Icon size={15} /></span>
                  {label}
                </button>
              ))}
            </div>
            {notice && (
              <div className="issues-card" style={{ position: "static", maxWidth: "none" }} role="alert">
                <span className="issue-icon">
                  <I.Warning size={15} />
                </span>
                <div className="issues-body">
                  <span style={{ color: "var(--k-text)" }}>{notice}</span>
                </div>
                <button className="icon-btn" style={{ width: 26, height: 26 }} aria-label="Dismiss" onClick={() => setNotice(null)}>
                  <I.Close size={14} />
                </button>
              </div>
            )}
            {(tab === "model" || !model) && (
              <ModelTab model={model} modelKey={modelKey} steps={steps} errors={validation?.errors ?? []} warnings={validation?.warnings ?? []} theme={theme} />
            )}
            {tab === "manual" && model && <ManualTab model={model} steps={steps} step={manualStep} onStep={setManualStep} />}
            {tab === "parts" && model && <PartsTab model={model} />}
            {tab === "design" && model && stats && <DesignTab model={model} stats={stats} steps={steps.length} onDownloadJson={() => downloadModel("json")} />}
          </main>
        </div>
      </div>
    </div>
  );
}
