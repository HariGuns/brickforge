#!/usr/bin/env bash
# Adds "BrickForge" to your app menu (and, with --desktop, a desktop icon).
# Right-click the entry for "Stop BrickForge". Remove with --uninstall.
set -euo pipefail
ROOT=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
FILE="$APPS/brickforge.desktop"
DESKTOP_DIR=$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$FILE" "$DESKTOP_DIR/brickforge.desktop"
  command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" 2>/dev/null || true
  echo "Removed the BrickForge launcher."
  exit 0
fi

chmod +x "$ROOT/scripts/launch.sh" "$ROOT/scripts/stop.sh"
mkdir -p "$APPS"
cat >"$FILE" <<DESKTOP
[Desktop Entry]
Type=Application
Version=1.0
Name=BrickForge (dev)
Comment=Turn a description or photo into a buildable brick model
Exec="$ROOT/scripts/launch.sh"
Icon=$ROOT/src/app/icon.svg
Terminal=false
Categories=Graphics;3DGraphics;
StartupNotify=false
Actions=stop;

[Desktop Action stop]
Name=Stop BrickForge
Exec="$ROOT/scripts/stop.sh"
DESKTOP
chmod +x "$FILE"
command -v desktop-file-validate >/dev/null && desktop-file-validate "$FILE"
command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" 2>/dev/null || true
echo "Installed: $FILE"

if [[ "${1:-}" == "--desktop" && -d "$DESKTOP_DIR" ]]; then
  cp "$FILE" "$DESKTOP_DIR/brickforge.desktop"
  chmod +x "$DESKTOP_DIR/brickforge.desktop"
  command -v gio >/dev/null && gio set "$DESKTOP_DIR/brickforge.desktop" metadata::trusted true 2>/dev/null || true
  echo "Desktop icon: $DESKTOP_DIR/brickforge.desktop"
fi
