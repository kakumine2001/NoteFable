import { describe, expect, it } from "vitest";
import {
  LOCALE_DEFINITIONS,
  LOCALE_DIRS,
  LOCALES,
  localeDir,
  localeFromAcceptLanguage,
  localeFromCountry,
  parsePreference,
  resolveLocale,
} from "./locale";

describe("display language selection", () => {
  it("registers all 17 locales in canonical menu order", () => {
    expect(LOCALES).toEqual([
      "en", "zh", "zh-Hant", "ja",
      "ko", "es", "fr", "de", "pt-BR", "it",
      "id", "vi", "th", "hi", "ar", "tr", "ru",
    ]);
    expect(LOCALE_DEFINITIONS).toHaveLength(17);
  });

  it("marks Arabic as RTL and all other 16 locales as LTR", () => {
    expect(localeDir("ar")).toBe("rtl");
    for (const locale of LOCALES) {
      expect(LOCALE_DIRS[locale]).toBe(locale === "ar" ? "rtl" : "ltr");
    }
  });

  it("uses an explicit choice before browser language or country", () => {
    expect(resolveLocale({ preference: "zh", acceptLanguage: "ja-JP,en;q=0.8", country: "US" })).toBe("zh");
    expect(resolveLocale({ preference: "en", acceptLanguage: "zh-CN", country: "JP" })).toBe("en");
    expect(resolveLocale({ preference: "ar", acceptLanguage: "fr-FR", country: "FR" })).toBe("ar");
    expect(resolveLocale({ preference: "pt-BR", acceptLanguage: "es-ES", country: "ES" })).toBe("pt-BR");
  });

  it("uses the browser's highest-ranked supported language before country", () => {
    expect(resolveLocale({ preference: "auto", acceptLanguage: "zh-Hant-TW,ja;q=0.8", country: "JP" })).toBe("zh-Hant");
    expect(localeFromAcceptLanguage("nl, en;q=0.4,ja-JP;q=0.9,zh;q=0.8")).toBe("ja");
    expect(localeFromAcceptLanguage("fr, en;q=0.4,ja-JP;q=0.9,zh;q=0.8")).toBe("fr");
    expect(localeFromAcceptLanguage("en;q=0.5,ja;q=0.5")).toBe("en");
    expect(localeFromAcceptLanguage("EN_gb")).toBe("en");
  });

  it("ignores wildcard, disabled, invalid, or out-of-range language weights", () => {
    expect(localeFromAcceptLanguage("*,ja;q=0,zh;q=no,en;q=2")).toBeNull();
    expect(localeFromAcceptLanguage("en;q=-1,zh;q=0.8")).toBe("zh");
    expect(localeFromAcceptLanguage(null)).toBeNull();
  });

  it.each([
    ["CN", "zh"],
    ["SG", "zh"],
    ["TW", "zh-Hant"],
    ["HK", "zh-Hant"],
    ["MO", "zh-Hant"],
    ["JP", "ja"],
    ["KR", "ko"],
    ["ES", "es"],
    ["MX", "es"],
    ["AR", "es"],
    ["FR", "fr"],
    ["DE", "de"],
    ["AT", "de"],
    ["BR", "pt-BR"],
    ["IT", "it"],
    ["ID", "id"],
    ["VN", "vi"],
    ["TH", "th"],
    ["SA", "ar"],
    ["EG", "ar"],
    ["AE", "ar"],
    ["TR", "tr"],
    ["RU", "ru"],
    ["US", "en"],
    ["GB", "en"],
    ["AU", "en"],
    ["NZ", "en"],
    ["IE", "en"],
  ] as const)("falls back to %s -> %s when Accept-Language has no supported language", (country, expected) => {
    expect(resolveLocale({ preference: "auto", acceptLanguage: "nl-NL", country })).toBe(expected);
  });

  it.each(["CA", "CH", "BE", "IN", "NL", "SE"])("does not force a regional language for multilingual or unmapped country %s", (country) => {
    expect(localeFromCountry(country)).toBeNull();
    expect(resolveLocale({ preference: "auto", acceptLanguage: "nl-NL", country })).toBe("en");
  });

  it.each([
    ["zh-TW", "zh-Hant"],
    ["zh-HK", "zh-Hant"],
    ["zh-Hant", "zh-Hant"],
    ["zh-Hans-HK", "zh"],
    ["zh-CN", "zh"],
    ["zh-SG", "zh"],
    ["zh", "zh"],
    ["ko-KR", "ko"],
    ["es-MX", "es"],
    ["es-419", "es"],
    ["fr-CA", "fr"],
    ["de-CH", "de"],
    ["pt-BR", "pt-BR"],
    ["pt-PT", "pt-BR"],
    ["it-IT", "it"],
    ["id-ID", "id"],
    ["in-ID", "id"],
    ["vi-VN", "vi"],
    ["th-TH", "th"],
    ["hi-IN", "hi"],
    ["ar-SA", "ar"],
    ["ar-EG", "ar"],
    ["tr-TR", "tr"],
    ["ru-RU", "ru"],
  ] as const)("reads %s as %s", (tag, locale) => {
    expect(localeFromAcceptLanguage(tag)).toBe(locale);
  });

  it("handles case, whitespace, and empty fallbacks cleanly", () => {
    expect(resolveLocale({ preference: "auto", country: "jp" })).toBe("ja");
    expect(resolveLocale({ preference: "auto", country: "US" })).toBe("en");
    expect(resolveLocale({ preference: "auto" })).toBe("en");
    expect(localeFromCountry("  jp ")).toBe("ja");
    expect(localeFromCountry(null)).toBeNull();
  });

  it.each([undefined, null, "auto", "nl", "constructor", "zh-CN", "zh-hant", "pt-br", "in", ""])("treats invalid cookie %s as automatic", (value) => {
    expect(parsePreference(value)).toBe("auto");
  });

  it.each(LOCALES)("parses valid manual preference %s", (locale) => {
    expect(parsePreference(locale)).toBe(locale);
  });
});

describe("BCP 47 normalization and strict negotiation", () => {
  it.each(["nl-NL", "sv-SE", "pl-PL", "he-IL", "fa-IR", "uk-UA"])("ignores unsupported language %s and continues negotiation", (tag) => {
    expect(localeFromAcceptLanguage(`${tag},ja;q=0.8`)).toBe("ja");
    expect(resolveLocale({ preference: "auto", acceptLanguage: tag, country: "HK" })).toBe("zh-Hant");
    expect(resolveLocale({ preference: "auto", acceptLanguage: tag })).toBe("en");
  });

  it.each(["en-!", "zh--HK", "ja-", "*", "en-US-INVALID-INVALID", "x-private", "unknown", "en-123456789"])("rejects invalid or unknown tag %s", (tag) => {
    expect(localeFromAcceptLanguage(tag)).toBeNull();
  });

  it.each(["", " ", "NaN", "Infinity", "0x1", "1e0", "+1", "-1", "1.001", "0.1234", ".8", "2"])("ignores invalid weight %j", (weight) => {
    expect(localeFromAcceptLanguage(`zh;q=${weight},ja;q=0.4`)).toBe("ja");
  });

  it("honors equal-weight order, case, whitespace and explicit exclusions", () => {
    expect(localeFromAcceptLanguage("ja;Q=0.5, zh;q=0.500,en;q=0")).toBe("ja");
    expect(localeFromAcceptLanguage("zh;q=0.500,ja;q=0.5")).toBe("zh");
    expect(localeFromAcceptLanguage("en;q=0;q=1,ja;q=0.2")).toBe("ja");
    expect(localeFromAcceptLanguage("en;q=0.8;other=x,zh-HK;q=0.2")).toBe("zh-Hant");
  });

  it("handles ISO 639-2/3 aliases, legacy Indonesian 'in', script precedence and valid extensions", () => {
    expect(localeFromAcceptLanguage("cmn-Hant-HK")).toBe("zh-Hant");
    expect(localeFromAcceptLanguage("eng-GB")).toBe("en");
    expect(localeFromAcceptLanguage("jpn-JP")).toBe("ja");
    expect(localeFromAcceptLanguage("kor-KR")).toBe("ko");
    expect(localeFromAcceptLanguage("spa-MX")).toBe("es");
    expect(localeFromAcceptLanguage("fra-FR")).toBe("fr");
    expect(localeFromAcceptLanguage("fre-FR")).toBe("fr");
    expect(localeFromAcceptLanguage("deu-DE")).toBe("de");
    expect(localeFromAcceptLanguage("ger-DE")).toBe("de");
    expect(localeFromAcceptLanguage("por-BR")).toBe("pt-BR");
    expect(localeFromAcceptLanguage("ita-IT")).toBe("it");
    expect(localeFromAcceptLanguage("ind-ID")).toBe("id");
    expect(localeFromAcceptLanguage("in_ID")).toBe("id");
    expect(localeFromAcceptLanguage("vie-VN")).toBe("vi");
    expect(localeFromAcceptLanguage("tha-TH")).toBe("th");
    expect(localeFromAcceptLanguage("hin-IN")).toBe("hi");
    expect(localeFromAcceptLanguage("ara-SA")).toBe("ar");
    expect(localeFromAcceptLanguage("tur-TR")).toBe("tr");
    expect(localeFromAcceptLanguage("rus-RU")).toBe("ru");
    expect(localeFromAcceptLanguage("zh_Hans_HK")).toBe("zh");
    expect(localeFromAcceptLanguage("zh-Hant-CN-u-nu-hanidec")).toBe("zh-Hant");
  });

  it("restores environment detection only in Auto and never overrides manual choices", () => {
    expect(resolveLocale({ preference: "ja", acceptLanguage: "en", country: "CN" })).toBe("ja");
    expect(resolveLocale({ preference: "auto", acceptLanguage: "en", country: "CN" })).toBe("en");
    expect(resolveLocale({ preference: "auto", acceptLanguage: "nl-NL", country: "CN" })).toBe("zh");
    expect(localeFromCountry("constructor")).toBeNull();
  });
});
