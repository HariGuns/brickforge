#!/usr/bin/env bash
# One-click launcher: builds BrickForge if the code changed, starts it (or reuses a
# running copy), waits until it answers, then opens it in your browser.
#   scripts/launch.sh                  (BRICKFORGE_PORT=3000 by default)
#   BRICKFORGE_NO_BROWSER=1 scripts/launch.sh   (start without opening a browser)
set -uo pipefail
ROOT=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
PORT=${BRICKFORGE_PORT:-3000}
URL="http://localhost:$PORT"
LOGDIR="$ROOT/logs"
PIDFILE="$LOGDIR/server.pid"
mkdir -p "$LOGDIR"

fail() {
  echo "BrickForge: $1" >&2
  command -v notify-send >/dev/null && notify-send -i "$ROOT/src/app/icon.svg" "BrickForge couldn't start" "$1"
  exit 1
}
open_browser() {
  [[ -n "${BRICKFORGE_NO_BROWSER:-}" ]] && { echo "BrickForge is running at $URL"; return; }
  xdg-open "$URL" >/dev/null 2>&1 &
}
answers() { curl -fs -o /dev/null --max-time 2 "$URL/api/library"; }

cd "$ROOT" || fail "project folder not found"
command -v node >/dev/null || fail "Node.js isn't installed (https://nodejs.org)."

# Already running (ours or anything answering like BrickForge on this port): just open it.
if answers; then open_browser; exit 0; fi

[[ -f .env.local ]] || echo "BrickForge: no .env.local, so generating models won't work until you add ANTHROPIC_API_KEY (viewing saved models still works)." >&2
[[ -d node_modules ]] || { echo "Installing dependencies…"; npm install >"$LOGDIR/install.log" 2>&1 || fail "npm install failed (see logs/install.log)."; }

# Rebuild only when something that affects the app is newer than the last build: the code,
# the dependencies, the part meshes, or .env.local (NEXT_PUBLIC_* settings are baked in at build time).
if [[ ! -f .next/BUILD_ID ]] || [[ -n $(find src public package.json package-lock.json next.config.ts .env.local -newer .next/BUILD_ID -print -quit 2>/dev/null) ]]; then
  echo "Building BrickForge (only after code changes)…"
  command -v notify-send >/dev/null && notify-send -i "$ROOT/src/app/icon.svg" "BrickForge" "Building the app, this takes a minute the first time…"
  npm run build >"$LOGDIR/build.log" 2>&1 || fail "the build failed (see logs/build.log)."
fi

echo "Starting BrickForge on $URL…"
nohup npx next start -p "$PORT" >"$LOGDIR/server.log" 2>&1 &
echo $! >"$PIDFILE"
for _ in $(seq 1 60); do
  if answers; then open_browser; exit 0; fi
  kill -0 "$(cat "$PIDFILE")" 2>/dev/null || fail "the server stopped while starting (see logs/server.log)."
  sleep 1
done
fail "the server didn't answer within 60 s (see logs/server.log)."
