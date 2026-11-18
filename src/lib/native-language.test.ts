import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOCALE_DEFINITIONS } from "./i18n/locale";

const nativeRoot = "mobile/android/app/src/main/";
describe("enabled Web/native language data", () => {
  it("keeps app tags, native names and system language registration aligned", () => {
    const kotlin = readFileSync(nativeRoot + "java/com/kakumine/notefable/data/AppLanguage.kt", "utf8");
    const options = [...kotlin.matchAll(/^\s*(\w+)\("([^"]+)", "([^"]+)"\)/gm)];
    expect(options.map(([, , code, tag]) => ({ code, tag }))).toEqual(LOCALE_DEFINITIONS.map(({ code, tag }) => ({ code, tag })));
    for (const [, option, code] of options) {
      expect(kotlin).toContain(`Preference.${option} -> "${LOCALE_DEFINITIONS.find((entry) => entry.code === code)?.name}"`);
    }
    const xml = readFileSync(nativeRoot + "res/xml/locales_config.xml", "utf8");
    expect([...xml.matchAll(/android:name="([^"]+)"/g)].map(([, tag]) => tag)).toEqual(LOCALE_DEFINITIONS.map(({ tag }) => tag));
  });
});
