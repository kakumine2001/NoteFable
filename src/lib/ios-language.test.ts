import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IOS_LPROJ } from "../../scripts/ios-strings";
import { NATIVE_EMOJI_ASSET } from "../../scripts/native-emoji";
import { LOCALE_DEFINITIONS } from "./i18n/locale";

const core = "mobile/ios/NoteFable/Core/";

describe("iOS language data", () => {
  it("keeps AppLanguage.swift aligned with the web locale registry and the lproj names", () => {
    const swift = readFileSync(core + "Text/AppLanguage.swift", "utf8");
    const rows = [...swift.matchAll(/^\s*\.(\w+): Definition\(code: "([^"]+)", tag: "([^"]+)", lproj: "([^"]+)", name: "([^"]+)"(, rtl: true)?\),$/gm)];
    expect(rows.map(([, , code, tag, lproj, name, rtl]) => ({ code, tag, lproj, name, dir: rtl ? "rtl" : "ltr" }))).toEqual(
      LOCALE_DEFINITIONS.map(({ code, tag, name, dir }) => ({ code, tag, lproj: IOS_LPROJ[code], name, dir })),
    );
    // 枚举的顺序就是语言菜单的顺序：auto 在前，后面和网页的语言表相同。
    const declaration = swift.slice(swift.indexOf("enum Preference"), swift.indexOf("var code: String"));
    const cases = [...declaration.matchAll(/^\s*case ([\w, ]+)$/gm)].flatMap(([, list]) => list.split(",").map((name) => name.trim()));
    expect(cases).toEqual(["auto", ...rows.map(([, option]) => option)]);
  });

  it("reads emoji keywords in the languages the shared emoji asset has", () => {
    const swift = readFileSync(core + "Support/EmojiCatalog.swift", "utf8");
    const declared = /emojiLocales: Set<String> = \[([^\]]+)\]/.exec(swift);
    expect(declared, "emojiLocales").not.toBeNull();
    const asset = JSON.parse(readFileSync(NATIVE_EMOJI_ASSET, "utf8")) as { emojis: { n: Record<string, string[]> }[] };
    expect([...declared![1].matchAll(/"([^"]+)"/g)].map(([, locale]) => locale).sort()).toEqual(Object.keys(asset.emojis[0].n).sort());
  });
});
