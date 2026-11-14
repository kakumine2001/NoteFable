import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NATIVE_ZH_HANT_DIR, nativeZhHantFiles, toTraditionalXml } from "../../scripts/native-zh-hant";

describe("native Traditional Chinese resources", () => {
  it("are up to date (regenerate with npx tsx scripts/gen-native-zh-hant.ts)", () => {
    const expected = nativeZhHantFiles();
    expect(readdirSync(NATIVE_ZH_HANT_DIR).filter((name) => name.endsWith(".xml")).sort()).toEqual([...expected.keys()]);
    for (const [name, content] of expected) {
      expect(readFileSync(path.join(NATIVE_ZH_HANT_DIR, name), "utf8").replace(/\r\n/g, "\n"), name).toBe(content);
    }
  });

  it("converts only text, keeps names and comments, and marks the UI locale as zh-Hant", () => {
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      "<resources>",
      "    <!-- 简体注释 -->",
      '    <string name="ui_locale" translatable="false">zh</string>',
      '    <string name="open_menu">打开侧边栏</string>',
      '    <string name="request_failed">请求失败：%1$s</string>',
      "</resources>",
      "",
    ].join("\n");
    const out = toTraditionalXml(xml);
    expect(out).toContain("<!-- 简体注释 -->");
    expect(out).toContain('<string name="ui_locale" translatable="false">zh-Hant</string>');
    expect(out).toContain('<string name="open_menu">開啟側邊欄</string>');
    expect(out).toContain('<string name="request_failed">請求失敗：%1$s</string>');
    expect(out.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<!--')).toBe(true);
  });
});
