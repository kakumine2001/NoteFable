import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/translate";
import { ja } from "./ja";
import { jaServer } from "./ja-server";
import { zh } from "./zh";
import { zhHant } from "./zh-hant";
import { zhServer } from "./zh-server";

// 画面の文とサーバーのエラー文を合わせて渡す（サーバーの文は表示するときに t() で訳す）。繁体字は簡体字から作った辞書（zh-hant.ts）。
const DICTIONARIES: Record<Locale, Messages> = { en: {}, zh: { ...zh, ...zhServer }, "zh-Hant": zhHant, ja: { ...ja, ...jaServer } };

export function messagesFor(locale: Locale): Messages {
  return DICTIONARIES[locale];
}
