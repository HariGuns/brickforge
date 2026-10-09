#!/usr/bin/env bash
# Build the Linux AppImage in dist/ (personal build: offers to import this folder's runs on first launch).
# Same as npm run appimage; the cross-platform build is scripts/package-desktop.mjs.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/package-desktop.mjs --linux --import-from-here "$@"
