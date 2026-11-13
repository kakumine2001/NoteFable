import { describe, expect, it } from "vitest";
import { routeLocalizedRequest } from "./routing";

function route(path: string, { cookie, language, country }: { cookie?: string; language?: string; country?: string } = {}) {
  return routeLocalizedRequest({
    url: `https://example.test${path}`,
    cookie: (name) => (name === "studymate-locale" ? cookie : undefined),
    header: (name) => (name === "accept-language" ? language ?? null : name === "x-vercel-ip-country" ? country ?? null : null),
  });
}

const target = (result: ReturnType<typeof route>) => (result.kind === "none" ? null : `${result.kind} ${result.url.pathname}${result.url.search}`);

describe("localized routing", () => {
  it("serves / and /app from the static page for the chosen language", () => {
    expect(target(route("/", { language: "ja-JP" }))).toBe("rewrite /ja");
    expect(target(route("/app", { language: "zh-TW" }))).toBe("rewrite /zh-Hant/app");
    expect(target(route("/app?view=pages&page=x", { cookie: "zh", language: "ja" }))).toBe("rewrite /zh/app?view=pages&page=x");
    expect(target(route("/", { country: "JP" }))).toBe("rewrite /ja");
    expect(target(route("/"))).toBe("rewrite /en");
  });

  it("keeps campaign links on the introduction", () => {
    expect(target(route("/?utm_source=bookmark", { language: "en" }))).toBe("rewrite /en?utm_source=bookmark");
  });

  it.each(["chat", "message", "view", "page"])("sends legacy %s links to the workspace", (key) => {
    expect(target(route(`/?${key}=existing-id`))).toBe(`redirect /app?${key}=existing-id`);
  });

  it("preserves every legacy parameter, repeated values and Unicode", () => {
    expect(target(route("/?chat=chat-id&message=message-id&extra=%E4%B8%AD%E6%96%87&extra=a%26b")))
      .toBe("redirect /app?chat=chat-id&message=message-id&extra=%E4%B8%AD%E6%96%87&extra=a%26b");
    expect(target(route("/?chat="))).toBe("redirect /app?chat=");
  });

  it("leaves other paths alone", () => {
    expect(route("/privacy").kind).toBe("none");
    expect(route("/ja").kind).toBe("none");
  });
});
