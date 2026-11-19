import { describe, expect, it } from "vitest";
import { greetingFor, recentPages, relativeTime } from "@/lib/notes-home-text";

describe("greetingFor", () => {
  it("switches at 5, 12 and 18 o'clock", () => {
    expect([4, 5, 11, 12, 17, 18, 23, 0].map(greetingFor)).toEqual([
      "Good evening", "Good morning", "Good morning", "Good afternoon", "Good afternoon", "Good evening", "Good evening", "Good evening",
    ]);
  });
});

describe("recentPages", () => {
  it("returns the eight most recently edited pages, newest first", () => {
    const pages = Array.from({ length: 10 }, (_, index) => ({ id: index, updatedAt: `2026-11-${String(index + 1).padStart(2, "0")}T00:00:00.000Z` }));
    expect(recentPages(pages).map((page) => page.id)).toEqual([9, 8, 7, 6, 5, 4, 3, 2]);
    expect(recentPages(pages, 4).map((page) => page.id)).toEqual([9, 8, 7, 6]);
    expect(pages[0].id).toBe(0);
  });
});

describe("relativeTime", () => {
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const now = Date.parse("2026-11-15T12:00:00.000Z");
  const ago = (seconds: number) => relativeTime(new Date(now - seconds * 1000).toISOString(), now, format);

  it("uses the largest unit that fits and does not round up into the next one", () => {
    expect(ago(0)).toBe("this minute");
    expect(ago(59)).toBe("this minute");
    expect(ago(60)).toBe("1 minute ago");
    expect(ago(3599)).toBe("59 minutes ago");
    expect(ago(3600)).toBe("1 hour ago");
    expect(ago(86400 * 2)).toBe("2 days ago");
    expect(ago(86400 * 8)).toBe("last week");
  });
});
