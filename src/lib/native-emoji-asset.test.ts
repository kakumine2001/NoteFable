import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATEGORIES, NATIVE_EMOJI_ASSET, nativeEmojiData, nativeEmojiJson } from "../../scripts/native-emoji";

describe("native emoji asset", { timeout: 60_000 }, () => {
  it("is up to date (regenerate with npx tsx scripts/gen-native-emoji.ts)", async () => {
    expect(readFileSync(NATIVE_EMOJI_ASSET, "utf8").replace(/\r\n/g, "\n")).toBe(await nativeEmojiJson());
  });

  it("keeps the web picker's categories, keywords in every supported emoji dataset language, and the category icons", async () => {
    const data = await nativeEmojiData();
    expect(data.categories).toEqual([...CATEGORIES]);
    const grinning = data.emojis.find((emoji) => emoji.u === "1f600");
    expect(grinning?.c).toBe(CATEGORIES.indexOf("smileys_people"));
    expect(grinning?.n.en).toContain("grinning face");
    for (const locale of ["en", "zh", "zh-Hant", "ja", "ko", "es", "fr", "de", "pt-BR", "it", "vi", "th", "hi", "ru"] as const) {
      expect(grinning?.n[locale].length, locale).toBeGreaterThan(0);
    }
    expect(data.emojis.find((emoji) => emoji.u === "1f44b")?.v).toContain("1f44b-1f3fb");
    for (const name of [...CATEGORIES, "search", "clear"]) expect(data.icons[name]?.shapes.length, name).toBeGreaterThan(0);
  });
});
