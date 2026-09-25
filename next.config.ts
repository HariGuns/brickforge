import type { NextConfig } from "next";

// The desktop app (npm run appimage) bundles a standalone server, built into
// its own folder so it doesn't disturb `next start` / the launcher.
const desktop = process.env.BRICKFORGE_STANDALONE === "1";

const nextConfig: NextConfig = {
  // The Anthropic SDK is only used server-side; keep it out of client bundles.
  serverExternalPackages: ["@anthropic-ai/sdk"],
  ...(desktop
    ? {
        output: "standalone" as const,
        distDir: ".next-app",
        // Runtime data paths (debug/, exports/, builds/, settings) are marked
        // turbopackIgnore where they're read, so the tracer doesn't copy the project
        // into the bundle. The app never optimises images, so build-appimage.sh drops
        // sharp from the bundle.
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
