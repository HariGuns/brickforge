"use client";

import { useEffect, useRef, useState } from "react";
import type { BrickModel } from "@/lib/model/schema";
import type { ModelStats } from "@/lib/model/stats";
import * as I from "./icons";

const SOON = "Coming soon";

export function TopBar(props: {
  model: BrickModel | null;
  stats: ModelStats | null;
  steps: number;
  problems: number;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onDownload: (kind: "ldr" | "mpd") => void;
  onOpenJson: (file: File) => void;
}) {
  const { model, stats } = props;
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const fmt = (n: number) => n.toLocaleString("en-US");
  const badges = stats
    ? [
        { n: fmt(stats.pieces), l: "pieces" },
        { n: fmt(props.steps), l: "steps" },
        { n: `${stats.width}×${stats.depth}`, l: "studs" },
        { n: fmt(stats.partTypes), l: "part types" },
      ]
    : [];

  return (
    <header className="topbar">
      <div className="brand">
        <I.Logo />
        <span className="brand-title" title={model?.name}>{model?.name ?? "BrickForge"}</span>
      </div>
      {badges.length > 0 && (
        <div className="badges" aria-label="Model summary">
          {badges.map((b) => (
            <span key={b.l} className="badge">
              <b>{b.n}</b>
              <span>{b.l}</span>
            </span>
          ))}
          <span className={`badge ${props.problems ? "bad" : "ok"}`}>
            <b>{props.problems ? fmt(props.problems) : "✓"}</b>
            <span>{props.problems ? (props.problems === 1 ? "problem" : "problems") : "buildable"}</span>
          </span>
        </div>
      )}
      <div className="top-actions">
        <button className="icon-btn" aria-label="Undo" title={`Undo · ${SOON}`} disabled>
          <I.Undo />
        </button>
        <button className="icon-btn" aria-label="Redo" title={`Redo · ${SOON}`} disabled>
          <I.Redo />
        </button>
        <button className="text-btn" title={`Versions · ${SOON}`} disabled>
          <I.History />
          <span className="lbl">Versions</span>
        </button>
        <button className="text-btn" title={`Save · ${SOON}`} disabled>
          <I.Upload />
          <span className="lbl">Save</span>
        </button>
        <button className="icon-btn" onClick={props.onToggleTheme} aria-label={props.theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} title="Toggle dark mode">
          {props.theme === "dark" ? <I.Sun /> : <I.Moon />}
        </button>
        <div className="menu-anchor" ref={menuRef}>
          <button className="btn-accent" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
            <I.Download />
            Download
          </button>
          {open && (
            <div className="menu" role="menu">
              <button role="menuitem" className="menu-item" disabled={!model} onClick={() => (props.onDownload("ldr"), setOpen(false))}>
                <b>Download .ldr</b>
                <span>{model ? `Single model file · ${props.steps} build steps` : "No model loaded"}</span>
              </button>
              <button role="menuitem" className="menu-item" disabled={!model} onClick={() => (props.onDownload("mpd"), setOpen(false))}>
                <b>Download .mpd</b>
                <span>{model ? "Multi-part document wrapper" : "No model loaded"}</span>
              </button>
              <div className="menu-sep" />
              <button role="menuitem" className="menu-link" onClick={() => fileRef.current?.click()}>
                Open model JSON…
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) {
                    props.onOpenJson(f);
                    setOpen(false);
                  }
                }}
              />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
