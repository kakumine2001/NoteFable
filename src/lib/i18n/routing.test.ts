import { describe, expect, it } from "vitest";
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
    const [{ config }, { LOCALIZED_PATHS }] = await Promise.all([import("@/proxy"), import("./routing")]);
    expect(config.matcher).toEqual([...LOCALIZED_PATHS]);
  });

  it("leaves other paths alone", () => {
    expect(route("/note-embed/x").kind).toBe("none");
    expect(route("/ja/note-embed").kind).toBe("none");
    expect(route("/privacy").kind).toBe("none");
    expect(route("/ja").kind).toBe("none");
  });
});
