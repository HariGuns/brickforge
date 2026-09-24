"use client";

import { useEffect, useRef, useState } from "react";
import * as I from "./icons";

export interface SettingsStatus {
  managed: boolean;
  hasKey: boolean;
  keySource: "settings" | "env" | null;
  keyHint: string | null;
  setupDone: boolean;
  importFrom: { path: string; builds: number; runs: number; exports: number } | null;
  dataDir: string | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

/**
 * Settings: the Anthropic API key (desktop app: stored in ~/.config/BrickForge;
 * development: read-only status of .env.local) and, on first run, importing
 * builds from an existing BrickForge folder.
 */
export function SettingsDialog(props: { status: SettingsStatus; onChange: (s: SettingsStatus) => void; onImported: () => void; onClose: () => void }) {
  const { status } = props;
  const firstRun = status.managed && !status.setupDone;
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"key" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importPath, setImportPath] = useState(status.importFrom?.path ?? "");
  const [imported, setImported] = useState<string | null>(null);
  const keyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status.managed && !status.hasKey) keyRef.current?.focus();
  }, [status.managed, status.hasKey]);

  async function close() {
    if (firstRun) {
      try {
        props.onChange(await post("/api/settings", { setupDone: true }));
      } catch {}
    }
    props.onClose();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && status.hasKey && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function saveKey(value: string | null) {
    setBusy("key");
    setError(null);
    try {
      props.onChange(await post("/api/settings", { apiKey: value }));
      setKey("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runImport() {
    setBusy("import");
    setError(null);
    try {
      const { copied } = await post("/api/settings/import", { from: importPath.trim() });
      const parts = [copied.builds && plural(copied.builds, "saved build"), copied.runs && plural(copied.runs, "generation run"), copied.exports && plural(copied.exports, "export")].filter(Boolean);
      setImported(parts.length ? `Imported ${parts.join(", ")}.` : "Nothing new to import. Everything is already here.");
      props.onImported();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && status.hasKey && close()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="dialog-head">
          <h2 id="settings-title">{firstRun ? "Welcome to BrickForge" : "Settings"}</h2>
          {status.hasKey && (
            <button className="icon-btn" aria-label="Close settings" onClick={close}>
              <I.Close />
            </button>
          )}
        </div>

        <section className="dialog-section">
          <span className="section-label">Anthropic API key</span>
          {status.managed ? (
            <>
              <p className="dialog-note">
                BrickForge uses Claude to design models. Paste an API key from{" "}
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                  console.anthropic.com
                </a>
                . It&apos;s stored only on this computer, in {status.dataDir ?? "your settings folder"}, and sent only to Anthropic.
              </p>
              {status.keySource === "settings" && (
                <div className="key-row">
                  <I.Check size={14} strokeWidth={2.6} />
                  <span className="mono">{status.keyHint}</span>
                  <button className="link-btn" onClick={() => saveKey(null)} disabled={busy !== null}>
                    Remove
                  </button>
                </div>
              )}
              <form
                className="key-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (key.trim()) saveKey(key);
                }}
              >
                <input
                  ref={keyRef}
                  type="password"
                  className="text-input mono"
                  placeholder={status.keySource === "settings" ? "Paste a new key to replace it" : "sk-ant-…"}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Anthropic API key"
                />
                <button className="btn-accent" type="submit" disabled={!key.trim() || busy !== null}>
                  {busy === "key" ? "Checking…" : "Save key"}
                </button>
              </form>
              {status.keySource === "env" && <p className="dialog-note">Using ANTHROPIC_API_KEY from the environment until you save one here.</p>}
            </>
          ) : (
            <p className="dialog-note">
              {status.hasKey ? (
                <>
                  Using ANTHROPIC_API_KEY from <span className="mono">.env.local</span> ({status.keyHint}).
                </>
              ) : (
                <>
                  No key set. Add ANTHROPIC_API_KEY to <span className="mono">.env.local</span> and restart the server.
                </>
              )}{" "}
              The desktop app stores its key in Settings instead.
            </p>
          )}
        </section>

        {firstRun && status.importFrom && (
          <section className="dialog-section">
            <span className="section-label">Your existing builds</span>
            <p className="dialog-note">
              Found {[plural(status.importFrom.runs, "generation run"), plural(status.importFrom.builds, "saved build"), plural(status.importFrom.exports, "export")].join(", ")} in another BrickForge folder. Copy them into the app?
            </p>
            <div className="key-form">
              <input className="text-input mono" value={importPath} onChange={(e) => setImportPath(e.target.value)} aria-label="Folder to import from" spellCheck={false} />
              <button className="btn-outline" onClick={runImport} disabled={!importPath.trim() || busy !== null || !!imported}>
                {busy === "import" ? "Importing…" : imported ? "Imported" : "Import"}
              </button>
            </div>
            {imported && <p className="dialog-note ok">{imported}</p>}
          </section>
        )}

        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}

        <div className="dialog-foot">
          {status.dataDir && <span className="dialog-note mono">{status.dataDir}</span>}
          <button className="btn-accent" onClick={close} disabled={!status.hasKey}>
            {firstRun ? "Start building" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}
