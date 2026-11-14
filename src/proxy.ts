import { NextResponse, type NextRequest } from "next/server";
import { routeLocalizedRequest } from "@/lib/i18n/routing";

// /、/app、/note-embed の表示言語を決め、言語ごとに作り置いた静的なページへ中身だけ差し替える（URL は変えない）。
// 言語の決め方は src/lib/i18n/locale.ts（Cookie の選択 → ブラウザの言語 → 接続元の地域 → 英語）。
export function proxy(request: NextRequest) {
  const route = routeLocalizedRequest({
    url: request.url,
    cookie: (name) => request.cookies.get(name)?.value,
    header: (name) => request.headers.get(name),
  });
  if (route.kind === "redirect") return NextResponse.redirect(route.url);
  if (route.kind === "rewrite") return NextResponse.rewrite(route.url);
  return NextResponse.next();
}

export const config = {
  // LOCALIZED_PATHS（src/lib/i18n/routing.ts）と同じ並び。
  matcher: ["/", "/app", "/note-embed"],
};
