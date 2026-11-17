import type { MetadataRoute } from "next";
import { LOCALE_TAGS, LOCALES } from "@/lib/i18n/locale";
import { landingPath, siteOrigin } from "@/lib/i18n/routing";

// 検索エンジン向けの一覧: 紹介ページの言語ごとの版（hreflang 付き）と、プライバシー・利用規約・特商法表記。
// ワークスペース（/app）は人ごとの中身なので載せない。

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  const languages = Object.fromEntries(LOCALES.map((locale) => [LOCALE_TAGS[locale], `${origin}${landingPath(locale)}`]));
  return [
    ...LOCALES.map((locale) => ({ url: `${origin}${landingPath(locale)}`, alternates: { languages } })),
    { url: `${origin}/privacy` },
    { url: `${origin}/terms` },
    { url: `${origin}/legal-notice` },
  ];
}
