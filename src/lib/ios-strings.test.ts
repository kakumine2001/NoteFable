import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  androidStringValue,
  escapeStringsValue,
  existingIosStringsPaths,
  formatSpecs,
  INFO_PLIST_STRINGS,
  iosInfoPlistStringsPath,
  IOS_LPROJ,
  IOS_ONLY_STRINGS,
  iosStringsFiles,
  iosStringsPath,
  parseAndroidStringsXml,
} from "../../scripts/ios-strings";
import { LOCALES } from "./i18n/locale";

// .strings 的读法（和生成脚本的写法分开实现）：注释、"键" = "值";，值里只认 \\ \" \n \t \r。
function parseStringsFile(text: string, label: string): Map<string, string> {
  const entries = new Map<string, string>();
  let at = 0;
  const skip = () => {
    for (;;) {
      while (at < text.length && /\s/.test(text[at])) at++;
      if (!text.startsWith("/*", at)) return;
      const end = text.indexOf("*/", at + 2);
      if (end < 0) throw new Error(`${label}: unterminated comment`);
      at = end + 2;
    }
  };
  const quoted = () => {
    if (text[at] !== '"') throw new Error(`${label}: expected a quoted string at ${at}`);
    let out = "";
    for (at++; text[at] !== '"'; at++) {
      if (at >= text.length) throw new Error(`${label}: unterminated string`);
      if (text[at] !== "\\") {
        out += text[at];
        continue;
      }
      const escaped = { "\\": "\\", '"': '"', n: "\n", t: "\t", r: "\r" }[text[++at]];
      if (escaped === undefined) throw new Error(`${label}: unknown escape \\${text[at]}`);
      out += escaped;
    }
    at++;
    return out;
  };
  const expectChar = (char: string) => {
    skip();
    if (text[at] !== char) throw new Error(`${label}: expected ${char} at ${at}`);
    at++;
    skip();
  };
  for (skip(); at < text.length; skip()) {
    const key = quoted();
    expectChar("=");
    const value = quoted();
    expectChar(";");
    if (entries.has(key)) throw new Error(`${label}: duplicate key ${key}`);
    entries.set(key, value);
  }
  return entries;
}

const read = (file: string) => readFileSync(file, "utf8");

describe("iOS .strings files", { timeout: 60_000 }, () => {
  it("are up to date (regenerate with npx tsx scripts/gen-ios-strings.ts)", () => {
    const expected = iosStringsFiles();
    expect(existingIosStringsPaths()).toEqual([...expected.keys()].sort());
    for (const [file, content] of expected) {
      const actual = read(file);
      expect(actual.includes("\r"), `${file}: must use LF line endings`).toBe(false);
      expect(actual, file).toBe(content);
    }
  });

  it("have the same keys and placeholders in all 17 languages, and ui_locale is the web locale code", () => {
    expect(LOCALES.length).toBe(17);
    const english = parseStringsFile(read(iosStringsPath("en")), "en");
    expect(english.size).toBeGreaterThan(400);
    for (const locale of LOCALES) {
      const label = `${IOS_LPROJ[locale]}.lproj`;
      const strings = parseStringsFile(read(iosStringsPath(locale)), label);
      expect([...strings.keys()], `${label} keys`).toEqual([...english.keys()]);
      expect(strings.get("ui_locale"), `${label} ui_locale`).toBe(locale);
      for (const [key, value] of strings) {
        expect(value.length, `${label}:${key} is empty`).toBeGreaterThan(0);
        expect(formatSpecs(value, `${label}:${key}`).sort(), `${label}:${key} placeholders`).toEqual(formatSpecs(english.get(key)!).sort());
      }
    }
  });

  it("lists the same languages as Info.plist (CFBundleLocalizations)", () => {
    const plist = read("mobile/ios/Support/Info.plist");
    const block = /<key>CFBundleLocalizations<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(plist);
    expect(block, "CFBundleLocalizations").not.toBeNull();
    expect([...block![1].matchAll(/<string>([^<]+)<\/string>/g)].map((match) => match[1])).toEqual(LOCALES.map((locale) => IOS_LPROJ[locale]));
  });

  it("localizes every permission prompt of Info.plist in all 17 languages", () => {
    const plist = read("mobile/ios/Support/Info.plist");
    const prompts = new Map([...plist.matchAll(/<key>(NS\w+UsageDescription)<\/key>\s*<string>([^<]+)<\/string>/g)].map((match) => [match[1], match[2]]));
    expect([...prompts.keys()].sort()).toEqual(["NSCameraUsageDescription", "NSMicrophoneUsageDescription", "NSPhotoLibraryAddUsageDescription"]);
    expect(Object.keys(INFO_PLIST_STRINGS).sort()).toEqual([...prompts.keys()].sort());
    for (const locale of LOCALES) {
      const strings = parseStringsFile(read(iosInfoPlistStringsPath(locale)), `${IOS_LPROJ[locale]}.lproj/InfoPlist`);
      expect([...strings.keys()].sort(), locale).toEqual([...prompts.keys()].sort());
      for (const [key, value] of strings) {
        expect(value, `${locale}:${key}`).toBe(INFO_PLIST_STRINGS[key][locale]);
        if (locale === "en") expect(value, key).toBe(prompts.get(key));
        else expect(value, `${locale}:${key}`).not.toBe(prompts.get(key));
      }
    }
  });

  it("carries the Android text over without its XML and Android escapes", () => {
    const english = parseStringsFile(read(iosStringsPath("en")), "en");
    const french = parseStringsFile(read(iosStringsPath("fr")), "fr");
    // \? 和 “ ”
    expect(english.get("sb_delete_name_q")).toBe("Delete “%1$s”?");
    // "…" 包裹的值保留结尾的空格；法语的窄空格原样保留。
    expect(english.get("search_speaker_you")).toBe("You: ");
    expect(french.get("search_speaker_you")).toBe("Vous : ");
    // %% 和占位符照 Android 的写法留着，由 L10n.format 处理。
    expect(english.get("upload_progress")).toBe("Uploading %1$d/%2$d · %3$s · %4$d%%");
    // &amp;
    expect(english.get("em_cat_smileys_people")).toBe("Smileys & people");
    // translatable="false" 的条目每种语言都有（lproj 之间不回退）。
    expect(french.get("plan_pro")).toBe("Pro");
    // \' → '
    const turkish = parseStringsFile(read(iosStringsPath("tr")), "tr");
    expect(turkish.get("move_to_trash")).toBe("Çöp Kutusu'na taşı");
    for (const strings of [english, french, turkish]) {
      for (const [key, value] of strings) expect(value.includes("\\"), key).toBe(false);
    }
  });

  it("adds the iOS-only strings in every language", () => {
    expect(Object.keys(IOS_ONLY_STRINGS).length).toBeGreaterThan(0);
    for (const locale of LOCALES) {
      const strings = parseStringsFile(read(iosStringsPath(locale)), IOS_LPROJ[locale]);
      for (const [key, values] of Object.entries(IOS_ONLY_STRINGS)) {
        expect(Object.keys(values).sort(), key).toEqual([...LOCALES].sort());
        expect(strings.get(key), `${locale}:${key}`).toBe(values[locale]);
      }
    }
  });

  it("reads Android string values like aapt2", () => {
    const value = (raw: string) => androidStringValue(raw, "test");
    expect(value("Don\\'t &amp; &lt;b&gt; \\\"x\\\" \\\\ \\@ \\?")).toBe("Don't & <b> \"x\" \\ @ ?");
    expect(value("a\\nb\\tc\\u00e9")).toBe("a\nb\tcé");
    expect(value("  two\n    lines  ")).toBe("two lines");
    expect(value('"  kept  "')).toBe("  kept  ");
    expect(value('"it\'s"')).toBe("it's");
    expect(value("a&#8230;&#x2026;")).toBe("a……");
    expect(value("100%% of %1$s")).toBe("100%% of %1$s");
    for (const bad of ["it's", "a\\xb", "trailing\\", "<b>x</b>", "a & b", "&nbsp;", '"open', "@string/x", "?attr/x", "\\u12"]) {
      expect(() => value(bad), bad).toThrow();
    }
  });

  it("accepts only positional %n$s / %n$d placeholders and %%", () => {
    expect(formatSpecs("%2$s then %1$d, 40%%")).toEqual(["%2$s", "%1$d"]);
    expect(formatSpecs("Up to 100% bigger")).toEqual([]);
    expect(formatSpecs("50%")).toEqual([]);
    for (const bad of ["%s", "%d items", "%1$s is 50% done", "%.1f", "%1$f"]) {
      expect(() => formatSpecs(bad), bad).toThrow();
    }
  });

  it("escapes .strings values and rejects what the format cannot hold", () => {
    expect(escapeStringsValue('a "b" \\ c\nd\te', "test")).toBe('a \\"b\\" \\\\ c\\nd\\te');
    expect(parseStringsFile('/* c */\n"k" = "a \\"b\\" \\\\ c\\nd\\te";\n', "test").get("k")).toBe('a "b" \\ c\nd\te');
    expect(() => escapeStringsValue("a\u0001b", "test")).toThrow();
    expect(() => escapeStringsValue("a\ud83db", "test")).toThrow();
  });

  it("fails loudly on Android resources it does not understand", () => {
    const xml = (body: string) => `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${body}\n</resources>\n`;
    expect(parseAndroidStringsXml(xml('<!-- c -->\n<string name="a">A</string>\n<string name="b" translatable="false">B</string>'), "test")).toEqual([
      { name: "a", raw: "A", translatable: true },
      { name: "b", raw: "B", translatable: false },
    ]);
    for (const bad of [
      '<plurals name="n"><item quantity="one">1</item></plurals>',
      '<string-array name="a"><item>x</item></string-array>',
      '<string name="a">A</string><string name="a">B</string>',
      '<string name="a" formatted="false">A</string>',
      "<string>A</string>",
    ]) {
      expect(() => parseAndroidStringsXml(xml(bad), "test"), bad).toThrow();
    }
  });
});
