"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { splitHosts } from "@/lib/hosts";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, LOCALE_DIRS, LOCALE_TAGS, parsePreference, type Locale, type LocalePreference, type TextDirection } from "@/lib/i18n/locale";
import { createTranslator, type Messages, type Translate } from "@/lib/i18n/translate";

import { createLocaleSwitcher } from "@/lib/locale-switch";

type I18nValue = {
  locale: Locale;
  // BCP 47 タグ。日付の書式（toLocaleDateString）に渡す。
  tag: string;
  dir: TextDirection;
  preference: LocalePreference;
  t: Translate;
  setPreference: (next: LocalePreference) => Promise<boolean>;
  switching: boolean;
  // 切り替え中の行き先（切り替えていなければ null）。表示がアカウントの言語に向かっているかを同期が確かめる。
  target: LocalePreference | null;
  changeError: string;
};

const fallback: I18nValue = {
  locale: "en", tag: "en", dir: "ltr", preference: "auto", t: createTranslator({}), setPreference: async () => false, switching: false, target: null, changeError: "",
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

// 言語の選択を Cookie に書く（"auto" は消す）。読んでいる画面へ知らせる。
// 紹介サイトとワークスペースを別ホストにしたときは、両方のホストで同じ選択を読めるよう共通の Domain に書き、
// 以前このホストだけに書いた Cookie は消す（同じ名前が 2 つ残ると古い方を読むことがある）。
function writeLocaleCookie(next: LocalePreference) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  const domain = sharedCookieDomain();
  const base = `Path=/; SameSite=Lax${secure}`;
  if (domain) document.cookie = `${LOCALE_COOKIE}=; ${base}; Max-Age=0`;
  const scope = domain ? `${base}; Domain=${domain}` : base;
  document.cookie = next === "auto"
    ? `${LOCALE_COOKIE}=; ${scope}; Max-Age=0`
    : `${LOCALE_COOKIE}=${next}; ${scope}; Max-Age=${LOCALE_COOKIE_MAX_AGE}`;
  preferenceListeners.forEach((listener) => listener());
}

// 今のホストが別ホスト構成の一方のとき、両方で読める Cookie の Domain。そうでなければ null（このホストだけに書く）。
function sharedCookieDomain() {
  const hosts = splitHosts();
  if (!hosts?.cookieDomain) return null;
  return window.location.host === hosts.siteHost || window.location.host === hosts.appHost ? hosts.cookieDomain : null;
}

// 別ホストに分ける前にこのホストだけに書いた言語の Cookie を、両ホスト共通の Domain に移す（一度だけ、表示時に）。
// 両方が残っていると、proxy（最後の値）と画面（最初の値）で読む値が食い違うため。両方あるときは共通 Domain の方を残す。
function migrateLocaleCookie() {
  const domain = sharedCookieDomain();
  if (!domain) return;
  const values = document.cookie.split("; ").filter((part) => part.startsWith(`${LOCALE_COOKIE}=`));
  if (values.length === 0) return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  const base = `Path=/; SameSite=Lax${secure}`;
  document.cookie = `${LOCALE_COOKIE}=; ${base}; Max-Age=0`;
  if (values.length === 1) {
    const value = parsePreference(values[0].slice(LOCALE_COOKIE.length + 1));
    if (value !== "auto") document.cookie = `${LOCALE_COOKIE}=${value}; ${base}; Domain=${domain}; Max-Age=${LOCALE_COOKIE_MAX_AGE}`;
  }
  preferenceListeners.forEach((listener) => listener());
}

// 進行中の言語の切り替え（辞書の取得）。新しい切り替えやログアウトが来たら中止する（後から Cookie を書き戻さないように）。
let activeSwitch: ReturnType<typeof createLocaleSwitcher> | null = null;

// ブラウザに残した言語の選択を消す（ログアウトの直前に呼ぶ）。次に開いたページは環境の言語で表示される。
export function forgetLocaleChoice() {
  activeSwitch?.cancel();
  writeLocaleCookie("auto");
}

// 最初は静的ページの言語だけを受け取る。切替時は辞書だけを取得し、入力や送信中の状態を保つ。
// router.refresh() は [locale] のセグメントを変え、ワークスペースを作り直してしまうため使わない。
export function I18nProvider({ locale, messages, children }: {
  locale: Locale;
  messages: Messages;
  children: ReactNode;
}) {
  const [target, setTarget] = useState<LocalePreference | null>(null);
  const [changeError, setChangeError] = useState("");
  const preference = useSyncExternalStore(subscribePreference, readPreference, serverPreference);
  // 同じ言語の間は同じ t を使い、t に依存する処理を不要に読み込み直さない。
  const [translator, setTranslator] = useState(() => ({ locale, t: createTranslator(messages) }));
  const { locale: activeLocale, t } = translator;

  useEffect(migrateLocaleCookie, []);
  // ルートのレイアウトは静的に保つため <html lang="en"> を出す。表示言語と文字方向に合わせて書き換える。
  useEffect(() => {
    const root = document.documentElement;
    const previousLang = root.lang;
    const previousDir = root.dir;
    root.lang = LOCALE_TAGS[activeLocale];
    root.dir = LOCALE_DIRS[activeLocale];
    return () => {
      root.lang = previousLang;
      root.dir = previousDir;
    };
  }, [activeLocale]);
  const [switcher] = useState(() => createLocaleSwitcher({
    locale,
    pending: setTarget,
    error: setChangeError,
    commit: (next, dictionary) => {
      writeLocaleCookie(next);
      if (dictionary) {
        setTranslator((current) => current.locale === dictionary.locale ? current : { locale: dictionary.locale, t: createTranslator(dictionary.messages) });
      }
    },
  }));
  useEffect(() => () => { switcher.cancel(); if (activeSwitch === switcher) activeSwitch = null; }, [switcher]);
  const setPreference = useCallback((next: LocalePreference) => {
    if (activeSwitch !== switcher) activeSwitch?.cancel();
    activeSwitch = switcher;
    return switcher.choose(next);
  }, [switcher]);
  const switching = target !== null;
  const dir = LOCALE_DIRS[activeLocale];
  const value = useMemo(() => ({ locale: activeLocale, tag: LOCALE_TAGS[activeLocale], dir, preference, t, setPreference, switching, target, changeError }),
    [activeLocale, dir, preference, t, setPreference, switching, target, changeError]);
  // data-locale-root: 静的 HTML の時点で表示言語と文字方向を持つ目印。global-error.tsx が落ちる前の言語を知るのに使う。
  return <I18nContext.Provider value={value}><div lang={LOCALE_TAGS[activeLocale]} dir={dir} data-locale-root="" className="contents">{children}</div></I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export function useT() {
  return useContext(I18nContext).t;
}
