import type { Locale } from "@/lib/i18n/locale";
import type { Translate } from "@/lib/i18n/translate";

// 紹介ページのタイトル。静的なページのメタデータ（[locale]/page.tsx）と、メニューで言語を切り替えたときの document.title で同じものを使う。
// 英語は文の間を空け、中国語・日本語は詰める。
export function landingTitle(t: Translate, locale: Locale) {
  return `NoteFable — ${[t("Ask it."), t("Keep it."), t("Find it again.")].join(locale === "en" ? " " : "")}`;
}
