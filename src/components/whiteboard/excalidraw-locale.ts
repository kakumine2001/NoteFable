"use client";

import { languages } from "@excalidraw/excalidraw";
import { useEffect } from "react";
import { LOCALE_TAGS, type Locale, type TextDirection } from "@/lib/i18n/locale";

// NoteFable の言語 → Excalidraw の言語コード。Excalidraw は訳が 85% 以上の言語だけを持つので、無いものは英語にする。
// Excalidraw の文言はほとんど出ない（画面は自前）。残るのは枠の既定の名前・読み上げ用の文など。
const EXCALIDRAW_LANGS: Record<Locale, string> = {
  en: "en", zh: "zh-CN", "zh-Hant": "zh-TW", ja: "ja-JP", ko: "ko-KR", es: "es-ES", fr: "fr-FR", de: "de-DE", "pt-BR": "pt-BR",
  it: "it-IT", id: "id-ID", vi: "vi-VN", th: "th-TH", hi: "hi-IN", ar: "ar-SA", tr: "tr-TR", ru: "ru-RU",
};

export function excalidrawLang(locale: Locale) {
  const code = EXCALIDRAW_LANGS[locale];
  return languages.some((language) => language.code === code) ? code : "en";
}

// Excalidraw は言語を設定するたびに <html lang/dir> を自分の言語に書き換える。NoteFable の設定（I18nProvider・公開ページの言語）に戻し続ける。
export function useKeepDocumentLanguage(locale: Locale, dir: TextDirection) {
  useEffect(() => {
    const root = document.documentElement;
    const lang = LOCALE_TAGS[locale];
    const restore = () => {
      if (root.lang !== lang) root.lang = lang;
      if (root.dir !== dir) root.dir = dir;
    };
    restore();
    const observer = new MutationObserver(restore);
    observer.observe(root, { attributes: true, attributeFilter: ["lang", "dir"] });
    return () => observer.disconnect();
  }, [locale, dir]);
}
