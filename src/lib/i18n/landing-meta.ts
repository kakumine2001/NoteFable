import type { Locale } from "@/lib/i18n/locale";
import type { Translate } from "@/lib/i18n/translate";

const NO_SENTENCE_SPACE: ReadonlySet<Locale> = new Set(["zh", "zh-Hant", "ja"]);

// 紹介ページのタイトル。静的なページのメタデータ（[locale]/page.tsx）と、メニューで言語を切り替えたときの document.title で同じものを使う。
// 中国語・日本語は句点に余白が含まれるため詰め、その他の言語は文の間を空ける。
export function landingTitle(t: Translate, locale: Locale) {
  return `NoteFable — ${[t("Ask it."), t("Keep it."), t("Find it again.")].join(NO_SENTENCE_SPACE.has(locale) ? "" : " ")}`;
}
