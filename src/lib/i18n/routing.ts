import { isLocale, LEGACY_LOCALE_COOKIE, LOCALE_COOKIE, parsePreference, resolveLocale } from "@/lib/i18n/locale";

// 紹介ページ（/）とワークスペース（/app）、Android アプリが WebView に載せるノートのエディター（/note-embed）は、
// 言語ごとに作り置いた静的なページ（/[locale]、/[locale]/app、/[locale]/note-embed）で配る。
// proxy.ts がここで表示言語を決め、アドレスバーの URL はそのままで中身だけ言語別のページに差し替える（rewrite）。
export const LOCALIZED_PATHS = ["/", "/app", "/note-embed"] as const;
// アプリは自分の表示言語を ?lang= で渡す（/note-embed だけ）。Cookie やブラウザの言語より優先する。
const EMBED_PATH = "/note-embed";

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
  if (!(LOCALIZED_PATHS as readonly string[]).includes(url.pathname)) return { kind: "none" };
  const requested = url.pathname === EMBED_PATH ? url.searchParams.get("lang") : null;
  const locale = isLocale(requested) ? requested : resolveLocale({
    preference: parsePreference(request.cookie(LOCALE_COOKIE) ?? request.cookie(LEGACY_LOCALE_COOKIE)),
    acceptLanguage: request.header("accept-language"),
    country: request.header("x-vercel-ip-country"),
  });
  const target = new URL(url);
  target.pathname = url.pathname === "/" ? `/${locale}` : `/${locale}${url.pathname}`;
  return { kind: "rewrite", url: target };
}
