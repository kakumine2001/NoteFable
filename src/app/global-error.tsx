"use client";

import "./globals.css";
import { useEffect, useRef, useState } from "react";
import { AppErrorScreen } from "@/components/app-error-screen";
import { I18nProvider } from "@/components/i18n-provider";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, LOCALE_TAGS, localeFromAcceptLanguage, type Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/translate";

// ルートのレイアウト（[locale]/layout の言語設定を含む）で例外が起きたときの画面。レイアウトの代わりに html と body を自分で出す。
// このファイルはどのページにも読み込まれるので、辞書は例外が起きてから読む（静的に import すると全言語の辞書が毎回届く）。
// 最初はサーバーと同じ英語で描き（hydration をずらさない）、読み終えたら利用者の言語に切り替える。
// 言語は、落ちる前のページの <html lang>（I18nProvider が表示言語に合わせている）を最優先にする。
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
  // 最初の描画の時点では、まだ落ちる前の <html> が画面にある。表示には使わない（ref）ので hydration はずれない。
  const pageTag = useRef(typeof document === "undefined" ? "" : document.documentElement.lang);
  useEffect(() => {
    const locale = clientLocale(pageTag.current);
    if (locale === DEFAULT_LOCALE) return;
    let live = true;
    void import("@/lib/i18n/messages").then(({ messagesFor }) => { if (live) setI18n({ locale, messages: messagesFor(locale) }); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return (
    <html lang={LOCALE_TAGS[i18n.locale]}>
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
