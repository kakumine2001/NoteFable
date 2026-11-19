import { NextResponse, type NextRequest } from "next/server";
import { RETURNING_HINT_COOKIE, RETURNING_HINT_MAX_AGE, splitHosts } from "@/lib/hosts";
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
  if (route.hint && hosts?.cookieDomain && !request.cookies.has(RETURNING_HINT_COOKIE)) {
    response.cookies.set(RETURNING_HINT_COOKIE, "1", {
      domain: hosts.cookieDomain, path: "/", maxAge: RETURNING_HINT_MAX_AGE, sameSite: "lax", secure: true,
    });
  }
  return response;
}

export const config = {
  // LOCALIZED_PATHS（src/lib/i18n/routing.ts）と同じ並び。
  matcher: ["/", "/app", "/note-embed"],
};
