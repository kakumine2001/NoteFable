import type { MetadataRoute } from "next";

// API は検索エンジンに読ませない。サイトマップの場所を知らせる（URL の決め方は sitemap.ts と同じ）。
const origin = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: "/api/" }, sitemap: `${origin}/sitemap.xml` };
}
