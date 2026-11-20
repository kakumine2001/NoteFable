import { NextResponse, type NextRequest } from "next/server";
import { RETURNING_HINT_COOKIE, RETURNING_HINT_MAX_AGE, splitHosts } from "@/lib/hosts";
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "@/lib/i18n/locale";
import { routeLocalizedRequest } from "@/lib/i18n/routing";

// /、/app、/note-embed の表示言語を決め、言語ごとに作り置いた静的なページへ中身だけ差し替える（URL は変えない）。
// 言語の決め方は src/lib/i18n/locale.ts（Cookie の選択 → ブラウザの言語 → 接続元の地域 → 英語）。
// 紹介サイトとワークスペースを別ホストにしたとき（src/lib/hosts.ts）は、ホストごとの振り分けもここで行う。
export function proxy(request: NextRequest) {
  const hosts = splitHosts();
  const route = routeLocalizedRequest({
    url: request.url,
    cookie: (name) => request.cookies.get(name)?.value,
    header: (name) => request.headers.get(name),
  }, hosts);
  // 転送は 307（一時的）。回訪者の転送は Cookie 次第で変わるので、ブラウザに覚えさせない。
  const response = route.kind === "redirect" ? NextResponse.redirect(route.url)
    : route.kind === "rewrite" ? NextResponse.rewrite(route.url)
    : NextResponse.next();
  if (route.noindex) response.headers.set("X-Robots-Tag", "noindex");
  // 分域前に紹介サイトだけに書いた言語の選択を、ワークスペースのホストへ持っていく（Cookie が 1 つだけのとき。
  // 2 つあるなら共通 Domain の選択がもうあるので触らない）。
  const carried = route.carryLocale && hosts?.cookieDomain ? singleLocaleCookie(request.headers.get("cookie")) : null;
  if (carried && hosts?.cookieDomain) {
    response.cookies.set(LOCALE_COOKIE, carried, { domain: hosts.cookieDomain, path: "/", maxAge: LOCALE_COOKIE_MAX_AGE, sameSite: "lax", secure: true });
  }
  if (route.hint && hosts?.cookieDomain && !request.cookies.has(RETURNING_HINT_COOKIE)) {
    response.cookies.set(RETURNING_HINT_COOKIE, "1", {
      domain: hosts.cookieDomain, path: "/", maxAge: RETURNING_HINT_MAX_AGE, sameSite: "lax", secure: true,
    });
  }
  return response;
}

// Cookie ヘッダーに言語 Cookie がちょうど 1 つあり、有効な言語のときその値。
function singleLocaleCookie(header: string | null) {
  const values = (header ?? "").split(/;\s*/).filter((part) => part.startsWith(`${LOCALE_COOKIE}=`)).map((part) => part.slice(LOCALE_COOKIE.length + 1));
  return values.length === 1 && isLocale(values[0]) ? values[0] : null;
}

export const config = {
  // PROXY_MATCHER（src/lib/i18n/routing.ts）と同じ値。
  matcher: ["/", "/app", "/note-embed", "/c/:id", "/:locale([A-Za-z]{2}(?:-[A-Za-z]{2,4})?)/app", "/:locale([A-Za-z]{2}(?:-[A-Za-z]{2,4})?)/note-embed"],
};
