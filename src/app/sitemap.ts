import type { MetadataRoute } from "next";
import { LOCALE_TAGS, LOCALES } from "@/lib/i18n/locale";
import { landingPath } from "@/lib/i18n/routing";

// 検索エンジン向けの一覧: 紹介ページの言語ごとの版（hreflang 付き）と、プライバシー・利用規約。
// ワークスペース（/app）は人ごとの中身なので載せない。本番の URL は Vercel が渡す（手元のビルドでは localhost）。
const origin = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  const languages = Object.fromEntries(LOCALES.map((locale) => [LOCALE_TAGS[locale], `${origin}${landingPath(locale)}`]));
  return [
    ...LOCALES.map((locale) => ({ url: `${origin}${landingPath(locale)}`, alternates: { languages } })),
    { url: `${origin}/privacy` },
    { url: `${origin}/terms` },
  ];
}
