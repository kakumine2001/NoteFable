import { describe, expect, it } from "vitest";
import { normalizeExternalLink, pageCardLabel, pageCardOf, pageIdFromLink, pageLinkUrl } from "@/lib/whiteboard/links";

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
  });
});
