import { describe, expect, it } from "vitest";
import { cleanTitle, extractResponseText, parseTitleOutput } from "./chat-title";

describe("parseTitleOutput", () => {
  it.each([
    ["🍳 パスタの作り方", "🍳", "パスタの作り方"],
    ["📚Rust lifetimes explained.", "📚", "Rust lifetimes explained"],
    ["Title: 🇯🇵 日本旅行のプラン", "🇯🇵", "日本旅行のプラン"],
    ["\"❤️ 情人节礼物\"", "❤️", "情人节礼物"],
    ["👩‍💻 Prisma の migrate 手順\n補足", "👩‍💻", "Prisma の migrate 手順"],
    ["🍳\nパスタの作り方", "🍳", "パスタの作り方"],
    ["\"Title: 🍳 パスタ\"", "🍳", "パスタ"],
    ["🍳 - パスタ", "🍳", "パスタ"],
    ["🍳: パスタ", "🍳", "パスタ"],
    ["**🍳 パスタ**", "🍳", "パスタ"],
    ["- 🍳 パスタ", "🍳", "パスタ"],
    ["🍳🍝 パスタ", "🍳", "パスタ"],
    ["⛩ 京都旅行", "⛩", "京都旅行"],
  ])("splits %j into icon and title", (raw, icon, title) => {
    expect(parseTitleOutput(raw)).toEqual({ icon, title });
  });

  it("keeps the title without an icon when the output has no leading emoji", () => {
    expect(parseTitleOutput("Rust lifetimes")).toEqual({ icon: null, title: "Rust lifetimes" });
    expect(parseTitleOutput("A 🍳 recipe")).toEqual({ icon: null, title: "A 🍳 recipe" });
    expect(parseTitleOutput("© 2024 plan")).toEqual({ icon: null, title: "© 2024 plan" });
  });

  it("keeps the icon when only an emoji came back", () => {
    expect(parseTitleOutput("🍳")).toEqual({ icon: "🍳", title: null });
    expect(parseTitleOutput("")).toEqual({ icon: null, title: null });
  });
});

describe("cleanTitle", () => {
  it.each([
    ["\"Prisma の migrate 手順\"", "Prisma の migrate 手順"],
    ["「Apple Watch の中国語入力」", "Apple Watch の中国語入力"],
    ["Title: Rust lifetimes explained.", "Rust lifetimes explained"],
    ["タイトル：英語の勉強法\n補足の説明", "英語の勉強法"],
    ["  spaced   out  title  ", "spaced out title"],
  ])("normalizes %j", (raw, expected) => {
    expect(cleanTitle(raw)).toBe(expected);
  });

  it("returns null for empty output so the placeholder stays", () => {
    expect(cleanTitle("")).toBeNull();
    expect(cleanTitle("  \n ")).toBeNull();
    expect(cleanTitle("\"\"")).toBeNull();
  });

  it("truncates overly long titles", () => {
    const title = cleanTitle("a".repeat(100));
    expect(title).toBe(`${"a".repeat(60)}...`);
  });
});

describe("extractResponseText", () => {
  it("reads output_text when present", () => {
    expect(extractResponseText({ output_text: "Hello" })).toBe("Hello");
  });

  it("joins message output parts and skips reasoning items", () => {
    expect(extractResponseText({
      output: [
        { type: "reasoning" },
        { type: "message", content: [{ type: "output_text", text: "Hel" }, { type: "output_text", text: "lo" }] },
      ],
    })).toBe("Hello");
  });

  it("returns an empty string when there is no text", () => {
    expect(extractResponseText({})).toBe("");
  });
});
