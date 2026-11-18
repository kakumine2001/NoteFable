"use client";

import "./globals.css";
import { useEffect, useRef, useState } from "react";
import { AppErrorScreen } from "@/components/app-error-screen";
import { I18nProvider } from "@/components/i18n-provider";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, LOCALE_DIRS, LOCALE_TAGS, localeFromAcceptLanguage, type Locale } from "@/lib/i18n/locale";
import { loadMessages } from "@/lib/i18n/messages/load";
import type { Messages } from "@/lib/i18n/translate";

// ルートのレイアウト（[locale]/layout の言語設定を含む）で例外が起きたときの画面。レイアウトの代わりに html と body を自分で出す。
// このファイルはどのページにも読み込まれるので、辞書は例外が起きてから読む（静的に import すると全言語の辞書が毎回届く）。
// 最初はサーバーと同じ英語で描き（hydration をずらさない）、読み終えたら利用者の言語に切り替える。
// 言語は、落ちる前のページで I18nProvider が出した要素（data-locale-root）の lang を最優先にする。静的 HTML の時点から
// 表示言語を持っている。<html lang> は Provider が書き換えるまで根のレイアウトの "en" のままなので使わない。
// 取れなければ保存済みの設定、ブラウザの言語の順（proxy.ts と同じ順。接続元の地域はブラウザからは分からない）。
function clientLocale(pageTag: string): Locale {
  const fromPage = (Object.keys(LOCALE_TAGS) as Locale[]).find((locale) => LOCALE_TAGS[locale] === pageTag);
  if (fromPage) return fromPage;
  const saved = document.cookie.split("; ").find((part) => part.startsWith(`${LOCALE_COOKIE}=`))?.slice(LOCALE_COOKIE.length + 1);
  if (isLocale(saved)) return saved;
  return localeFromAcceptLanguage(navigator.languages?.join(",") || navigator.language) ?? DEFAULT_LOCALE;
}

export default function GlobalError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  const [i18n, setI18n] = useState<{ locale: Locale; messages: Messages }>({ locale: DEFAULT_LOCALE, messages: {} });
  // 最初の描画の時点では、まだ落ちる前のページが画面にある。表示には使わない（ref）ので hydration はずれない。
  const pageTag = useRef(typeof document === "undefined" ? "" : document.querySelector("[data-locale-root]")?.getAttribute("lang") ?? "");
  useEffect(() => {
    const locale = clientLocale(pageTag.current);
    if (locale === DEFAULT_LOCALE) return;
    let live = true;
    void loadMessages(locale).then((messages) => { if (live) setI18n({ locale, messages }); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return (
    <html lang={LOCALE_TAGS[i18n.locale]} dir={LOCALE_DIRS[i18n.locale]}>
      <body>
        <title>NoteFable</title>
        {/* I18nProvider は最初に受け取った辞書を使い続けるので、言語が変わったら作り直す。 */}
        <I18nProvider key={i18n.locale} locale={i18n.locale} messages={i18n.messages}>
          <AppErrorScreen error={error} retry={unstable_retry} />
        </I18nProvider>
      </body>
    </html>
  );
}
