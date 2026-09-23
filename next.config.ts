import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Anthropic SDK is only used server-side; keep it out of client bundles.
  serverExternalPackages: ["@anthropic-ai/sdk"],
};

export default nextConfig;
