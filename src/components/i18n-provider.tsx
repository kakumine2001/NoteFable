"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, LOCALE_TAGS, type Locale, type LocalePreference } from "@/lib/i18n/locale";
import { createTranslator, type Messages, type Translate } from "@/lib/i18n/translate";

type I18nValue = {
  locale: Locale;
  // BCP 47 タグ。日付の書式（toLocaleDateString）に渡す。
  tag: string;
  preference: LocalePreference;
  t: Translate;
  setPreference: (next: LocalePreference) => void;
  switching: boolean;
};

const fallback: I18nValue = {
  locale: "en", tag: "en", preference: "auto", t: createTranslator({}), setPreference: () => {}, switching: false,
};

const I18nContext = createContext<I18nValue>(fallback);

// サーバーで決めた言語と、その言語の辞書だけを受け取る。言語を変えたら Cookie を書き、サーバー側から描き直す。
export function I18nProvider({ locale, preference, messages, children }: {
  locale: Locale;
  preference: LocalePreference;
  messages: Messages;
  children: ReactNode;
}) {
  const router = useRouter();
  const [switching, startTransition] = useTransition();
  // router.refresh() のたびに辞書は新しいオブジェクトで届く。言語が同じ間は同じ t を使い続け、
  // t に依存する処理（読み込み直しなど）が言語切替以外で走らないようにする。
  const [translator, setTranslator] = useState(() => ({ locale, t: createTranslator(messages) }));
  if (translator.locale !== locale) setTranslator({ locale, t: createTranslator(messages) });
  const t = translator.locale === locale ? translator.t : createTranslator(messages);
  // サーバー描画の <html lang> は常に en（ルートを静的に保つため）。表示言語に合わせる。
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.lang;
    root.lang = LOCALE_TAGS[locale];
    return () => { root.lang = previous; };
  }, [locale]);
  const setPreference = useCallback((next: LocalePreference) => {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = next === "auto"
      ? `${LOCALE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
      : `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
    startTransition(() => router.refresh());
  }, [router]);
  const value = useMemo(() => ({ locale, tag: LOCALE_TAGS[locale], preference, t, setPreference, switching }),
    [locale, preference, t, setPreference, switching]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export function useT() {
  return useContext(I18nContext).t;
}
