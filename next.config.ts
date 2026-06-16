import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project. Without this, a stray
  // package-lock.json in a parent directory can make Next infer the
  // wrong root (see build warning). Vercel is unaffected, but this
  // keeps local builds correct and quiet.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
