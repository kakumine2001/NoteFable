import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("language dictionary endpoint", () => {
  it("resolves an explicit switch before the saved preference without setting a cookie", async () => {
    const response = GET(new NextRequest("https://example.test/api/i18n?preference=zh-Hant", {
      headers: { cookie: "notefable-locale=ja", "accept-language": "en" },
    }));
    const data = await response.json();
    expect(data.locale).toBe("zh-Hant");
    expect(data.messages["Language"]).toBe("語言");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.has("set-cookie")).toBe(false);
  });

  it("clears a manual preference for automatic selection using the same browser and country rules", async () => {
    const response = GET(new NextRequest("https://example.test/api/i18n?preference=auto", {
      headers: { cookie: "notefable-locale=zh", "accept-language": "nl", "x-vercel-ip-country": "JP" },
    }));
    expect((await response.json()).locale).toBe("ja");
  });

  it("uses the saved cookie when no switch is requested and sends only that dictionary", async () => {
    const response = GET(new NextRequest("https://example.test/api/i18n", {
      headers: { cookie: "notefable-locale=en", "accept-language": "zh-TW" },
    }));
    expect(await response.json()).toEqual({ locale: "en", messages: {} });
  });

  it.each([
    ["ko", "ko-KR"],
    ["pt-BR", "pt-BR"],
    ["ar", "ar-SA"],
    ["id", "in-ID"],
  ] as const)("serves full dictionary for newly enabled locale %s (%s)", async (expected, header) => {
    const response = GET(new NextRequest("https://example.test/api/i18n?preference=auto", {
      headers: { "accept-language": header },
    }));
    const data = await response.json();
    expect(data.locale).toBe(expected);
    expect(data.messages["Settings"]).toBeTruthy();
    expect(data.messages["Auto detect"]).toBeTruthy();
  });
});

function request(query: string, language?: string, country?: string) {
  return new NextRequest(`http://localhost/api/i18n${query}`, { headers: {
    cookie: "notefable-locale=ja", ...(language ? { "accept-language": language } : {}), ...(country ? { "x-vercel-ip-country": country } : {}),
  } });
}

describe("language dictionaries and native Auto resolution", () => {
  it("uses the explicit cookie until Auto is requested", async () => {
    expect((await GET(request("", "zh-HK", "JP")).json()).locale).toBe("ja");
    const response = GET(request("?preference=auto", "zh-HK", "JP"));
    const data = await response.json();
    expect(data.locale).toBe("zh-Hant");
    expect(data.messages["Auto detect"]).toBeTruthy();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns only an inferred locale to native without changing any preference", async () => {
    const response = GET(request("?preference=auto&format=locale", "nl-NL,sv-SE;q=0.8", "JP"));
    expect(await response.json()).toEqual({ locale: "ja" });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("honors matching languages before country and falls back to English", async () => {
    expect(await GET(request("?preference=auto&format=locale", "pt-BR,zh-HK;q=0.4", "JP")).json()).toEqual({ locale: "pt-BR" });
    expect(await GET(request("?preference=auto&format=locale", "nl-NL,zh-HK;q=0.4", "JP")).json()).toEqual({ locale: "zh-Hant" });
    expect(await GET(request("?preference=auto&format=locale", "nl-NL,en;q=0", "ZZ")).json()).toEqual({ locale: "en" });
  });
});
