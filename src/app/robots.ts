import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/i18n/routing";

// API は検索エンジンに読ませない。サイトマップの場所を知らせる。

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: "/api/" }, sitemap: `${siteOrigin()}/sitemap.xml` };
}
