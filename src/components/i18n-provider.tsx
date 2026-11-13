"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, LOCALE_TAGS, parsePreference, type Locale, type LocalePreference } from "@/lib/i18n/locale";
import { createTranslator, msg, type Messages, type Translate } from "@/lib/i18n/translate";

type I18nValue = {
  locale: Locale;
  // BCP 47 タグ。日付の書式（toLocaleDateString）に渡す。
  tag: string;
  preference: LocalePreference;
  t: Translate;
  setPreference: (next: LocalePreference) => void;
  switching: boolean;
  changeError: string;
};

const fallback: I18nValue = {
  locale: "en", tag: "en", preference: "auto", t: createTranslator({}), setPreference: () => {}, switching: false, changeError: "",
};

const I18nContext = createContext<I18nValue>(fallback);

// 利用者の選択（Cookie）。ページは言語ごとの静的なページなのでサーバーでは読まず、ブラウザで読む。
const preferenceListeners = new Set<() => void>();
const readPreference = () => {
  const match = document.cookie.split("; ").find((part) => part.startsWith(`${LOCALE_COOKIE}=`));
  return parsePreference(match?.slice(LOCALE_COOKIE.length + 1));
};
const subscribePreference = (listener: () => void) => {
  preferenceListeners.add(listener);
  return () => { preferenceListeners.delete(listener); };
};
const serverPreference = (): LocalePreference => "auto";

// 最初は静的ページの言語だけを受け取る。切替時は辞書だけを取得し、入力や送信中の状態を保つ。
// router.refresh() は [locale] のセグメントを変え、ワークスペースを作り直してしまうため使わない。
export function I18nProvider({ locale, messages, children }: {
  locale: Locale;
  messages: Messages;
  children: ReactNode;
}) {
  const [switching, setSwitching] = useState(false);
  const [changeError, setChangeError] = useState("");
  const switchRequest = useRef<AbortController | null>(null);
  const preference = useSyncExternalStore(subscribePreference, readPreference, serverPreference);
  // 同じ言語の間は同じ t を使い、t に依存する処理を不要に読み込み直さない。
  const [translator, setTranslator] = useState(() => ({ locale, t: createTranslator(messages) }));
  const { locale: activeLocale, t } = translator;
  useEffect(() => () => { switchRequest.current?.abort(); }, []);
  // ルートのレイアウトは静的に保つため <html lang="en"> を出す。表示言語に合わせて書き換える。
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.lang;
    root.lang = LOCALE_TAGS[activeLocale];
    return () => { root.lang = previous; };
  }, [activeLocale]);
  const setPreference = useCallback((next: LocalePreference) => {
    if (switchRequest.current) return;
    const controller = new AbortController();
    switchRequest.current = controller;
    setSwitching(true);
    setChangeError("");
    void (async () => {
      try {
        const response = await fetch(`/api/i18n?preference=${encodeURIComponent(next)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Language request failed");
        const data = await response.json();
        if (!isLocale(data.locale) || !data.messages || typeof data.messages !== "object" || Array.isArray(data.messages)
          || Object.values(data.messages).some((message) => typeof message !== "string")) throw new Error("Invalid language response");
        if (controller.signal.aborted) return;
        const secure = window.location.protocol === "https:" ? "; Secure" : "";
        document.cookie = next === "auto"
          ? `${LOCALE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
          : `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
        preferenceListeners.forEach((listener) => listener());
        setTranslator((current) => current.locale === data.locale ? current : { locale: data.locale, t: createTranslator(data.messages) });
      } catch {
        if (!controller.signal.aborted) setChangeError(msg("Could not change language. Please try again."));
      } finally {
        if (!controller.signal.aborted) {
          switchRequest.current = null;
          setSwitching(false);
        }
      }
    })();
  }, []);
  const value = useMemo(() => ({ locale: activeLocale, tag: LOCALE_TAGS[activeLocale], preference, t, setPreference, switching, changeError }),
    [activeLocale, preference, t, setPreference, switching, changeError]);
  return <I18nContext.Provider value={value}><div lang={LOCALE_TAGS[activeLocale]} className="contents">{children}</div></I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export function useT() {
  return useContext(I18nContext).t;
}
