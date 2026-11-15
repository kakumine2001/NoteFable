import { NextResponse, type NextRequest } from "next/server";
import { LOCALE_COOKIE, parsePreference, resolveLocale } from "@/lib/i18n/locale";
import { messagesFor } from "@/lib/i18n/messages";

// 言語を切り替えたとき、画面はページを読み直さずにこの辞書へ差し替える（ワークスペースの入力中の状態を残すため）。
// 言語の決め方は proxy.ts と同じ（Cookie の選択 → ブラウザの言語 → 接続元の地域 → 英語）。
export function GET(request: NextRequest) {
  const locale = resolveLocale({
    // 切替前に辞書を取得し、成功したときだけブラウザで Cookie を保存する。
    preference: parsePreference(request.nextUrl.searchParams.get("preference") ?? request.cookies.get(LOCALE_COOKIE)?.value),
    acceptLanguage: request.headers.get("accept-language"),
    country: request.headers.get("x-vercel-ip-country"),
  });
  return NextResponse.json({ locale, messages: messagesFor(locale) }, { headers: { "Cache-Control": "private, no-store" } });
}
