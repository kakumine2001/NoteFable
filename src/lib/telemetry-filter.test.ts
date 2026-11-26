import { describe, expect, it } from "vitest";
import { isUntrackedUrl } from "./telemetry-filter";

describe("isUntrackedUrl", () => {
  it("drops public share links so their tokens never leave", () => {
    expect(isUntrackedUrl("https://notefable.com/s/abc123")).toBe(true);
    expect(isUntrackedUrl("/s/abc123?x=1")).toBe(true);
  });

  it("drops the editor that the Android and iOS apps load in a web view", () => {
    expect(isUntrackedUrl("https://app.notefable.com/note-embed?page=p1&lang=ja")).toBe(true);
    expect(isUntrackedUrl("https://app.notefable.com/ja/note-embed")).toBe(true);
    expect(isUntrackedUrl("/note-embed/")).toBe(true);
  });

  it("keeps ordinary web pages", () => {
    for (const url of ["https://notefable.com/", "https://app.notefable.com/app?view=pages", "https://notefable.com/privacy", "/settings/s/x", "/note-embedded"]) {
      expect(isUntrackedUrl(url)).toBe(false);
    }
  });
});
