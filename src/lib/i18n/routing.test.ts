import { describe, expect, it } from "vitest";
import { splitHosts } from "@/lib/hosts";
import { routeLocalizedRequest } from "./routing";

function route(path: string, { cookie, language, country, cookies = {} }: { cookie?: string; language?: string; country?: string; cookies?: Record<string, string> } = {}) {
  return routeLocalizedRequest({
    url: `https://example.test${path}`,
    cookie: (name) => (name === "notefable-locale" ? cookie : cookies[name]),
    header: (name) => (name === "accept-language" ? language ?? null : name === "x-vercel-ip-country" ? country ?? null : null),
  });
}

const target = (result: ReturnType<typeof route>) => (result.kind === "none" ? null : `${result.kind} ${result.url.pathname}${result.url.search}`);

describe("localized routing", () => {
  it("serves / and /app from the static page for the chosen language", () => {
    expect(target(route("/", { language: "ja-JP" }))).toBe("rewrite /ja");
    expect(target(route("/app", { language: "zh-TW" }))).toBe("rewrite /zh-Hant/app");
    expect(target(route("/", { language: "ar-SA" }))).toBe("rewrite /ar");
    expect(target(route("/app", { language: "pt-PT" }))).toBe("rewrite /pt-BR/app");
    expect(target(route("/", { language: "in-ID" }))).toBe("rewrite /id");
    expect(target(route("/app?view=pages&page=x", { cookie: "zh", language: "ja" }))).toBe("rewrite /zh/app?view=pages&page=x");
    expect(target(route("/", { country: "JP" }))).toBe("rewrite /ja");
    expect(target(route("/"))).toBe("rewrite /en");
  });

  it("keeps campaign links on the introduction", () => {
    expect(target(route("/?utm_source=bookmark", { language: "en" }))).toBe("rewrite /en?utm_source=bookmark");
  });

  it.each(["notefable_device", "authjs.session-token", "__Secure-authjs.session-token", "__Secure-authjs.session-token.0"])("sends a returning %s visitor from / to the workspace", (name) => {
    expect(target(route("/", { cookies: { [name]: "x" } }))).toBe("redirect /app");
    expect(target(route("/?utm_source=bookmark", { cookies: { [name]: "x" } }))).toBe("redirect /app?utm_source=bookmark");
  });

  it("shows the introduction to returning visitors who ask for it", () => {
    expect(target(route("/?intro", { language: "ja", cookies: { notefable_device: "x" } }))).toBe("rewrite /ja?intro");
  });

  it("serves /app to returning visitors without redirecting", () => {
    expect(target(route("/app", { language: "ja", cookies: { notefable_device: "x" } }))).toBe("rewrite /ja/app");
  });

  it.each(["chat", "message", "view", "page"])("sends legacy %s links to the workspace", (key) => {
    expect(target(route(`/?${key}=existing-id`))).toBe(`redirect /app?${key}=existing-id`);
  });

  it("preserves every legacy parameter, repeated values and Unicode", () => {
    expect(target(route("/?chat=chat-id&message=message-id&extra=%E4%B8%AD%E6%96%87&extra=a%26b")))
      .toBe("redirect /app?chat=chat-id&message=message-id&extra=%E4%B8%AD%E6%96%87&extra=a%26b");
    expect(target(route("/?chat="))).toBe("redirect /app?chat=");
  });

  it("serves the Android note embed from the static page for the chosen language", () => {
    expect(target(route("/note-embed?page=p1", { language: "ja-JP" }))).toBe("rewrite /ja/note-embed?page=p1");
    expect(target(route("/note-embed?page=p1", { cookie: "zh-Hant", language: "ja" }))).toBe("rewrite /zh-Hant/note-embed?page=p1");
    expect(target(route("/note-embed?page=p1"))).toBe("rewrite /en/note-embed?page=p1");
  });

  it("lets the app pick the embed language with ?lang=", () => {
    expect(target(route("/note-embed?page=p1&lang=ja", { cookie: "zh", language: "en" }))).toBe("rewrite /ja/note-embed?page=p1&lang=ja");
    expect(target(route("/note-embed?page=p1&lang=zh", { language: "ja" }))).toBe("rewrite /zh/note-embed?page=p1&lang=zh");
    expect(target(route("/note-embed?page=p1&lang=en", { cookie: "ja" }))).toBe("rewrite /en/note-embed?page=p1&lang=en");
    expect(target(route("/note-embed?page=p1&lang=ar", { cookie: "en" }))).toBe("rewrite /ar/note-embed?page=p1&lang=ar");
    expect(target(route("/note-embed?page=p1&lang=pt-BR", { language: "en" }))).toBe("rewrite /pt-BR/note-embed?page=p1&lang=pt-BR");
    // 対応していない値は無視して、いつもの決め方に戻る。
    expect(target(route("/note-embed?page=p1&lang=nl", { language: "ja" }))).toBe("rewrite /ja/note-embed?page=p1&lang=nl");
  });

  it("only honors ?lang= on the embed", () => {
    expect(target(route("/app?lang=ja", { language: "en" }))).toBe("rewrite /en/app?lang=ja");
  });

  it("runs the proxy on every localized path", async () => {
    const [{ config }, { PROXY_MATCHER }] = await Promise.all([import("@/proxy"), import("./routing")]);
    expect(config.matcher).toEqual(PROXY_MATCHER);
  });

  it("leaves other paths alone", () => {
    expect(route("/note-embed/x").kind).toBe("none");
    expect(route("/ja/note-embed").kind).toBe("none");
    expect(route("/privacy").kind).toBe("none");
    expect(route("/ja").kind).toBe("none");
    expect(route("/ja/app").kind).toBe("none");
    expect(route("/c/").kind).toBe("none");
    expect(route("/c/bad%20id").kind).toBe("none");
  });

  it("opens shared conversation links in the workspace", () => {
    expect(target(route("/c/chat-1?message=m1"))).toBe("redirect /app?chat=chat-1&message=m1");
    expect(target(route("/c/chat-1?chat=other"))).toBe("redirect /app?chat=chat-1");
  });
});

describe("split site and workspace hosts", () => {
  const hosts = splitHosts({ site: "https://notefable.com", app: "https://app.notefable.com" });
  const at = (href: string, { language = "en", cookies = {} as Record<string, string> } = {}) => routeLocalizedRequest({
    url: href,
    cookie: (name) => cookies[name],
    header: (name) => (name === "accept-language" ? language : null),
  }, hosts);
  const where = (result: ReturnType<typeof at>) => (result.kind === "none" ? null : `${result.kind} ${result.kind === "redirect" ? result.url.href : `${result.url.pathname}${result.url.search}`}`);

  it("derives a shared cookie domain only for a subdomain", () => {
    expect(hosts?.cookieDomain).toBe("notefable.com");
    expect(splitHosts({ site: "https://notefable.com", app: "https://notefable.app" })?.cookieDomain).toBeNull();
    expect(splitHosts({ site: "https://notefable.com" })).toBeNull();
    expect(splitHosts({ site: "https://notefable.com", app: "https://notefable.com" })).toBeNull();
    expect(splitHosts({ site: "not a url", app: "https://app.notefable.com" })).toBeNull();
  });

  it("shows the introduction to new visitors on the site", () => {
    expect(where(at("https://notefable.com/", { language: "ja" }))).toBe("rewrite /ja");
    expect(at("https://notefable.com/").noindex).toBeUndefined();
  });

  it("sends the old workspace address and legacy links to the workspace host with their parameters", () => {
    expect(where(at("https://notefable.com/app?view=pages&page=p1"))).toBe("redirect https://app.notefable.com/?view=pages&page=p1");
    expect(where(at("https://notefable.com/?chat=c1&message=m1"))).toBe("redirect https://app.notefable.com/?chat=c1&message=m1");
    expect(where(at("https://notefable.com/app"))).toBe("redirect https://app.notefable.com/");
    // 紹介サイトだけに書いた言語の選択を、送り先のホストへ持っていく（proxy.ts が共通 Domain に書く）。
    expect(at("https://notefable.com/app").carryLocale).toBe(true);
    expect(at("https://app.notefable.com/app").carryLocale).toBeUndefined();
  });

  it.each(["notefable_app", "notefable_device", "__Secure-authjs.session-token"])("sends a returning %s visitor from the site to the workspace host", (name) => {
    expect(where(at("https://notefable.com/", { cookies: { [name]: "1" } }))).toBe("redirect https://app.notefable.com/");
    expect(where(at("https://notefable.com/?intro", { language: "ja", cookies: { [name]: "1" } }))).toBe("rewrite /ja?intro");
  });

  it("keeps the note embed on the site for installed Android apps", () => {
    expect(where(at("https://notefable.com/note-embed?page=p1&lang=ja"))).toBe("rewrite /ja/note-embed?page=p1&lang=ja");
  });

  it("serves the workspace at / on the workspace host, unindexed, and marks the device as returning", () => {
    const result = at("https://app.notefable.com/?chat=c1", { language: "zh-TW" });
    expect(where(result)).toBe("rewrite /zh-Hant/app?chat=c1");
    expect(result.noindex).toBe(true);
    expect(result.hint).toBe(true);
    // 回訪者の Cookie があってもワークスペースのホストでは転送しない（ループしない）。
    expect(where(at("https://app.notefable.com/", { cookies: { notefable_app: "1" } }))).toBe("rewrite /en/app");
    expect(where(at("https://app.notefable.com/?intro"))).toBe("rewrite /en/app?intro");
  });

  it("folds /app on the workspace host into / (Stripe returns and old links)", () => {
    expect(where(at("https://app.notefable.com/app?billing=success"))).toBe("redirect https://app.notefable.com/?billing=success");
  });

  it("serves the note embed on the workspace host without marking the device", () => {
    const result = at("https://app.notefable.com/note-embed?page=p1");
    expect(where(result)).toBe("rewrite /en/note-embed?page=p1");
    expect(result.hint).toBe(false);
    expect(result.noindex).toBe(true);
  });

  it("sends shared conversation links to the workspace host from either host", () => {
    expect(where(at("https://app.notefable.com/c/chat-1?message=m1"))).toBe("redirect https://app.notefable.com/?chat=chat-1&message=m1");
    expect(where(at("https://notefable.com/c/chat-1"))).toBe("redirect https://app.notefable.com/?chat=chat-1");
  });

  it("sends a language-specific workspace on the site to the workspace host", () => {
    expect(where(at("https://notefable.com/ja/app?chat=c1"))).toBe("redirect https://app.notefable.com/?chat=c1");
    expect(at("https://app.notefable.com/ja/app").kind).toBe("none");
    expect(at("https://app.notefable.com/ja/app").noindex).toBe(true);
    expect(at("https://notefable.com/ja/app").carryLocale).toBe(true);
  });

  it("treats any other host (Preview, localhost) as a single host", () => {
    expect(where(at("https://notefable-git-x.vercel.app/app"))).toBe("rewrite /en/app");
    expect(where(at("https://notefable-git-x.vercel.app/", { cookies: { notefable_device: "x" } }))).toBe("redirect https://notefable-git-x.vercel.app/app");
  });
});
