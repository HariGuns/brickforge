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
        // Data folders are read at runtime from paths the tracer can't resolve, so it
        // would copy the whole project (and your runs) into the bundle. Keep them out;
        // the app reads and writes its own data folder instead. Patterns start with ./
        // so they only match at the project root. dist/ is deleted before building instead of
        // excluded: any "dist/**" pattern also drops node_modules/next/dist.
        outputFileTracingExcludes: {
          "/*": [
            "./ldraw-lib/**",
            "./debug/**",
            "./exports/**",
            "./builds/**",
            "./logs/**",
            "./design/**",
            "./electron/**",
            "./scripts/**",
            "./src/**",
            "./.next/**",
            "./*.md",
            "./*.tsbuildinfo",
            "./package-lock.json",
          ],
        },
      }
    : {}),
};

export default nextConfig;
