import { NextResponse } from "next/server";
import { LOCALE_COOKIE, parsePreference, resolveLocale, type Locale } from "@/lib/i18n/locale";
import { messagesFor } from "@/lib/i18n/messages";
import { createTranslator, msg } from "@/lib/i18n/translate";
import type { PageKind } from "@/lib/page-kinds";

// ページの種類に合わない操作（ホワイトボードの Markdown 書き出し、スライドの書体の変更など）を断る応答。
// 古いアプリの「…」メニューはノート専用の操作をどの種類にも出し、そのアプリの辞書にはこの文が無い。だから英語の鍵ではなく、
// 要求の言語（Cookie で選んだ言語 → Accept-Language → 接続元の地域 → 英語。/api/i18n と同じ決め方）に訳した文を error に入れて返す。
// 新しい画面は訳済みの文をそのまま出す（辞書に無い文は t() がそのまま返す）。code と kind は画面が見分けるため。

function cookieValue(header: string | null, name: string) {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      try { return decodeURIComponent(rest.join("=")); } catch { return undefined; }
    }
  }
  return undefined;
}

export function requestLocale(request: Request): Locale {
  return resolveLocale({
    preference: parsePreference(cookieValue(request.headers.get("cookie"), LOCALE_COOKIE)),
    acceptLanguage: request.headers.get("accept-language"),
    country: request.headers.get("x-vercel-ip-country"),
  });
}

export function translateForRequest(request: Request, text: string) {
  return createTranslator(messagesFor(requestLocale(request)))(text);
}

export const WRONG_PAGE_KIND = "wrong_page_kind";

export function pageKindRejection(request: Request, text: string, kind: PageKind, status = 400) {
  return NextResponse.json({ error: translateForRequest(request, text), code: WRONG_PAGE_KIND, kind }, { status });
}

// 種類ごとに、ノート専用の操作を断る文。
export const NOTE_ONLY_ACTION_ERRORS = {
  export: msg("Only notes can be exported as Markdown."),
  typography: msg("Font, text size and width can only be changed for notes."),
  share: msg("Whiteboards and slide decks can't be published yet."),
  save: msg("This page can't be edited in this version of NoteFable."),
} as const;
