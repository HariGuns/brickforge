#!/usr/bin/env bash
# Render an exported .ldr/.mpd with LeoCAD (flatpak) to confirm it opens correctly.
# Usage: scripts/leocad-render.sh exports/Tiny_house.ldr [out.png] [step]
set -euo pipefail
in=$(realpath "$1"); out=$(realpath -m "${2:-${1%.*}.png}"); step=${3:-}
root=$(cd "$(dirname "$0")/.." && pwd)
args=(-l "$root/ldraw-lib/ldraw" -i "$out" -w 900 -h 700 --camera-angles 30 45)
[[ -n "$step" ]] && args+=(-f "$step" -t "$step" --fade-steps)
flatpak run --filesystem="$root" --filesystem="$(dirname "$in")" --filesystem="$(dirname "$out")" \
  --env=QT_QPA_PLATFORM=offscreen org.leocad.LeoCAD "${args[@]}" "$in" 2>&1 | grep -v QFont || true
