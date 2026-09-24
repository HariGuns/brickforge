"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BrickModel } from "@/lib/model/schema";
import type { BuildStep } from "@/lib/steps/steps";
import type { Issue } from "@/lib/validate/validator";
import type { CameraView } from "./Viewer";
import { Viewer } from "./ViewerLazy";
import * as I from "./icons";

export const SPEEDS = [0.5, 1, 2, 4] as const;
/** Milliseconds per build step at 1× playback. */
const STEP_MS = 700;

const LABEL: Partial<Record<Issue["code"], [string, string]>> = {
  OVERLAP: ["overlap", "overlaps"],
  FLOATING: ["floating part", "floating parts"],
  UNSUPPORTED: ["part with nothing under it", "parts with nothing under them"],
  DISCONNECTED: ["disconnected section", "disconnected sections"],
  OUT_OF_BOUNDS: ["part out of bounds", "parts out of bounds"],
  UNKNOWN_PART: ["unknown part", "unknown parts"],
  UNKNOWN_COLOR: ["unknown colour", "unknown colours"],
  TOO_MANY_PARTS: ["part-count overflow", "part-count overflows"],
  WEAK_CONNECTION: ["weak single-stud connection", "weak single-stud connections"],
  WEAK_JOINT: ["overloaded single-stud joint", "overloaded single-stud joints"],
  OVERSTRESSED: ["overhang with too much leverage", "overhangs with too much leverage"],
  DETACHED_SUBBUILD: ["detached sub-build copy", "detached sub-build copies"],
  SUBBUILD_UNSUPPORTED: ["sub-build copy with nothing under it", "sub-build copies with nothing under them"],
  INTERLOCKED: ["interlocking sub-build group", "interlocking sub-build groups"],
};

function summarize(list: Issue[]): string {
  const counts = new Map<Issue["code"], number>();
  for (const e of list) counts.set(e.code, (counts.get(e.code) ?? 0) + 1);
  return [...counts]
    .map(([c, n]) => {
      const [one, many] = LABEL[c] ?? [c.toLowerCase(), c.toLowerCase()];
      return `${n} ${n === 1 ? one : many}`;
    })
    .join(", ");
}

export function ModelTab(props: {
  model: BrickModel | null;
  modelKey: string;
  steps: BuildStep[];
  errors: Issue[];
  warnings: Issue[];
  theme: "light" | "dark";
  /** Parts to highlight from outside (e.g. a sub-build's copies picked in the Design tab). */
  focusParts?: Set<number>;
  onClearFocus?: () => void;
}) {
  const { model, steps } = props;
  const [view, setView] = useState<CameraView>("3/4");
  const [viewNonce, setViewNonce] = useState(0);
  const [spin, setSpin] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [showList, setShowList] = useState(false);
  const [focus, setFocus] = useState<number | null>(null);
  const [progress, setProgress] = useState(steps.length);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const panelRef = useRef<HTMLDivElement>(null);

  // New model: show it finished, reset issue UI.
  useEffect(() => {
    setProgress(steps.length);
    setPlaying(false);
    setDismissed(false);
    setShowList(false);
    setFocus(null);
  }, [props.modelKey, steps.length]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setProgress((p) => {
        if (p + 1 >= steps.length) {
          setPlaying(false);
          return steps.length;
        }
        return p + 1;
      });
    }, STEP_MS / speed);
    return () => clearInterval(t);
  }, [playing, speed, steps.length]);

  const finished = progress >= steps.length;
  const visible = useMemo(() => (finished ? undefined : new Set(steps.slice(0, progress).flatMap((s) => s.parts))), [finished, steps, progress]);
  const placed = finished ? (model?.parts.length ?? 0) : (visible?.size ?? 0);
  const issues = [...props.errors, ...props.warnings];
  const errorParts = useMemo(() => new Set(props.errors.flatMap((e) => e.parts)), [props.errors]);
  const warnParts = useMemo(() => new Set(props.warnings.flatMap((e) => e.parts)), [props.warnings]);
  const highlight =
    focus !== null ? new Set(issues[focus]?.parts ?? []) : playing && progress > 0 ? new Set(steps[progress - 1]?.parts ?? []) : props.focusParts;

  function play() {
    if (!steps.length) return;
    if (finished) setProgress(0);
    setPlaying(true);
  }
  function pickView(v: CameraView) {
    setView(v);
    setViewNonce((n) => n + 1);
  }
  function fullscreen() {
    const el = panelRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  }

  const fmt = (n: number) => n.toLocaleString("en-US");
  const pct = steps.length ? Math.round((progress / steps.length) * 100) : 0;

  return (
    <>
      <div className="stage-panel" ref={panelRef}>
        {model ? (
          <div className="canvas-host">
            <Viewer
              model={model}
              visible={visible}
              highlight={highlight}
              errorParts={errorParts}
              warnParts={warnParts}
              fitKey={`${props.modelKey}|${viewNonce}`}
              view={view}
              spin={spin}
              theme={props.theme}
            />
          </div>
        ) : (
          <div className="stage-empty">
            <b>No model yet</b>
            <span>Describe something in the chat, or pick a saved model from the Library.</span>
          </div>
        )}

        <div className="overlay-tl">
          <div className="toolgroup" role="group" aria-label="Camera">
            {(
              [
                ["3/4", "3/4", I.Cube],
                ["front", "Front", I.Front],
                ["top", "Top", I.Top],
              ] as const
            ).map(([id, label, Icon]) => (
              <button key={id} className={`tool-btn ${view === id ? "on" : ""}`} aria-pressed={view === id} onClick={() => pickView(id)} disabled={!model}>
                <Icon size={14} />
                <span className="lbl">{label}</span>
              </button>
            ))}
            <button className="tool-btn square" aria-label="Full screen" title="Full screen" onClick={fullscreen} disabled={!model}>
              <I.Fullscreen size={14} />
            </button>
          </div>
          <button className={`float-btn ${spin ? "on" : ""}`} aria-pressed={spin} onClick={() => setSpin((s) => !s)} disabled={!model}>
            <I.Eye size={14} />
            Spin
          </button>
        </div>
        {props.focusParts && (
          <div className="focus-chip">
            {props.focusParts.size} parts highlighted
            <button className="chip-x" aria-label="Clear highlight" onClick={props.onClearFocus}>
              <I.Close size={12} />
            </button>
          </div>
        )}
        <div className="overlay-tr">
          <button className="float-btn accent-ink" disabled title="Coming soon: presentation mode">
            <I.Sparkle size={14} />
            <span className="lbl">Showcase</span>
          </button>
        </div>

        {model && issues.length > 0 && !dismissed && (
          <div className="issues-card" role="status">
            <span className="issue-icon">
              <I.Warning size={15} />
            </span>
            <div className="issues-body">
              <b>
                {issues.length} issue{issues.length === 1 ? "" : "s"} found
              </b>
              <span>
                {props.errors.length > 0 && `${summarize(props.errors)}. `}
                {props.warnings.length > 0 && `${summarize(props.warnings)}. `}
                {props.errors.length > 0 ? "Problem parts are outlined in red" : "Outlined in amber"}
                {props.errors.length > 0 && props.warnings.length > 0 ? ", warnings in amber." : "."}
              </span>
              <button className="link-btn" onClick={() => (setShowList((s) => !s), setFocus(null))}>
                {showList ? "Hide details" : "Show details"}
              </button>
              {showList && (
                <ul className="issue-list">
                  {issues.map((e, i) => (
                    <li key={i}>
                      <button className={focus === i ? "on" : ""} onClick={() => setFocus(focus === i ? null : i)} title="Highlight these parts">
                        <span className={`code ${e.severity === "warning" ? "warn" : ""}`}>{e.code}</span>
                        {e.message}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button className="icon-btn" style={{ width: 26, height: 26 }} aria-label="Dismiss" onClick={() => setDismissed(true)}>
              <I.Close size={14} />
            </button>
          </div>
        )}
      </div>

      <div className="playbar">
        <div className="play-controls">
          <button className="round-btn" aria-label="Back to start" onClick={() => (setPlaying(false), setProgress(0))} disabled={!steps.length}>
            <I.SkipStart />
          </button>
          <button className="play-btn" aria-label={playing ? "Pause" : "Play build"} onClick={() => (playing ? setPlaying(false) : play())} disabled={!steps.length}>
            {playing ? <I.Pause /> : <I.Play />}
          </button>
          <button className="round-btn" aria-label="Skip to end" onClick={() => (setPlaying(false), setProgress(steps.length))} disabled={!steps.length}>
            <I.SkipEnd />
          </button>
        </div>
        <div className="speeds" role="radiogroup" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button key={s} role="radio" aria-checked={speed === s} className={speed === s ? "on" : ""} onClick={() => setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
        <div className="play-info">
          <div className="play-head">
            <b>{!model ? "No model" : finished ? "Finished model" : progress === 0 ? "Empty build plate" : `Building · step ${progress}`}</b>
            <span>{model ? (finished ? `${fmt(model.parts.length)} pieces · ${steps.length} steps` : `${fmt(placed)} of ${fmt(model.parts.length)} pieces`) : ""}</span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(1, steps.length)}
            value={progress}
            disabled={!steps.length}
            aria-label="Build progress"
            onChange={(e) => (setPlaying(false), setProgress(Number(e.target.value)))}
          />
        </div>
        <span className="play-label">{!model ? "–" : finished ? "Finished" : `${pct}%`}</span>
      </div>
    </>
  );
}
