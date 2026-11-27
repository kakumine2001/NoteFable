import { describe, expect, it } from "vitest";
import {
  extractPageCardSummary,
  normalizeExternalLink,
  pageCardLabel,
  pageCardMissingLabel,
  pageCardOf,
  pageIdFromLink,
  pageLinkUrl,
  whiteboardPageCardIds,
  wrapCardLabelText,
} from "@/lib/whiteboard/links";

const origin = "https://app.notefable.com";

describe("page links", () => {
  it("round-trips a page link and ignores other links", () => {
    expect(pageIdFromLink(pageLinkUrl("abc_123"), origin)).toBe("abc_123");
    expect(pageIdFromLink(`${origin}/?view=pages&page=xyz`, origin)).toBe("xyz");
    expect(pageIdFromLink("https://other.example/app?view=pages&page=xyz", origin)).toBeNull();
    expect(pageIdFromLink("https://example.com", origin)).toBeNull();
    expect(pageIdFromLink(null, origin)).toBeNull();
  });
});

describe("normalizeExternalLink", () => {
  it("accepts http, https and mailto, adding https when the scheme is missing", () => {
    expect(normalizeExternalLink(" example.com/a ")).toBe("https://example.com/a");
    expect(normalizeExternalLink("http://example.com")).toBe("http://example.com/");
    expect(normalizeExternalLink("mailto:me@example.com")).toBe("mailto:me@example.com");
  });

  it("rejects scripts, data, other schemes and control characters", () => {
    for (const value of ["javascript:alert(1)", "data:text/html,hi", "ftp://example.com", "", "https://exa\nmple.com", "https://"]) {
      expect(normalizeExternalLink(value)).toBeNull();
    }
  });
});

describe("page cards", () => {
  it("reads the card data and labels it with the icon and title", () => {
    expect(pageCardOf({ notefablePage: { id: "p1", kind: "whiteboard" } })).toEqual({ id: "p1", kind: "whiteboard" });
    expect(pageCardOf({ notefablePage: { id: "bad id" } })).toBeNull();
    expect(pageCardOf(null)).toBeNull();
    expect(pageCardLabel({ title: "Plan", icon: "📘" }, "Untitled")).toBe("📘 Plan");
    expect(pageCardLabel({ title: "Untitled", icon: null, kind: "whiteboard" }, "Sin título")).toBe("🧩 Sin título");
    expect(pageCardLabel({ title: "Deck", icon: "upload:page-covers/u/x.png", kind: "slides" }, "Untitled")).toBe("📊 Deck");
    expect(pageCardMissingLabel("Page does not exist")).toBe("Page does not exist");
  });

  it("collects unique live page card IDs and extracts short summaries without leaking deleted cards", () => {
    const ids = whiteboardPageCardIds({
      elements: [
        { id: "a", type: "rectangle", customData: { notefablePage: { id: "p1", kind: "note" } } },
        { id: "b", type: "rectangle", customData: { notefablePage: { id: "p1", kind: "note" } } },
        { id: "c", type: "rectangle", isDeleted: true, customData: { notefablePage: { id: "gone", kind: "note" } } },
        { id: "d", type: "iframe", customData: { notefablePage: { id: "evil", kind: "note" } } },
        { id: "e", type: "rectangle", customData: { notefablePage: { id: "p2", kind: "whiteboard" } } },
      ],
    });
    expect(ids).toEqual(["p1", "p2"]);

    expect(extractPageCardSummary("note", [
      { id: "b1", type: "paragraph", content: [{ type: "text", text: "Hello   world" }], children: [] },
      { id: "b2", type: "paragraph", content: [{ type: "text", text: "Second line" }], children: [] },
    ], null)).toBe("Hello world Second line");

    expect(extractPageCardSummary("whiteboard", [], [{ id: "e1", text: "Node A" }, { id: "e2", text: "Node B" }])).toBe("Node A · Node B");

    const longSummary = extractPageCardSummary("note", [
      { id: "b1", type: "paragraph", content: [{ type: "text", text: "word ".repeat(60) }], children: [] },
    ], null, 40);
    expect(longSummary.length).toBeLessThanOrEqual(40);
    expect(longSummary.endsWith("…")).toBe(true);

    expect(wrapCardLabelText("📄 Very long title for a narrow whiteboard card", 180, 18)).toContain("\n");
  });
});
