"use client";

import type { LibraryEntry } from "@/lib/library/scan";
import * as I from "./icons";

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function Card({ e, selected, onPick }: { e: LibraryEntry; selected: boolean; onPick: () => void }) {
  return (
    <button className={`lib-card ${selected ? "selected" : ""}`} onClick={onPick} aria-pressed={selected}>
      <span className="thumb">
        <I.Cube size={22} strokeWidth={1.6} />
      </span>
      <span className="lib-text">
        <span className="lib-title">{e.name}</span>
        {e.description ? <span className="lib-desc">{e.description}</span> : e.source && <span className="lib-desc">{e.source}</span>}
        <span className="lib-meta">
          {e.parts} pieces
          {e.valid !== null && (
            <>
              {" · "}
              <span className={e.valid ? "ok" : "bad"}>{e.valid ? "buildable" : "has problems"}</span>
            </>
          )}
          {e.rounds !== null && e.rounds > 1 && ` · ${e.rounds - 1} repair${e.rounds > 2 ? "s" : ""}`}
          {e.cost !== null && ` · $${e.cost.toFixed(2)}`}
          {" · "}
          {when(e.date)}
        </span>
      </span>
    </button>
  );
}

export function LibraryPanel(props: {
  entries: LibraryEntry[] | null;
  error: string | null;
  selected: string | null;
  onPick: (e: LibraryEntry) => void;
  onRefresh: () => void;
}) {
  const generated = props.entries?.filter((e) => e.kind === "debug") ?? [];
  const exported = props.entries?.filter((e) => e.kind === "export") ?? [];
  const key = (e: LibraryEntry) => `${e.kind}:${e.id}`;

  return (
    <div className="side-scroll">
      <span className="section-label" style={{ justifyContent: "space-between" }}>
        Generated
        <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={props.onRefresh} aria-label="Refresh library" title="Refresh">
          <I.Refresh size={13} />
        </button>
      </span>
      {props.error && <p className="empty-note">{props.error}</p>}
      {props.entries === null && !props.error && <p className="empty-note">Loading…</p>}
      {props.entries && generated.length === 0 && <p className="empty-note">No generated models yet. Runs are saved to debug/.</p>}
      {generated.map((e) => (
        <Card key={key(e)} e={e} selected={props.selected === key(e)} onPick={() => props.onPick(e)} />
      ))}

      <span className="section-label">Exports</span>
      {props.entries && exported.length === 0 && <p className="empty-note">No other .ldr files in exports/.</p>}
      {exported.map((e) => (
        <Card key={key(e)} e={e} selected={props.selected === key(e)} onPick={() => props.onPick(e)} />
      ))}

      <span className="section-label">
        Shared builds <span className="soon">Soon</span>
      </span>
      <button className="lib-card" disabled title="Coming soon: builds shared with you">
        <span className="thumb small">
          <I.Cube size={18} strokeWidth={1.6} />
        </span>
        <span className="lib-text">
          <span className="lib-title">Shared builds</span>
          <span className="lib-meta">Builds other people share with you will appear here.</span>
        </span>
      </button>
    </div>
  );
}
