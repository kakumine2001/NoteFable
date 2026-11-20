import type { NextConfig } from "next";
import { siteApiBlockRewrites } from "./src/lib/hosts";

const nextConfig: NextConfig = {
  outputFileTracingExcludes: {
    "/api/*": ["./next.config.ts"],
  },
  // 紹介サイトのホスト（notefable.com）の /api/* は 404 にする（src/lib/hosts.ts）。API はワークスペースのホストだけで配る。
  async rewrites() {
    return { beforeFiles: siteApiBlockRewrites(), afterFiles: [], fallback: [] };
  },
};

export default nextConfig;
