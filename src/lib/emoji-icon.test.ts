import { describe, expect, it } from "vitest";
import { isEmojiIcon } from "./emoji-icon";
import emojiData from "emoji-picker-react/data/emojis-en";

describe("isEmojiIcon", () => {
  it("accepts every picker emoji and skin-tone variation", () => {
    for (const item of Object.values(emojiData.emojis).flat()) {
      for (const unified of [item.u, ...(item.v ?? [])]) {
        const emoji = String.fromCodePoint(...unified.split("-").map((part) => parseInt(part, 16)));
        expect(isEmojiIcon(emoji), unified).toBe(true);
      }
    }
  });
  it.each(["📚", "🗂️", "👍🏽", "👨‍👩‍👧", "🇯🇵", "❤️", "1️⃣", "#️⃣", "👩🏽‍❤️‍💋‍👨🏿", "🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}"])("accepts a single emoji %s", (value) => {
    expect(isEmojiIcon(value)).toBe(true);
  });

  it.each(["", " ", "a", "📚a", "📚📚", "📚 ", "1", "<b>", 5, null, undefined, "x".repeat(40)])("rejects %j", (value) => {
    expect(isEmojiIcon(value)).toBe(false);
  });
});
