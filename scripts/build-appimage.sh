#!/usr/bin/env bash
# Build the BrickForge desktop app as an AppImage in dist/.
# The API key is never bundled: .env files are kept out of the server folder
# and the build fails if the key from .env.local shows up anywhere in it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "▸ Building the standalone server (.next-app/)"
# dist/ goes first: the tracer would copy an old build into the new one.
rm -rf .next-app dist
BRICKFORGE_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1 npx next build
STANDALONE=.next-app/standalone
cp -r .next-app/static "$STANDALONE/.next-app/static"
[ -d public ] && cp -r public "$STANDALONE/public"
find "$STANDALONE" -maxdepth 1 -name '.env*' -delete

# Refuse to package anything that contains the development key.
KEY="$(sed -n 's/^ANTHROPIC_API_KEY=//p' .env.local 2>/dev/null | tr -d '"'"'"' ' | head -1 || true)"
if [ -n "$KEY" ] && grep -rqF -- "$KEY" "$STANDALONE" electron; then
  echo "✗ The API key from .env.local was found in the build output. Not packaging." >&2
  exit 1
fi

# Offer to import builds from this source folder on first run.
printf '{ "importFrom": %s }\n' "$(node -e 'console.log(JSON.stringify(process.argv[1]))' "$ROOT")" > electron/build-info.json

echo "▸ Packaging the AppImage (dist/)"
npx electron-builder --linux AppImage --publish never
ls -lh dist/*.AppImage
