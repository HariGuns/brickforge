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
# Merge public/ in: the tracer already copies public/parts (the server renderer reads it),
# and `cp -r public "$STANDALONE/public"` would nest a second copy at public/public.
[ -d public ] && mkdir -p "$STANDALONE/public" && cp -r public/. "$STANDALONE/public/"
# sharp (~46 MB of native image libraries for three platforms) is only for next/image
# optimisation, which the app doesn't use (images.unoptimized in next.config.ts).
rm -rf "$STANDALONE/node_modules/sharp" "$STANDALONE/node_modules/@img"
find "$STANDALONE" -maxdepth 1 -name '.env*' -delete

# Refuse to package anything that contains a key from .env.local (Anthropic, Rebrickable, …).
while IFS= read -r KEY; do
  if [ -n "$KEY" ] && grep -rqF -- "$KEY" "$STANDALONE" electron; then
    echo "✗ A key from .env.local was found in the build output. Not packaging." >&2
    exit 1
  fi
done < <(sed -n 's/^[A-Z_]*_KEY=//p' .env.local 2>/dev/null | tr -d '"'"'"' ' || true)

# Offer to import builds from this source folder on first run.
printf '{ "importFrom": %s }\n' "$(node -e 'console.log(JSON.stringify(process.argv[1]))' "$ROOT")" > electron/build-info.json

echo "▸ Packaging the AppImage (dist/)"
npx electron-builder --linux AppImage --publish never
ls -lh dist/*.AppImage
