import type { NextConfig } from "next";
import { siteApiBlockRewrites } from "./src/lib/hosts";

const nextConfig: NextConfig = {
  outputFileTracingExcludes: {
    "/api/*": ["./next.config.ts"],
  },
  // 紹介サイトのホスト（notefable.com）の /api/* は 421 を返す（src/lib/hosts.ts）。API はワークスペースのホストだけで配る。
  async rewrites() {
    return { beforeFiles: siteApiBlockRewrites(), afterFiles: [], fallback: [] };
  },
};

export default nextConfig;
