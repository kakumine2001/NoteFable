"use client";

import "./globals.css";
import { AppErrorScreen } from "@/components/app-error-screen";
import { I18nProvider } from "@/components/i18n-provider";
import { isLocale, LOCALE_COOKIE, LOCALE_TAGS, localeFromAcceptLanguage, type Locale } from "@/lib/i18n/locale";
import { messagesFor } from "@/lib/i18n/messages";

// ルートのレイアウト（[locale]/layout の言語設定を含む）で例外が起きたときの画面。レイアウトの代わりに html と body を自分で出す。
// 言語は保存済みの設定、なければブラウザの言語から決める（proxy.ts と同じ優先順。地域による判定はここでは使えない）。
function clientLocale(): Locale {
  if (typeof document === "undefined") return "en";
  const saved = document.cookie.split("; ").find((part) => part.startsWith(`${LOCALE_COOKIE}=`))?.slice(LOCALE_COOKIE.length + 1);
  if (isLocale(saved)) return saved;
  return localeFromAcceptLanguage(navigator.languages?.join(",") || navigator.language) ?? "en";
}

export default function GlobalError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  const locale = clientLocale();
  return (
    <html lang={LOCALE_TAGS[locale]}>
      <body>
        <title>NoteFable</title>
        <I18nProvider locale={locale} messages={messagesFor(locale)}>
          <AppErrorScreen error={error} retry={unstable_retry} />
        </I18nProvider>
      </body>
    </html>
  );
}
