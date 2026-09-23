"use client";

import { useEffect, useRef } from "react";
import type { Issue } from "@/lib/validate/validator";
import type { RoundSummary } from "@/lib/claude/generate";
import type { BuildSize } from "@/lib/prompts/design";
import { CONFIG } from "@/lib/config";
import * as I from "./icons";

export interface RoundState {
  round: number;
  thinkingChars: number;
  outputChars: number;
  thinking?: string;
  summary?: RoundSummary;
  errors?: Issue[];
}

export interface Turn {
  id: number;
  text: string;
  size: BuildSize;
  image?: { name: string; previewUrl: string };
  status: "running" | "done" | "error" | "cancelled";
  rounds: RoundState[];
  result?: { name: string; description: string; valid: boolean; steps: number; problems: number; cost: number; debugDir: string };
  error?: string;
}

export interface Draft {
  text: string;
  size: BuildSize;
  image: { name: string; mediaType: "image/jpeg"; data: string; previewUrl: string } | null;
}

const SIZES: { id: BuildSize; label: string }[] = [
  { id: "small", label: "Small" },
  { id: "medium", label: "Medium" },
  { id: "large", label: "Large" },
];

const usd = (n: number) => `$${n.toFixed(2)}`;
const k = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);

type RowState = "done" | "active" | "todo" | "fail";
interface Row {
  label: string;
  state: RowState;
  note: string;
}

/** Progress tracker rows derived from the streamed round events. */
function trackerRows(t: Turn): Row[] {
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
  hasModel: boolean;
  onDraft: (d: Partial<Draft>) => void;
  onAttach: (file: File) => void;
  onSend: () => void;
  onStop: () => void;
}) {
  const { draft } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canSend = !props.running && (draft.text.trim().length > 0 || !!draft.image);

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
                {t.text || (t.image ? "Build the subject of this photo." : "")}
                <span className="size-tag"> · {SIZES.find((s) => s.id === t.size)?.label}</span>
              </div>
            </div>
            <div className="msg-ai">
              {t.status === "running" && <p>Working on it. I&apos;ll design the model, check every stud connection and repair anything that doesn&apos;t hold together.</p>}
              {t.status === "done" && t.result && (
                <p>
                  Here&apos;s <b>{t.result.name}</b>. {t.result.description}
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
            placeholder="Describe what you want to build, or attach a photo…"
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
            <div className="seg small" role="radiogroup" aria-label="Model size">
              {SIZES.map((s) => (
                <button key={s.id} role="radio" aria-checked={draft.size === s.id} className={draft.size === s.id ? "on" : ""} onClick={() => props.onDraft({ size: s.id })}>
                  {s.label}
                </button>
              ))}
            </div>
            {props.hasModel && (
              <button className="edit-toggle" disabled title="Coming soon: describe changes to the current model in chat">
                <I.Pencil size={12} />
                Edit model
              </button>
            )}
            {props.running ? (
              <button className="send-btn stop" onClick={props.onStop}>
                Stop
              </button>
            ) : (
              <button className="send-btn" disabled={!canSend} onClick={props.onSend} aria-label="Build it">
                Build it
                <I.ArrowUp size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
