#!/usr/bin/env bash
# Stop a BrickForge server started by launch.sh.
ROOT=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
PIDFILE="$ROOT/logs/server.pid"
if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  # npx starts next as a child; stop the whole process group we launched.
  pkill -TERM -P "$(cat "$PIDFILE")" 2>/dev/null
  kill "$(cat "$PIDFILE")" 2>/dev/null
  rm -f "$PIDFILE"
  echo "BrickForge stopped."
else
  rm -f "$PIDFILE"
  echo "BrickForge isn't running (from this launcher)."
fi
