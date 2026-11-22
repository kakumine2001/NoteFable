import { DEVICE_COOKIE, SESSION_COOKIE } from "@/lib/cookie-names";
import { RETURNING_HINT_COOKIE, splitHosts, type SplitHosts } from "@/lib/hosts";
import { isLocale, LOCALE_COOKIE, parsePreference, resolveLocale, type Locale } from "@/lib/i18n/locale";

// 紹介ページ（/）とワークスペース（/app）、Android アプリが WebView に載せるノートのエディター（/note-embed）は、
// 言語ごとに作り置いた静的なページ（/[locale]、/[locale]/app、/[locale]/note-embed）で配る。
// proxy.ts がここで表示言語を決め、アドレスバーの URL はそのままで中身だけ言語別のページに差し替える（rewrite）。
export const LOCALIZED_PATHS = ["/", "/app", "/note-embed"] as const;
// proxy.ts の matcher（Next.js は matcher を静的に読むので proxy.ts にも同じ値を書き、テストで一致を確かめる）。
// /c/<会話>: 会話の共有リンク（answerConversationUrl）。/<言語>/app: 言語固定のワークスペース（紹介サイトのホストではワークスペースのホストへ送る）。
// /<言語>/note-embed: 言語固定のエディター（紹介サイトのホストではワークスペースのホストへ送る）。
export const PROXY_MATCHER = [...LOCALIZED_PATHS, "/c/:id", "/:locale([A-Za-z]{2}(?:-[A-Za-z]{2,4})?)/app", "/:locale([A-Za-z]{2}(?:-[A-Za-z]{2,4})?)/note-embed"];
// アプリは自分の表示言語を ?lang= で渡す（/note-embed だけ）。Cookie やブラウザの言語より優先する。
const EMBED_PATH = "/note-embed";

// 一度でもワークスペースを使った端末（匿名の端末 Cookie かログイン Cookie がある）は、/ を開くと紹介ページを飛ばして /app へ送る。
// 中身は確かめない（署名の検証はサーバー側の仕事で、ここは表示を選ぶだけ）。?intro を付けると紹介ページを見られる。
// 紹介サイトとワークスペースを別ホストにした後は、ワークスペースの Cookie は紹介サイトに届かないので、共通 Domain の目印（hosts.ts）も見る。
const RETURNING_COOKIES = [RETURNING_HINT_COOKIE, DEVICE_COOKIE, ...[SESSION_COOKIE, `__Secure-${SESSION_COOKIE}`].flatMap((name) => [name, `${name}.0`])];
const INTRO_PARAM = "intro";
// 紹介ページへのリンク（端末 Cookie があってもワークスペースへ送られない）。Android の AccountUi.kt も同じ URL。
export const INTRO_HREF = `/?${INTRO_PARAM}`;

// 紹介ページの言語ごとの URL（/en・/zh・/zh-Hant・/ja）。静的なページ /[locale] がそのまま出る（proxy は通らない）ので、
// 検索エンジンが言語ごとに拾え、共有したリンクもその言語のまま開く。/ は proxy.ts が環境の言語を選ぶ入口。
export function landingPath(locale: Locale) {
  return `/${locale}`;
}

// 検索エンジン向けの絶対 URL（sitemap.xml・robots.txt）の土台。本番の URL は Vercel が渡す（手元のビルドでは localhost）。
export function siteOrigin() {
  const split = splitHosts();
  if (split) return split.site;
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return host ? `https://${host}` : "http://localhost:3000";
}

// 会話の共有リンク /c/<会話>?message=<メッセージ>。Android の App Links はこの形だけを App で開く（ログインや Stripe からの
// 戻り先の / や /app は App に取られない）。ワークスペースの /?chat=<会話>&message=… へ送る。
const SHARE_PATH = /^\/c\/([A-Za-z0-9_-]{1,64})\/?$/;
const LOCALE_APP_PATH = /^\/[A-Za-z]{2}(?:-[A-Za-z]{2,4})?\/app\/?$/;
const LOCALE_EMBED_PATH = /^\/[A-Za-z]{2}(?:-[A-Za-z]{2,4})?\/note-embed\/?$/;

// 保存済みの会話・ノートへの古いリンク（/?chat=… など）は、指定を保ったままワークスペースへ送る。
// share: システムの「共有」から届いた内容の受け取り口（/app?share=<id>、src/lib/share-target.ts）。
const LEGACY_WORKSPACE_KEYS = ["chat", "message", "view", "page", "share"];

// hint: ワークスペースを使った目印の Cookie を書く。noindex: 検索エンジンに載せない（ワークスペースのホスト）。
// carryLocale: 紹介サイトからワークスペースのホストへ送るとき、このホストだけの言語 Cookie を両ホスト共通の Domain にも書く。
export type LocaleRoute = ({ kind: "redirect"; url: URL } | { kind: "rewrite"; url: URL } | { kind: "none" }) & { hint?: boolean; noindex?: boolean; carryLocale?: boolean };

// ワークスペースのホストの / に search を付けた URL。
function workspaceUrl(hosts: SplitHosts, url: URL) {
  return new URL(`/${url.search}`, hosts.app);
}

export function routeLocalizedRequest(request: {
  url: string;
  cookie: (name: string) => string | undefined;
  header: (name: string) => string | null;
}, hosts: SplitHosts | null = splitHosts()): LocaleRoute {
  const url = new URL(request.url);
  // 別ホストの構成で、どちらのホストでもない要求（Preview の *.vercel.app など）は、今まで通り 1 つのホストとして扱う。
  const role = !hosts ? "single" : url.host === hosts.appHost ? "app" : url.host === hosts.siteHost ? "site" : "single";
  const returning = url.pathname === "/" && !url.searchParams.has(INTRO_PARAM) && RETURNING_COOKIES.some((name) => request.cookie(name));
  const legacy = url.pathname === "/" && LEGACY_WORKSPACE_KEYS.some((key) => url.searchParams.has(key));

  const share = SHARE_PATH.exec(url.pathname);
  if (share) {
    const target = new URL(url);
    target.searchParams.delete("chat");
    target.search = `?${new URLSearchParams([["chat", share[1]], ...target.searchParams])}`;
    if (hosts && role !== "single") return { kind: "redirect", url: workspaceUrl(hosts, target), noindex: true };
    target.pathname = "/app";
    return { kind: "redirect", url: target };
  }
  if (url.pathname.startsWith("/c/")) return { kind: "none" };
  if (LOCALE_APP_PATH.test(url.pathname)) {
    // 言語固定のワークスペース（/ja/app など）は静的なページがそのまま出る。紹介サイトのホストでだけワークスペースのホストへ送る。
    if (hosts && role === "site") return { kind: "redirect", url: workspaceUrl(hosts, url), carryLocale: true };
    return role === "app" ? { kind: "none", noindex: true } : { kind: "none" };
  }
  if (LOCALE_EMBED_PATH.test(url.pathname)) {
    // 言語固定のエディター（/ja/note-embed など）も、紹介サイトのホストでだけワークスペースのホストへ送る。
    if (hosts && role === "site") return { kind: "redirect", url: new URL(`${url.pathname}${url.search}`, hosts.app) };
    return { kind: "none" };
  }

  if (hosts && role === "site") {
    // 紹介サイトのワークスペース（/app、古い /?chat=…、回訪者の /）は、ワークスペースのホストへ。指定（検索部分）は保つ。
    // /api/* は proxy を通らない。このホストでは next.config.ts の rewrites が止める（hosts.ts の siteApiBlockRewrites）。
    if (url.pathname === "/app" || legacy || returning) return { kind: "redirect", url: workspaceUrl(hosts, url), carryLocale: true };
    // ノートのエディターはワークスペースのホストの API を使うので、そちらへ送る。
    if (url.pathname === EMBED_PATH) return { kind: "redirect", url: new URL(`${EMBED_PATH}${url.search}`, hosts.app) };
  }
  if (hosts && role === "app") {
    // ワークスペースのホストでは / がワークスペース。/app（Stripe からの戻りや古いリンク）は / へ寄せる。
    if (url.pathname === "/app") return { kind: "redirect", url: workspaceUrl(hosts, url), noindex: true };
  } else if (legacy || returning) {
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
  const page = role === "app" && url.pathname === "/" ? "/app" : url.pathname;
  target.pathname = page === "/" ? `/${locale}` : `/${locale}${page}`;
  if (role === "app") return { kind: "rewrite", url: target, noindex: true, hint: page === "/app" };
  return { kind: "rewrite", url: target };
}
