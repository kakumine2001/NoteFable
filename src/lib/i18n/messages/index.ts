import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/translate";
import { ar } from "./ar";
import { arServer } from "./ar-server";
import { de } from "./de";
import { deServer } from "./de-server";
import { es } from "./es";
import { esServer } from "./es-server";
import { fr } from "./fr";
import { frServer } from "./fr-server";
import { hi } from "./hi";
import { hiServer } from "./hi-server";
import { id } from "./id";
import { idServer } from "./id-server";
import { it } from "./it";
import { itServer } from "./it-server";
import { ja } from "./ja";
import { jaServer } from "./ja-server";
import { ko } from "./ko";
import { koServer } from "./ko-server";
import { ptBR } from "./pt-br";
import { ptBRServer } from "./pt-br-server";
import { ru } from "./ru";
import { ruServer } from "./ru-server";
import { th } from "./th";
import { thServer } from "./th-server";
import { tr } from "./tr";
import { trServer } from "./tr-server";
import { vi } from "./vi";
import { viServer } from "./vi-server";
import { zh } from "./zh";
import { zhHant } from "./zh-hant";
import { zhServer } from "./zh-server";

// 画面の文とサーバーのエラー文を合わせて渡す（サーバーの文は表示するときに t() で訳す）。繁体字は簡体字から作った辞書（zh-hant.ts）。
const DICTIONARIES: Record<Locale, Messages> = {
  en: {},
  zh: { ...zh, ...zhServer },
  "zh-Hant": zhHant,
  ja: { ...ja, ...jaServer },
  ko: { ...ko, ...koServer },
  es: { ...es, ...esServer },
  fr: { ...fr, ...frServer },
  de: { ...de, ...deServer },
  "pt-BR": { ...ptBR, ...ptBRServer },
  it: { ...it, ...itServer },
  id: { ...id, ...idServer },
  vi: { ...vi, ...viServer },
  th: { ...th, ...thServer },
  hi: { ...hi, ...hiServer },
  ar: { ...ar, ...arServer },
  tr: { ...tr, ...trServer },
  ru: { ...ru, ...ruServer },
};

export function messagesFor(locale: Locale): Messages {
  return DICTIONARIES[locale];
}
