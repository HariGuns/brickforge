"use client";

import { useEffect, useRef } from "react";
import type { Issue } from "@/lib/validate/validator";
import type { RoundSummary } from "@/lib/claude/generate";
import { DETAILS, type Detail } from "@/lib/detail";
import { CONFIG } from "@/lib/config";
import type { Pipeline } from "@/lib/claude/pipeline";
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
  detail: Detail;
  image?: { name: string; previewUrl: string };
  status: "running" | "done" | "error" | "cancelled";
  rounds: RoundState[];
  /** Sub-build path stages, in the order they started. */
  stages?: StageState[];
  /** Part searches Claude made (search_parts), latest last. */
  searches?: string[];
  /** Photo builds: comparison rounds against the photo. */
  refines?: { round: number; rounds: number; status: "start" | "done"; matches?: boolean; differences?: string[]; accepted?: boolean; cost?: number }[];
  /** Photo builds: what the analysis found and the size it set. */
  analysis?: { subject: string; ratio: string; size: string; cost: number };
  result?: { name: string; description: string; valid: boolean; steps: number; problems: number; cost: number; debugDir: string; change?: string; parts?: number; subBuilds?: number; copies?: number; compileMs?: number; library?: { reused: number; copies: number; saved: number; added: number } };
  error?: string;
  /** Budget cap for this build (USD), if one was set. */
  budget?: number;
  /** The build stopped at its budget cap. */
  budgetStop?: { cap: number; spent: number; next: string; resume?: string; savedComponents?: number };
}

export interface StageState {
  scope: string;
  label: string;
  status: "start" | "done";
  valid?: boolean;
  parts?: number;
  copies?: number;
  cost?: number;
  /** Tree mode: 1 = placed by the main build. */
  depth?: number;
  /** Reused from the component library. */
  reused?: { component: string; saved: number; recolor?: string[] };
}

export interface Draft {
  text: string;
  detail: Detail;
  /** Generator path for new builds (testing setting). */
  pipeline: Pipeline;
  /** Budget cap in USD for new builds and edits (null = none). */
  budget: number | null;
  image: { name: string; mediaType: "image/jpeg"; data: string; previewUrl: string } | null;
}

/** "Try one" suggestions for the empty chat; picking one fills the composer (it doesn't send). */
const SUGGESTIONS: { label: string; text: string; detail: Detail; pipeline: Pipeline }[] = [
  { label: "Cottage with a garden", text: "a cozy cottage with a flower garden and a picket fence", detail: "standard", pipeline: "auto" },
  { label: "Red fire truck", text: "a red fire truck with a ladder", detail: "standard", pipeline: "auto" },
  { label: "Lighthouse", text: "a striped lighthouse on a rocky island", detail: "standard", pipeline: "auto" },
  { label: "Castle (high detail)", text: "a medieval castle with four corner towers, walls and a gatehouse", detail: "high", pipeline: "auto" },
];

const usd = (n: number) => `$${n.toFixed(2)}`;
const k = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);

type RowState = "done" | "active" | "todo" | "fail";
interface Row {
  label: string;
  state: RowState;
  note: string;
  /** Indent (tree mode: sub-builds below the top level). */
  indent?: number;
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
    const times = s.copies && s.copies > 1 ? ` ×${s.copies}` : "";
    const label = s.scope.startsWith("sub:")
      ? `Sub-build · ${s.label}${times}`
      : s.scope.startsWith("plan:")
        ? `Planning · ${s.label}`
        : s.scope.startsWith("asm:")
          ? `Assembling · ${s.label}${times}`
          : s.scope.startsWith("lib:")
            ? `From library · ${s.label}${times}`
          : s.scope === "plan"
            ? "Planning sub-builds"
            : s.scope === "assembly"
              ? "Assembling"
              : s.label;
    const indent = s.depth ? s.depth - 1 : 0;
    if (s.scope === "analysis") rows.push(analysisRow(t));
    else if (s.reused) rows.push({ label, state: "done", note: `reused · ${s.parts ?? 0} parts${s.reused.recolor?.length ? ` · recoloured ${s.reused.recolor.join(", ")}` : ""}${s.reused.saved ? ` · saves ~${usd(s.reused.saved)}` : ""}`, indent });
    else if (s.status === "start") rows.push({ label, state: running ? "active" : "fail", note: running ? live(s.scope) : "", indent });
    else {
      const what = s.scope === "plan" ? `${s.parts ?? 0} sub-builds` : s.scope.startsWith("plan:") ? `${s.parts ?? 0} children` : `${s.parts ?? 0} parts`;
      rows.push({ label, state: s.valid ? "done" : "fail", note: `${what}${reps ? ` · ${reps} repair${reps === 1 ? "" : "s"}` : ""}${s.valid ? "" : " · has problems"}`, indent });
    }
  }
  rows.push(...refineRows(t));
  if (t.budgetStop) rows.push(budgetRow(t.budgetStop));
  if (t.status === "error" || t.status === "cancelled") rows.push({ label: t.status === "cancelled" ? "Cancelled" : "Failed", state: "fail", note: "" });
  else
    rows.push({
      label: "Done",
      state: t.status === "done" ? "done" : "todo",
      note: t.result
        ? `${t.result.valid ? "buildable" : `${t.result.problems} left`} · ${t.result.subBuilds ?? 0} sub-builds, ${t.result.copies ?? 0} copies${t.result.library?.reused ? ` · ${t.result.library.reused} from the library` : ""}${t.result.library?.added ? ` · ${t.result.library.added} saved to it` : ""}`
        : "",
    });
  return rows;
}

/** "Budget cap reached": what was spent and what didn't start. */
function budgetRow(b: NonNullable<Turn["budgetStop"]>): Row {
  const what = b.next.replace(/^(sub|asm|plan|lib):/, "");
  return { label: "Budget cap reached", state: "fail", note: `${usd(b.spent)} of ${usd(b.cap)} · stopped before ${what}${b.savedComponents ? ` · ${b.savedComponents} sub-builds saved to the library` : ""}` };
}

/** "Comparing with the photo (1 of 2)": what differed, and whether the correction was taken. */
function refineRows(t: Turn): Row[] {
  return (t.refines ?? []).map((r) => {
    const label = `Comparing with the photo (${r.round} of ${r.rounds})`;
    if (r.status === "start") return { label, state: t.status === "running" ? "active" : "fail", note: t.status === "running" ? "rendering and comparing" : "" };
    const diffs = r.differences?.length ? `${r.differences.length} difference${r.differences.length === 1 ? "" : "s"}: ${r.differences.slice(0, 2).join("; ")}${r.differences.length > 2 ? "; …" : ""}` : "";
    const what = r.matches ? `matches${diffs ? ` · ${diffs}` : ""}` : r.accepted ? `refined · ${diffs}` : `correction didn't pass the checks, kept the previous model`;
    return { label, state: r.matches || r.accepted ? "done" : "fail", note: `${what} · ${usd(r.cost ?? 0)}` };
  });
}

/** "Reading the photo": the subject, its proportions and the size it set. */
function analysisRow(t: Turn): Row {
  const a = t.analysis;
  return {
    label: "Reading the photo",
    state: a ? "done" : t.status === "running" ? "active" : "fail",
    note: a ? `${a.subject} · ${a.ratio} · ${a.size} · ${usd(a.cost)}` : t.status === "running" ? "proportions, features, colours" : "",
  };
}

/** Progress tracker rows derived from the streamed round events. */
function trackerRows(t: Turn): Row[] {
  if (t.stages?.length) return stageRows(t);
  const main = t.rounds.filter((r) => r.scope === "main");
  const r0 = main[0];
  const rows: Row[] = [];
  if (t.image && t.kind === "build") rows.push(analysisRow(t));
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

  for (const r of main.slice(1)) {
    const prev = main[r.round - 1]?.summary?.errorCount ?? 0;
    rows.push({
      label: `Repair round ${r.round} of ${CONFIG.maxRepairRounds}`,
      state: r.summary ? "done" : t.status === "running" ? "active" : "fail",
      note: r.summary ? (r.summary.errorCount ? `${r.summary.errorCount} left` : "fixed") : `fixing ${prev} problem${prev === 1 ? "" : "s"}`,
    });
  }

  rows.push(...refineRows(t));
  if (t.budgetStop) rows.push(budgetRow(t.budgetStop));
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
        <div key={i} className={`trk-row ${row.state}`} style={row.indent ? { paddingLeft: row.indent * 14 } : undefined}>
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
        <span>
          {turn.status !== "running" ? usd(cost) : counted ? `${usd(cost)} so far` : "counted after each round"}
          {turn.budget ? ` · cap ${usd(turn.budget)}` : ""}
        </span>
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
                      props.onDraft({ text: s.text, detail: s.detail, pipeline: s.pipeline });
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
                {t.kind === "build" && <span className="size-tag"> · {DETAILS.find((d) => d.id === t.detail)?.label} detail</span>}
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
              <div className="seg small" role="radiogroup" aria-label="Detail" title="Detail: how big and detailed the model is (target width and part budget). Auto uses sub-builds for High and Very high.">
                {DETAILS.map((s) => (
                  <button key={s.id} role="radio" aria-checked={draft.detail === s.id} className={draft.detail === s.id ? "on" : ""} onClick={() => props.onDraft({ detail: s.id })}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
            <label className="path-select" title="Budget cap: the build stops before any call that would take its cost over this (finished stages are kept)">
              <span className="sr-only">Budget cap</span>
              <select value={draft.budget ?? ""} onChange={(e) => props.onDraft({ budget: e.target.value ? Number(e.target.value) : null })}>
                <option value="">No cap</option>
                {[1, 2, 5, 10, 15, 25].map((v) => (
                  <option key={v} value={v}>
                    Cap ${v}
                  </option>
                ))}
              </select>
            </label>
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
                    <option key={id} value={id}>
                      {label}
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
