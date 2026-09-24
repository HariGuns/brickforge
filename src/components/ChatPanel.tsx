"use client";

import { useEffect, useRef } from "react";
import type { Issue } from "@/lib/validate/validator";
import type { RoundSummary } from "@/lib/claude/generate";
import type { BuildSize } from "@/lib/prompts/design";
import { CONFIG } from "@/lib/config";
import { AVAILABLE_PIPELINES, type Pipeline } from "@/lib/claude/pipeline";
import * as I from "./icons";

export interface RoundState {
  /** "main" for single pass; "plan", "sub:<id>" or "assembly" for the sub-build path. */
  scope: string;
  round: number;
  thinkingChars: number;
  outputChars: number;
  thinking?: string;
  summary?: RoundSummary;
  errors?: Issue[];
}

export interface Turn {
  id: number;
  kind: "build" | "edit";
  /** Name of the model being edited (edit turns). */
  baseName?: string;
  text: string;
  size: BuildSize;
  image?: { name: string; previewUrl: string };
  status: "running" | "done" | "error" | "cancelled";
  rounds: RoundState[];
  /** Sub-build path stages, in the order they started. */
  stages?: StageState[];
  /** Part searches Claude made (search_parts), latest last. */
  searches?: string[];
  result?: { name: string; description: string; valid: boolean; steps: number; problems: number; cost: number; debugDir: string; change?: string; parts?: number; subBuilds?: number; copies?: number; compileMs?: number };
  error?: string;
}

export interface StageState {
  scope: string;
  label: string;
  status: "start" | "done";
  valid?: boolean;
  parts?: number;
  copies?: number;
  cost?: number;
}

export interface Draft {
  text: string;
  size: BuildSize;
  /** Generator path for new builds (testing setting). */
  pipeline: Pipeline;
  image: { name: string; mediaType: "image/jpeg"; data: string; previewUrl: string } | null;
}

const SIZES: { id: BuildSize; label: string }[] = [
  { id: "small", label: "Small" },
  { id: "medium", label: "Medium" },
  { id: "large", label: "Large" },
];

/** "Try one" suggestions for the empty chat; picking one fills the composer (it doesn't send). */
const SUGGESTIONS: { label: string; text: string; size: BuildSize; pipeline: Pipeline }[] = [
  { label: "Cottage with a garden", text: "a cozy cottage with a flower garden and a picket fence", size: "medium", pipeline: "single" },
  { label: "Red fire truck", text: "a red fire truck with a ladder", size: "medium", pipeline: "single" },
  { label: "Lighthouse", text: "a striped lighthouse on a rocky island", size: "medium", pipeline: "single" },
  { label: "Castle (large)", text: "a medieval castle with four corner towers, walls and a gatehouse", size: "large", pipeline: "subbuilds" },
];

const usd = (n: number) => `$${n.toFixed(2)}`;
const k = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);

type RowState = "done" | "active" | "todo" | "fail";
interface Row {
  label: string;
  state: RowState;
  note: string;
}

/** Tracker rows for the sub-build path: planning, one row per unique sub-build, assembly. */
function stageRows(t: Turn): Row[] {
  const rows: Row[] = [];
  const roundsOf = (scope: string) => t.rounds.filter((r) => r.scope === scope);
  const live = (scope: string) => {
    const rs = roundsOf(scope);
    const cur = rs.at(-1);
    if (!cur) return "starting";
    if (cur.summary) return cur.summary.errorCount ? `${cur.summary.errorCount} problem${cur.summary.errorCount === 1 ? "" : "s"}` : "checking";
    return `${cur.round ? `repair ${cur.round} · ` : ""}${cur.outputChars ? `writing ${k(cur.outputChars)}` : `thinking ${k(cur.thinkingChars)}`}`;
  };
  const running = t.status === "running";
  for (const s of t.stages ?? []) {
    const reps = Math.max(0, roundsOf(s.scope).length - 1);
    const label = s.scope.startsWith("sub:") ? `Sub-build · ${s.label}${s.copies && s.copies > 1 ? ` ×${s.copies}` : ""}` : s.scope === "plan" ? "Planning sub-builds" : s.scope === "assembly" ? "Assembling" : s.label;
    if (s.status === "start") rows.push({ label, state: running ? "active" : "fail", note: running ? live(s.scope) : "" });
    else {
      const what = s.scope === "plan" ? `${s.parts ?? 0} sub-builds` : `${s.parts ?? 0} parts`;
      rows.push({ label, state: s.valid ? "done" : "fail", note: `${what}${reps ? ` · ${reps} repair${reps === 1 ? "" : "s"}` : ""}${s.valid ? "" : " · has problems"}` });
    }
  }
  if (t.status === "error" || t.status === "cancelled") rows.push({ label: t.status === "cancelled" ? "Cancelled" : "Failed", state: "fail", note: "" });
  else
    rows.push({
      label: "Done",
      state: t.status === "done" ? "done" : "todo",
      note: t.result ? `${t.result.valid ? "buildable" : `${t.result.problems} left`} · ${t.result.subBuilds ?? 0} sub-builds, ${t.result.copies ?? 0} copies` : "",
    });
  return rows;
}

/** Progress tracker rows derived from the streamed round events. */
function trackerRows(t: Turn): Row[] {
  if (t.stages?.length) return stageRows(t);
  const r0 = t.rounds[0];
  const rows: Row[] = [];
  const designNote = r0?.summary
    ? r0.summary.partCount
      ? `${r0.summary.partCount} parts`
      : "no usable output"
    : r0
      ? r0.outputChars
        ? `writing · ${k(r0.outputChars)} chars`
        : `thinking · ${k(r0.thinkingChars)} chars`
      : "";
  if (t.searches?.length) {
    const last = t.searches.at(-1)!.split(" → ")[0];
    rows.push({ label: "Finding parts", state: r0?.summary || r0?.outputChars ? "done" : "active", note: `${t.searches.length} search${t.searches.length === 1 ? "" : "es"} · ${last}` });
  }
  rows.push({ label: "Designing", state: r0?.summary ? "done" : t.status === "running" ? "active" : "todo", note: designNote });

  rows.push({
    label: "Checking connections",
    state: r0?.summary ? "done" : "todo",
    note: r0?.summary ? (r0.summary.errorCount ? `${r0.summary.errorCount} problem${r0.summary.errorCount === 1 ? "" : "s"}` : "all connected") : "",
  });

  for (const r of t.rounds.slice(1)) {
    const prev = t.rounds[r.round - 1]?.summary?.errorCount ?? 0;
    rows.push({
      label: `Repair round ${r.round} of ${CONFIG.maxRepairRounds}`,
      state: r.summary ? "done" : t.status === "running" ? "active" : "fail",
      note: r.summary ? (r.summary.errorCount ? `${r.summary.errorCount} left` : "fixed") : `fixing ${prev} problem${prev === 1 ? "" : "s"}`,
    });
  }

  if (t.status === "error" || t.status === "cancelled") {
    rows.push({ label: t.status === "cancelled" ? "Cancelled" : "Failed", state: "fail", note: "" });
  } else {
    rows.push({
      label: "Done",
      state: t.status === "done" ? "done" : "todo",
      note: t.result ? (t.result.valid ? `buildable · ${t.result.steps} steps` : `best attempt · ${t.result.problems} left`) : "",
    });
  }
  return rows;
}

function Tracker({ turn }: { turn: Turn }) {
  const cost = turn.result?.cost ?? turn.rounds.reduce((s, r) => s + (r.summary?.usage.cost ?? 0), 0);
  const counted = turn.result || turn.rounds.some((r) => r.summary);
  const live = turn.rounds.at(-1);
  return (
    <div className="tracker">
      {trackerRows(turn).map((row, i) => (
        <div key={i} className={`trk-row ${row.state}`}>
          <span className={`trk-dot ${row.state}`} aria-hidden="true">
            {row.state === "done" && <I.Check size={11} />}
            {row.state === "fail" && <I.Close size={11} strokeWidth={3.5} />}
          </span>
          <span className="trk-label">{row.label}</span>
          <span className="trk-note">{row.note}</span>
        </div>
      ))}
      {turn.status === "running" && live && !live.summary && live.thinking && <p className="trk-thinking">…{live.thinking.slice(-160)}</p>}
      <div className="trk-cost">
        <span>Running cost</span>
        <span>{turn.status !== "running" ? usd(cost) : counted ? `${usd(cost)} so far` : "counted after each round"}</span>
      </div>
      {turn.result && <div className="trk-debug mono" title="Raw outputs and validator results for prompt tuning">debug/{turn.result.debugDir.split("/").pop()}</div>}
    </div>
  );
}

export function ChatPanel(props: {
  turns: Turn[];
  draft: Draft;
  running: boolean;
  /** Name of the loaded model, if any; enables edit mode. */
  modelName: string | null;
  editing: boolean;
  onToggleEdit: () => void;
  onDraft: (d: Partial<Draft>) => void;
  onAttach: (file: File) => void;
  onSend: () => void;
  onStop: () => void;
}) {
  const { draft } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canSend = !props.running && (draft.text.trim().length > 0 || !!draft.image);
  const editing = props.editing && !!props.modelName;

  // Keep the newest message in view as the tracker updates.
  const last = props.turns.at(-1);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [props.turns.length, last?.rounds.length, last?.status]);

  return (
    <div className="chat">
      <div className="chat-scroll" ref={scrollRef}>
        {props.turns.length === 0 && (
          <div className="chat-empty">
            <b>What should we build?</b>
            Describe a model or attach a photo. Claude designs it, checks every connection and repairs problems until it&apos;s buildable.
            <div className="try-one">
              <span className="section-label">Try one</span>
              <div className="try-chips">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    className="try-chip"
                    onClick={() => {
                      if (props.modelName && editing) props.onToggleEdit();
                      props.onDraft({ text: s.text, size: s.size, pipeline: s.pipeline });
                      requestAnimationFrame(() => document.getElementById("composer")?.focus());
                    }}
                    title={s.text}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {props.turns.map((t) => (
          <div key={t.id} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="msg-user">
              {t.image && (
                <div className="attach-chip">
                  <img src={t.image.previewUrl} alt="" />
                  <span>{t.image.name}</span>
                </div>
              )}
              <div className="bubble">
                {t.kind === "edit" && <span className="edit-tag">Edit · {t.baseName}</span>}
                {t.text || (t.image ? (t.kind === "edit" ? "Match the photo more closely." : "Build the subject of this photo.") : "")}
                {t.kind === "build" && <span className="size-tag"> · {SIZES.find((s) => s.id === t.size)?.label}</span>}
              </div>
            </div>
            <div className="msg-ai">
              {t.status === "running" && (
                <p>
                  {t.kind === "edit"
                    ? "Working on the change. I'll keep the rest of the model as it is, then check every connection again."
                    : "Working on it. I'll design the model, check every stud connection and repair anything that doesn't hold together."}
                </p>
              )}
              {t.status === "done" && t.result && (
                <p>
                  {t.kind === "edit" ? <>Updated <b>{t.result.name}</b>: {t.result.change}. </> : <>Here&apos;s <b>{t.result.name}</b>. </>}
                  {t.kind === "build" && t.result.description}
                  {!t.result.valid && <span className="err"> It still has {t.result.problems} problem{t.result.problems === 1 ? "" : "s"}, shown in red.</span>}
                </p>
              )}
              {t.status === "error" && <p className="err">{t.error}</p>}
              {t.status === "cancelled" && <p className="muted">Stopped.</p>}
              <Tracker turn={t} />
            </div>
          </div>
        ))}
      </div>

      <div className="composer-wrap">
        {props.modelName && (
          <div className="seg small mode-toggle" role="radiogroup" aria-label="What the next message does">
            <button role="radio" aria-checked={editing} className={editing ? "on" : ""} onClick={() => !editing && props.onToggleEdit()} title={`Messages change ${props.modelName}`}>
              <I.Pencil size={12} />
              Change this build
            </button>
            <button role="radio" aria-checked={!editing} className={!editing ? "on" : ""} onClick={() => editing && props.onToggleEdit()} title="Messages start a new model">
              <I.Sparkle size={12} />
              Start a new build
            </button>
          </div>
        )}
        <div className="composer">
          {draft.image && (
            <div className="attach-chip">
              <img src={draft.image.previewUrl} alt="" />
              <span>{draft.image.name}</span>
              <button className="chip-x" aria-label="Remove photo" onClick={() => props.onDraft({ image: null })}>
                <I.Close size={12} />
              </button>
            </div>
          )}
          <label className="sr-only" htmlFor="composer">Describe what you want to build</label>
          <textarea
            id="composer"
            rows={2}
            placeholder={editing ? `Describe a change to ${props.modelName}…` : "Describe what you want to build, or attach a photo…"}
            value={draft.text}
            onChange={(e) => props.onDraft({ text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSend) props.onSend();
              }
            }}
          />
          <div className="composer-row">
            <button className="icon-btn" style={{ width: 32, height: 32 }} aria-label="Attach photo" title="Attach photo" onClick={() => fileRef.current?.click()}>
              <I.Paperclip />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) props.onAttach(f);
              }}
            />
            {!editing && (
              <div className="seg small" role="radiogroup" aria-label="Model size">
                {SIZES.map((s) => (
                  <button key={s.id} role="radio" aria-checked={draft.size === s.id} className={draft.size === s.id ? "on" : ""} onClick={() => props.onDraft({ size: s.id })}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
            {!editing && (
              <label className="path-select" title="Generator path (testing): single pass, sub-builds, or auto (sub-builds for Large)">
                <span className="sr-only">Generator path</span>
                <select value={draft.pipeline} onChange={(e) => props.onDraft({ pipeline: e.target.value as Pipeline })}>
                  {(
                    [
                      ["single", "Single pass"],
                      ["subbuilds", "Sub-builds"],
                      ["auto", "Auto"],
                    ] as const
                  ).map(([id, label]) => (
                    <option key={id} value={id} disabled={!AVAILABLE_PIPELINES.includes(id)}>
                      {label}
                      {!AVAILABLE_PIPELINES.includes(id) ? " (soon)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {props.running ? (
              <button className="send-btn stop" onClick={props.onStop}>
                Stop
              </button>
            ) : (
              <button className="send-btn" disabled={!canSend} onClick={props.onSend} aria-label={editing ? "Apply change" : "Build it"}>
                {editing ? "Apply" : "Build it"}
                <I.ArrowUp size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
