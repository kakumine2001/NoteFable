import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("language dictionary endpoint", () => {
  it("resolves an explicit switch before the saved preference without setting a cookie", async () => {
    const response = GET(new NextRequest("https://example.test/api/i18n?preference=zh-Hant", {
      headers: { cookie: "studymate-locale=ja", "accept-language": "en" },
    }));
    const data = await response.json();
    expect(data.locale).toBe("zh-Hant");
    expect(data.messages["Language"]).toBe("語言");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.has("set-cookie")).toBe(false);
  });

  it("clears a manual preference for automatic selection using the same browser and country rules", async () => {
    const response = GET(new NextRequest("https://example.test/api/i18n?preference=auto", {
      headers: { cookie: "studymate-locale=zh", "accept-language": "fr", "x-vercel-ip-country": "JP" },
    }));
    expect((await response.json()).locale).toBe("ja");
  });

  it("uses the saved cookie when no switch is requested and sends only that dictionary", async () => {
    const response = GET(new NextRequest("https://example.test/api/i18n", {
      headers: { cookie: "studymate-locale=en", "accept-language": "zh-TW" },
    }));
    expect(await response.json()).toEqual({ locale: "en", messages: {} });
  });
});
