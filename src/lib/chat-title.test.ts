import { describe, expect, it } from "vitest";
import { cleanTitle, extractResponseText } from "./chat-title";

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
