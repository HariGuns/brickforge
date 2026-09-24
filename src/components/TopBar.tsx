"use client";

import { useEffect, useRef, useState } from "react";
import type { BrickModel } from "@/lib/model/schema";
import type { ModelStats } from "@/lib/model/stats";
import type { Version } from "@/lib/builds/doc";
import * as I from "./icons";

export type SaveState = "none" | "dirty" | "saving" | "saved";

const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

function ago(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Closes a popover on outside click or Escape. */
function useDismiss(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref, close]);
}

export function TopBar(props: {
  model: BrickModel | null;
  stats: ModelStats | null;
  steps: number;
  /** Unique sub-builds, when the model has a sub-build design. */
  subBuilds?: number;
  problems: number;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onSettings: () => void;
  onDownload: (kind: "ldr" | "mpd" | "bricklink") => void;
  onOpenJson: (file: File) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  versions: Version[];
  currentVersionId: string | null;
  onRestore: (id: string) => void;
  saveState: SaveState;
  onSave: () => void;
}) {
  const { model, stats } = props;
  const [open, setOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const versionsRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useDismiss(open, menuRef, () => setOpen(false));
  useDismiss(versionsOpen, versionsRef, () => setVersionsOpen(false));

  const fmt = (n: number) => n.toLocaleString("en-US");
  const badges = stats
    ? [
        { n: fmt(stats.pieces), l: "pieces" },
        { n: fmt(props.steps), l: "steps" },
        ...(props.subBuilds !== undefined ? [{ n: fmt(props.subBuilds), l: props.subBuilds === 1 ? "sub-build" : "sub-builds" }] : []),
        { n: `${stats.width}×${stats.depth}`, l: "studs" },
        ...(props.subBuilds === undefined ? [{ n: fmt(stats.partTypes), l: "part types" }] : []),
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
        <button className="icon-btn" aria-label="Undo" title={`Undo (${mod}Z)`} onClick={props.onUndo} disabled={!props.canUndo}>
          <I.Undo />
        </button>
        <button className="icon-btn" aria-label="Redo" title={`Redo (${mod}Shift+Z)`} onClick={props.onRedo} disabled={!props.canRedo}>
          <I.Redo />
        </button>
        <div className="menu-anchor" ref={versionsRef} style={{ marginLeft: 0 }}>
          <button className="text-btn" onClick={() => setVersionsOpen((o) => !o)} disabled={!props.versions.length} aria-haspopup="menu" aria-expanded={versionsOpen}>
            <I.History />
            <span className="lbl">Versions</span>
            {props.versions.length > 0 && <span className="count-pill">{props.versions.length}</span>}
          </button>
          {versionsOpen && (
            <div className="menu versions-menu" role="menu">
              <span className="section-label" style={{ padding: "6px 10px 4px" }}>Versions of this build</span>
              {[...props.versions].reverse().map((v, i) => {
                const cur = v.id === props.currentVersionId;
                return (
                  <button
                    key={v.id}
                    role="menuitemradio"
                    aria-checked={cur}
                    className={`menu-item version ${cur ? "current" : ""}`}
                    onClick={() => (props.onRestore(v.id), setVersionsOpen(false))}
                  >
                    <b>
                      v{props.versions.length - i} · {v.label}
                    </b>
                    <span>
                      {v.model.parts.length} pieces · {ago(v.createdAt)}
                      {v.source.cost !== undefined && ` · $${v.source.cost.toFixed(2)}`}
                      {cur && " · current"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <button
          className={`text-btn save-btn ${props.saveState}`}
          onClick={props.onSave}
          disabled={props.saveState === "none" || props.saveState === "saving" || props.saveState === "saved"}
          title={props.saveState === "saved" ? "All changes saved" : `Save this build with all its versions (${mod}S)`}
        >
          {props.saveState === "saved" ? <I.Check size={14} strokeWidth={2.6} /> : <I.Upload />}
          <span className="lbl">{props.saveState === "saving" ? "Saving…" : props.saveState === "saved" ? "Saved" : "Save"}</span>
        </button>
        <button className="icon-btn" onClick={props.onSettings} aria-label="Settings" title="Settings (API key)">
          <I.Gear />
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
              <button role="menuitem" className="menu-item" disabled={!model} onClick={() => (props.onDownload("bricklink"), setOpen(false))}>
                <b>BrickLink wanted list (.xml)</b>
                <span>{model ? "Upload at BrickLink › Wanted › Upload to buy the parts" : "No model loaded"}</span>
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
