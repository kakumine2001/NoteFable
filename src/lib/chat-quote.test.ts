import { describe, expect, it } from "vitest";
import { composeQuotedMessage, MAX_QUOTE_CHARS, normalizeQuote, splitQuotedMessage } from "@/lib/chat-quote";

describe("chat quote", () => {
  it("normalizes the selection", () => {
    expect(normalizeQuote("  hello  \r\n\r\n\r\nworld \n\n")).toBe("hello\n\nworld");
    const long = normalizeQuote("😀".repeat(MAX_QUOTE_CHARS + 5));
    expect(long.endsWith("…")).toBe(true);
    expect(Array.from(long)).toHaveLength(MAX_QUOTE_CHARS + 1);
  });

  it("composes a blockquote in front of the question", () => {
    expect(composeQuotedMessage("a\n\nb", " why? ")).toBe("> a\n>\n> b\n\nwhy?");
    expect(composeQuotedMessage(null, " why? ")).toBe("why?");
    expect(composeQuotedMessage("  ", "why?")).toBe("why?");
  });

  it("splits what it composed", () => {
    for (const [quote, body] of [["a\n\nb", "why?"], ["> nested", "line 1\n\nline 2"], ["x", "> not a quote"]]) {
      expect(splitQuotedMessage(composeQuotedMessage(quote, body))).toEqual({ quote, body });
    }
  });

  it("leaves other messages alone", () => {
    for (const content of ["plain", "> only a quote", "> quote\nno blank line", "text\n\n> later quote", ">\n\nbody", ">not a quote\n\nbody"]) {
      expect(splitQuotedMessage(content)).toEqual({ quote: null, body: content });
    }
  });
});
