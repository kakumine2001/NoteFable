import { describe, expect, it } from "vitest";
import { localeFromAcceptLanguage, localeFromCountry, parsePreference, resolveLocale } from "./locale";

describe("display language selection", () => {
  it("uses an explicit choice before browser language or country", () => {
    expect(resolveLocale({ preference: "zh", acceptLanguage: "ja-JP,en;q=0.8", country: "US" })).toBe("zh");
    expect(resolveLocale({ preference: "en", acceptLanguage: "zh-CN", country: "JP" })).toBe("en");
  });

  it("uses the browser's highest-ranked supported language before country", () => {
    expect(resolveLocale({ preference: "auto", acceptLanguage: "zh-Hant-TW,ja;q=0.8", country: "JP" })).toBe("zh");
    expect(localeFromAcceptLanguage("fr, en;q=0.4,ja-JP;q=0.9,zh;q=0.8")).toBe("ja");
    expect(localeFromAcceptLanguage("en;q=0.5,ja;q=0.5")).toBe("en");
    expect(localeFromAcceptLanguage("EN_gb")).toBe("en");
  });

  it("ignores wildcard, disabled, invalid, or out-of-range language weights", () => {
    expect(localeFromAcceptLanguage("*,ja;q=0,zh;q=no,en;q=2")).toBeNull();
    expect(localeFromAcceptLanguage("en;q=-1,zh;q=0.8")).toBe("zh");
    expect(localeFromAcceptLanguage(null)).toBeNull();
  });

  it.each(["CN", "TW", "HK", "MO", "SG"])("falls back to Chinese in %s", (country) => {
    expect(resolveLocale({ preference: "auto", acceptLanguage: "fr-FR", country })).toBe("zh");
  });

  it("uses Japan, then English as remaining fallbacks", () => {
    expect(resolveLocale({ preference: "auto", country: "jp" })).toBe("ja");
    expect(resolveLocale({ preference: "auto", country: "US" })).toBe("en");
    expect(resolveLocale({ preference: "auto" })).toBe("en");
    expect(localeFromCountry("  jp ")).toBe("ja");
    expect(localeFromCountry(null)).toBeNull();
  });

  it.each([undefined, null, "auto", "de", "constructor", "zh-CN", ""])("treats invalid cookie %s as automatic", (value) => {
    expect(parsePreference(value)).toBe("auto");
  });
});
