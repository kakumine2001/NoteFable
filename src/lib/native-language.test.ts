import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultStringXmlFileNames,
  GENERATED_NATIVE_LOCALES,
  NATIVE_DEFAULT_VALUES_DIR,
  NATIVE_LOCALE_RES_DIRS,
  NATIVE_RES_DIR,
  nativeLocaleStringFiles,
} from "../../scripts/native-strings";
import { LOCALE_DEFINITIONS, LOCALES } from "./i18n/locale";

const nativeRoot = "mobile/android/app/src/main/";

function extractSpecs(raw: string): string[] {
  return [...raw.matchAll(/%\d+\$[sd]/g)].map((m) => m[0]).sort();
}

function parseXmlStrings(xml: string, fileLabel: string): Map<string, { attrs: string; raw: string }> {
  expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>'), `${fileLabel}: missing XML declaration`).toBe(true);
  // Strip comments and check well-formedness of <resources> and <string> elements.
  const withoutComments = xml.replace(/<!--[\s\S]*?-->/g, "");
  expect(withoutComments, `${fileLabel}: missing <resources> wrapper`).toMatch(/^\s*<\?xml[^>]*\?>\s*<resources>[\s\S]*<\/resources>\s*$/);

  const entries = new Map<string, { attrs: string; raw: string }>();
  const tagRegex = /<string\s+name="([^"]+)"([^>]*)>([\s\S]*?)<\/string>/g;
  const remainder = withoutComments
    .replace(/^\s*<\?xml[^>]*\?>\s*<resources>/, "")
    .replace(/<\/resources>\s*$/, "")
    .replace(tagRegex, (_, name: string, attrs: string, raw: string) => {
      expect(entries.has(name), `${fileLabel}: duplicate string ${name}`).toBe(false);
      // No unescaped '<' or bare '&' inside string value.
      expect(raw, `${fileLabel}:${name} contains raw '<'`).not.toContain("<");
      expect(raw.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, ""), `${fileLabel}:${name} contains bare '&'`).not.toContain("&");
      // Outside "..." wrappers, ASCII apostrophe must be escaped as \'.
      if (!(raw.startsWith('"') && raw.endsWith('"'))) {
        const unescapedQuote = /(^|[^\\])'/.test(raw);
        expect(unescapedQuote, `${fileLabel}:${name} has unescaped ASCII apostrophe`).toBe(false);
      }
      entries.set(name, { attrs, raw });
      return "";
    });
  expect(remainder.trim(), `${fileLabel}: unexpected trailing XML content`).toBe("");
  return entries;
}

describe("enabled Web/native language data", { timeout: 60_000 }, () => {
  it("keeps app tags, native names and system language registration aligned across all 17 locales", () => {
    const kotlin = readFileSync(nativeRoot + "java/com/kakumine/notefable/data/AppLanguage.kt", "utf8");
    const options = [...kotlin.matchAll(/^\s*(\w+)\("([^"]+)", "([^"]+)"\)/gm)];
    expect(options.map(([, , code, tag]) => ({ code, tag }))).toEqual(LOCALE_DEFINITIONS.map(({ code, tag }) => ({ code, tag })));
    for (const [, option, code] of options) {
      expect(kotlin).toContain(`Preference.${option} -> "${LOCALE_DEFINITIONS.find((entry) => entry.code === code)?.name}"`);
    }
    const xml = readFileSync(nativeRoot + "res/xml/locales_config.xml", "utf8");
    expect([...xml.matchAll(/android:name="([^"]+)"/g)].map(([, tag]) => tag)).toEqual(LOCALE_DEFINITIONS.map(({ tag }) => tag));
  });

  it("keeps generated Android string resources up to date (regenerate with npx tsx scripts/gen-native-strings.ts)", () => {
    for (const locale of GENERATED_NATIVE_LOCALES) {
      const dir = path.join(NATIVE_RES_DIR, NATIVE_LOCALE_RES_DIRS[locale]);
      expect(existsSync(dir), `${locale}: ${dir}`).toBe(true);
      const expected = nativeLocaleStringFiles(locale);
      expect(readdirSync(dir).filter((name) => name.endsWith(".xml")).sort(), locale).toEqual([...expected.keys()]);
      for (const [name, content] of expected) {
        expect(readFileSync(path.join(dir, name), "utf8").replace(/\r\n/g, "\n"), `${locale}/${name}`).toBe(content);
      }
    }
  });

  it("validates XML well-formedness, key completeness, format specifiers, and ui_locale across all 17 Android values directories", () => {
    const fileNames = defaultStringXmlFileNames();
    expect(fileNames.length).toBe(16);

    const defaultByFile = new Map(
      fileNames.map((fileName) => [
        fileName,
        parseXmlStrings(readFileSync(path.join(NATIVE_DEFAULT_VALUES_DIR, fileName), "utf8"), `values/${fileName}`),
      ]),
    );

    for (const locale of LOCALES) {
      const resSubdir = NATIVE_LOCALE_RES_DIRS[locale];
      const dir = path.join(NATIVE_RES_DIR, resSubdir);
      expect(existsSync(dir), `missing resource dir ${resSubdir}`).toBe(true);

      for (const fileName of fileNames) {
        const filePath = path.join(dir, fileName);
        expect(existsSync(filePath), `missing ${resSubdir}/${fileName}`).toBe(true);
        const parsed = parseXmlStrings(readFileSync(filePath, "utf8"), `${resSubdir}/${fileName}`);
        const base = defaultByFile.get(fileName)!;

        if (locale === "en") continue;

        const expectedNames = [...base.entries()]
          .filter(([, entry]) => !/\btranslatable\s*=\s*"false"/.test(entry.attrs))
          .map(([name]) => name);
        expect([...parsed.keys()], `${resSubdir}/${fileName} keys`).toEqual(expectedNames);

        for (const name of expectedNames) {
          const targetEntry = parsed.get(name)!;
          const baseEntry = base.get(name)!;
          expect(targetEntry.raw.length, `${resSubdir}/${fileName}:${name} empty`).toBeGreaterThan(0);
          if (name === "ui_locale") {
            expect(targetEntry.raw, `${resSubdir}: ui_locale`).toBe(locale);
          }
          expect(extractSpecs(targetEntry.raw), `${resSubdir}/${fileName}:${name} format specs`).toEqual(extractSpecs(baseEntry.raw));
        }
      }
    }
  });
});
