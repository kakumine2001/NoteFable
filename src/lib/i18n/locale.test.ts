import { describe, expect, it } from "vitest";
import { localeFromAcceptLanguage, localeFromCountry, parsePreference, resolveLocale } from "./locale";

describe("display language selection", () => {
  it("uses an explicit choice before browser language or country", () => {
    expect(resolveLocale({ preference: "zh", acceptLanguage: "ja-JP,en;q=0.8", country: "US" })).toBe("zh");
    expect(resolveLocale({ preference: "en", acceptLanguage: "zh-CN", country: "JP" })).toBe("en");
  });

  it("uses the browser's highest-ranked supported language before country", () => {
    expect(resolveLocale({ preference: "auto", acceptLanguage: "zh-Hant-TW,ja;q=0.8", country: "JP" })).toBe("zh-Hant");
    expect(localeFromAcceptLanguage("fr, en;q=0.4,ja-JP;q=0.9,zh;q=0.8")).toBe("ja");
    expect(localeFromAcceptLanguage("en;q=0.5,ja;q=0.5")).toBe("en");
    expect(localeFromAcceptLanguage("EN_gb")).toBe("en");
  });

  it("ignores wildcard, disabled, invalid, or out-of-range language weights", () => {
    expect(localeFromAcceptLanguage("*,ja;q=0,zh;q=no,en;q=2")).toBeNull();
    expect(localeFromAcceptLanguage("en;q=-1,zh;q=0.8")).toBe("zh");
    expect(localeFromAcceptLanguage(null)).toBeNull();
  });

  it.each(["CN", "SG"])("falls back to Simplified Chinese in %s", (country) => {
    expect(resolveLocale({ preference: "auto", acceptLanguage: "fr-FR", country })).toBe("zh");
  });

  it.each(["TW", "HK", "MO"])("falls back to Traditional Chinese in %s", (country) => {
    expect(resolveLocale({ preference: "auto", acceptLanguage: "fr-FR", country })).toBe("zh-Hant");
  });

  it.each([["zh-TW", "zh-Hant"], ["zh-HK", "zh-Hant"], ["zh-Hant", "zh-Hant"], ["zh-Hans-HK", "zh"], ["zh-CN", "zh"], ["zh-SG", "zh"], ["zh", "zh"]])("reads %s as %s", (tag, locale) => {
    expect(localeFromAcceptLanguage(tag)).toBe(locale);
  });

  it("uses Japan, then English as remaining fallbacks", () => {
    expect(resolveLocale({ preference: "auto", country: "jp" })).toBe("ja");
    expect(resolveLocale({ preference: "auto", country: "US" })).toBe("en");
    expect(resolveLocale({ preference: "auto" })).toBe("en");
    expect(localeFromCountry("  jp ")).toBe("ja");
    expect(localeFromCountry(null)).toBeNull();
  });

  it.each([undefined, null, "auto", "de", "constructor", "zh-CN", "zh-hant", ""])("treats invalid cookie %s as automatic", (value) => {
    expect(parsePreference(value)).toBe("auto");
  });
});
