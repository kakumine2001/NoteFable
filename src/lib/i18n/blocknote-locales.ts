import type { Dictionary } from "@blocknote/core";
import {
  ar,
  de,
  en,
  es,
  fr,
  it,
  ja,
  ko,
  pt,
  ru,
  vi,
  zh,
  zhTW,
} from "@blocknote/core/locales";
import type { Locale } from "@/lib/i18n/locale";
import { blockNoteHi, blockNoteId, blockNoteTh, blockNoteTr } from "./blocknote-custom-locales";

const BLOCKNOTE_LOCALES: Record<Locale, Dictionary> = {
  en,
  zh,
  "zh-Hant": zhTW,
  ja,
  ko,
  es,
  fr,
  de,
  "pt-BR": pt,
  it,
  id: blockNoteId,
  vi,
  th: blockNoteTh,
  hi: blockNoteHi,
  ar,
  tr: blockNoteTr,
  ru,
};

export function blockNoteDictionaryFor(locale: Locale): Dictionary {
  return BLOCKNOTE_LOCALES[locale];
}
