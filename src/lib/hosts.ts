// 紹介サイト（notefable.com）とワークスペース（app.notefable.com）を別のホストで配るための設定。
// NEXT_PUBLIC_SITE_ORIGIN と NEXT_PUBLIC_APP_ORIGIN の両方があるときだけ分ける（本番）。どちらかが無い環境（Preview・手元）は
// 今まで通り 1 つのホストで / が紹介ページ、/app がワークスペース。proxy とブラウザの両方から読むので、重い依存を持たせない。

export type SplitHosts = {
  site: string; // 紹介サイトの origin（https://notefable.com）
  app: string; // ワークスペースの origin（https://app.notefable.com）
  siteHost: string;
  appHost: string;
  // 両方のホストで読める Cookie の Domain（app が site のサブドメインのときだけ。例: notefable.com）。
  cookieDomain: string | null;
};

function origin(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

export function splitHosts(env: { site?: string; app?: string } = {
  // NEXT_PUBLIC_* はビルド時に埋め込まれるので、process.env.NAME の形のまま書く。
  site: process.env.NEXT_PUBLIC_SITE_ORIGIN,
  app: process.env.NEXT_PUBLIC_APP_ORIGIN,
}): SplitHosts | null {
  const site = origin(env.site);
  const app = origin(env.app);
  if (!site || !app || site.host === app.host) return null;
  return {
    site: site.origin,
    app: app.origin,
    siteHost: site.host,
    appHost: app.host,
    cookieDomain: app.hostname.endsWith(`.${site.hostname}`) ? site.hostname : null,
  };
}

// ワークスペースへのリンク。search は "?chat=…" のような検索部分（無ければ空）。
export function appHref(search = "", hosts = splitHosts()) {
  return hosts ? `${hosts.app}/${search}` : `/app${search}`;
}

// 紹介サイト側のページ（/?intro、/privacy など）へのリンク。ワークスペースのホストにいるときだけ紹介サイトへの絶対 URL にし、
// それ以外（紹介サイト、Preview、notefable-kaku10.vercel.app のような別名）は同じホストの相対パス。currentHost を省くとブラウザの今のホスト。
export function siteHref(path: string, hosts = splitHosts(), currentHost = typeof window === "undefined" ? null : window.location.host) {
  return hosts && currentHost === hosts.appHost ? `${hosts.site}${path}` : path;
}

// 今のページが紹介サイトのホストか（ブラウザだけ。ホストを分けていない環境では false）。このホストには API もログインも無い。
// 名前が同じでポートだけ違う構成（手元）は API を止めていないので、紹介サイトのホストとは見なさない。
export function onSiteHost(hosts = splitHosts(), currentHost = typeof window === "undefined" ? null : window.location.host) {
  return Boolean(hosts && currentHost === hosts.siteHost && siteApiBlocked(hosts));
}

// 紹介サイトのホストでは API を配らない（API はワークスペースのホストだけ）。例外は紹介ページの言語メニューが読む辞書（/api/i18n）。
// next.config.ts の rewrites（beforeFiles）に入れる規則。ホストを分けていない環境では空で、別名（*.vercel.app）にも掛からない。
export const SITE_API_PATHS = ["i18n"];
export const SITE_API_BLOCKED_PATH = "/api/unavailable";

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Next.js は Host ヘッダーのポートを除いた名前と比べる。名前が同じでポートだけ違う構成（手元で 2 つのポートに分けたとき）は
// 見分けられないので、何も止めない。
function siteApiBlocked(hosts: SplitHosts) {
  return new URL(hosts.site).hostname !== new URL(hosts.app).hostname;
}

export function siteApiBlockRewrites(hosts = splitHosts()) {
  if (!hosts || !siteApiBlocked(hosts)) return [];
  const siteName = new URL(hosts.site).hostname;
  return [{
    source: `/api/:path((?!(?:${SITE_API_PATHS.map(escapeRegex).join("|")})$).*)`,
    has: [{ type: "host" as const, value: escapeRegex(siteName) }],
    destination: SITE_API_BLOCKED_PATH,
  }];
}

// ワークスペースを使ったことのある端末の目印。ワークスペースのホストが両ホスト共通の Domain で書き、紹介サイトの / が読んで
// ワークスペースへ送る。中身は "1" だけで、本人確認には使わない（ログインや端末の識別は各ホストの Cookie の役目）。
export const RETURNING_HINT_COOKIE = "notefable_app";
export const RETURNING_HINT_MAX_AGE = 60 * 60 * 24 * 400;
