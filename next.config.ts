import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // simple-git spawns the real `git` binary and resolves paths at runtime.
  // Leaving it unbundled avoids the bundler rewriting those lookups.
  serverExternalPackages: ["simple-git"],
};

export default nextConfig;
