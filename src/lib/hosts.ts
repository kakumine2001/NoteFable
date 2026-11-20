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

// ワークスペースを使ったことのある端末の目印。ワークスペースのホストが両ホスト共通の Domain で書き、紹介サイトの / が読んで
// ワークスペースへ送る。中身は "1" だけで、本人確認には使わない（ログインや端末の識別は各ホストの Cookie の役目）。
export const RETURNING_HINT_COOKIE = "notefable_app";
export const RETURNING_HINT_MAX_AGE = 60 * 60 * 24 * 400;
