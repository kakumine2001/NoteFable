import { DEVICE_COOKIE, SESSION_COOKIE } from "@/lib/cookie-names";
import { isLocale, LOCALE_COOKIE, parsePreference, resolveLocale } from "@/lib/i18n/locale";

// 紹介ページ（/）とワークスペース（/app）、Android アプリが WebView に載せるノートのエディター（/note-embed）は、
// 言語ごとに作り置いた静的なページ（/[locale]、/[locale]/app、/[locale]/note-embed）で配る。
// proxy.ts がここで表示言語を決め、アドレスバーの URL はそのままで中身だけ言語別のページに差し替える（rewrite）。
export const LOCALIZED_PATHS = ["/", "/app", "/note-embed"] as const;
// アプリは自分の表示言語を ?lang= で渡す（/note-embed だけ）。Cookie やブラウザの言語より優先する。
const EMBED_PATH = "/note-embed";

// 一度でもワークスペースを使った端末（匿名の端末 Cookie かログイン Cookie がある）は、/ を開くと紹介ページを飛ばして /app へ送る。
// 中身は確かめない（署名の検証はサーバー側の仕事で、ここは表示を選ぶだけ）。?intro を付けると紹介ページを見られる。
const RETURNING_COOKIES = [DEVICE_COOKIE, ...[SESSION_COOKIE, `__Secure-${SESSION_COOKIE}`].flatMap((name) => [name, `${name}.0`])];
const INTRO_PARAM = "intro";
// 紹介ページへのリンク（端末 Cookie があってもワークスペースへ送られない）。Android の AccountUi.kt も同じ URL。
export const INTRO_HREF = `/?${INTRO_PARAM}`;

// 保存済みの会話・ノートへの古いリンク（/?chat=… など）は、指定を保ったままワークスペースへ送る。
const LEGACY_WORKSPACE_KEYS = ["chat", "message", "view", "page"];

export type LocaleRoute = { kind: "redirect"; url: URL } | { kind: "rewrite"; url: URL } | { kind: "none" };

export function routeLocalizedRequest(request: {
  url: string;
  cookie: (name: string) => string | undefined;
  header: (name: string) => string | null;
}): LocaleRoute {
  const url = new URL(request.url);
  if (url.pathname === "/" && LEGACY_WORKSPACE_KEYS.some((key) => url.searchParams.has(key))) {
    const target = new URL(url);
    target.pathname = "/app";
    return { kind: "redirect", url: target };
  }
  if (url.pathname === "/" && !url.searchParams.has(INTRO_PARAM) && RETURNING_COOKIES.some((name) => request.cookie(name))) {
    const target = new URL(url);
    target.pathname = "/app";
    return { kind: "redirect", url: target };
  }
  if (!(LOCALIZED_PATHS as readonly string[]).includes(url.pathname)) return { kind: "none" };
  const requested = url.pathname === EMBED_PATH ? url.searchParams.get("lang") : null;
  const locale = isLocale(requested) ? requested : resolveLocale({
    preference: parsePreference(request.cookie(LOCALE_COOKIE)),
    acceptLanguage: request.header("accept-language"),
    country: request.header("x-vercel-ip-country"),
  });
  const target = new URL(url);
  target.pathname = url.pathname === "/" ? `/${locale}` : `/${locale}${url.pathname}`;
  return { kind: "rewrite", url: target };
}
