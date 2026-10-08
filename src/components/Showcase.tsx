"use client";

import { useEffect, useMemo, useState } from "react";
import type { StepSection } from "@/lib/design/steps";
import { Viewer } from "./ViewerLazy";
import * as I from "./icons";

const SPEEDS = [0.5, 1, 2, 4] as const;
/** Milliseconds per step at 1×, and the pause after each finished section. */
const STEP_MS = 650;
const SECTION_PAUSE_MS = 1400;

/**
 * Showcase: an animated build that assembles each sub-build on its own, then
 * the main build, with the parts of each step highlighted as they go on.
 */
export function Showcase(props: { sections: StepSection[]; modelName: string; theme: "light" | "dark"; onClose: () => void }) {
  const { sections } = props;
  const total = sections.reduce((n, s) => n + s.steps.length, 0);
  const [section, setSection] = useState(0);
  const [step, setStep] = useState(0); // steps shown in the current section
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [playing, setPlaying] = useState(true);
  const sec = sections[section];
  const done = section === sections.length - 1 && step >= sec.steps.length;

  // Advance one step at a time; pause at the end of a section, then move on.
  useEffect(() => {
    if (!playing || done) return;
    const endOfSection = step >= sec.steps.length;
    const t = setTimeout(
      () => {
        if (endOfSection) {
          setSection((s) => s + 1);
          setStep(0);
        } else setStep((s) => s + 1);
      },
      endOfSection ? SECTION_PAUSE_MS / speed : STEP_MS / speed,
    );
    return () => clearTimeout(t);
  }, [playing, done, step, sec, speed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
      if (e.key === " ") (e.preventDefault(), setPlaying((p) => !p));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  const visible = useMemo(() => new Set([...(sec.base ?? []), ...sec.steps.slice(0, step).flatMap((s) => s.parts)]), [sec, step]);
  const highlight = useMemo(() => new Set(step > 0 && !done ? sec.steps[step - 1].parts : []), [sec, step, done]);
  const globalStep = sections.slice(0, section).reduce((n, s) => n + s.steps.length, 0) + Math.min(step, sec.steps.length);
  const copies = sec.copies > 1 ? ` ×${sec.copies}` : "";
  const title = done ? `${props.modelName} is complete` : sec.kind === "baseplate" ? "Laying the baseplate" : sec.sub ? `Assembling ${sec.name}${copies}` : sections.length > 1 ? "Assembling the main build" : `Building ${sec.name}`;
  const current = sec.steps[step - 1];
  const addedCopies = current?.copies.map((c) => `${c.count}× ${c.name}`).join(", ");

  function restart() {
    setSection(0);
    setStep(0);
    setPlaying(true);
  }

  return (
    <div className="showcase" role="dialog" aria-modal="true" aria-label={`Showcase: ${props.modelName}`}>
      <div className="showcase-stage">
        <Viewer model={sec.model} visible={done ? undefined : visible} highlight={highlight} fitKey={`showcase-${section}`} spin theme={props.theme} />
        <div className="showcase-label">
          <span className="showcase-kicker">{sec.kind === "baseplate" ? "Baseplate" : sec.sub ? `Sub-build ${sections.filter((s) => s.sub).indexOf(sec) + 1} of ${sections.filter((s) => s.sub).length}` : "Main build"}</span>
          <b>{title}</b>
          {addedCopies && !done && <span className="showcase-sub">Adding {addedCopies}</span>}
        </div>
      </div>
      <div className="showcase-bar">
        <button className="play-btn" onClick={() => (done ? restart() : setPlaying((p) => !p))} aria-label={done ? "Play again" : playing ? "Pause" : "Play"}>
          {playing && !done ? <I.Pause /> : <I.Play />}
        </button>
        <div className="showcase-progress">
          <div className="showcase-count">
            <b>
              Step {globalStep} / {total}
            </b>
            <span>{sec.kind === "baseplate" ? "Baseplate" : sec.sub ? `${sec.name} · step ${Math.min(step, sec.steps.length)} of ${sec.steps.length}` : `Main build · step ${Math.min(step, sec.steps.length)} of ${sec.steps.length}`}</span>
          </div>
          <div className="progress">
            <div style={{ width: `${(globalStep / Math.max(1, total)) * 100}%` }} />
          </div>
        </div>
        <div className="speeds" role="radiogroup" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button key={s} role="radio" aria-checked={speed === s} className={speed === s ? "on" : ""} onClick={() => setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
        <button className="btn-outline showcase-stop" onClick={props.onClose}>
          <I.Close size={14} />
          Stop
        </button>
      </div>
    </div>
  );
}
