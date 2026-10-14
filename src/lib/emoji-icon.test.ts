import { describe, expect, it } from "vitest";
import { isEmojiIcon } from "./emoji-icon";

describe("isEmojiIcon", () => {
  it.each(["📚", "🗂️", "👍🏽", "👨‍👩‍👧", "🇯🇵", "❤️"])("accepts a single emoji %s", (value) => {
    expect(isEmojiIcon(value)).toBe(true);
  });

  it.each(["", " ", "a", "📚a", "📚📚", "📚 ", "1", "<b>", 5, null, undefined, "x".repeat(40)])("rejects %j", (value) => {
    expect(isEmojiIcon(value)).toBe(false);
  });
});
