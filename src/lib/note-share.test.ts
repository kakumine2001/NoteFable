import { describe, expect, it } from "vitest";
import {
  expiryFromPreset,
  extractBlockFileKeys,
  isShareRowActive,
  isValidShareToken,
  rewriteBlocksForShare,
  shareCoverUrl,
  shareFileUrl,
  sharePagePath,
  sharePageUrl,
} from "@/lib/note-share";
import { isPageShared } from "@/types/notes";

describe("note-share helpers", () => {
  it("validates share tokens", () => {
    expect(isValidShareToken("abcDEF123_-xyz987")).toBe(true);
    expect(isValidShareToken("short")).toBe(false);
    expect(isValidShareToken("has spaces inside")).toBe(false);
    expect(isValidShareToken("../escape")).toBe(false);
    expect(isValidShareToken(null)).toBe(false);
  });

  it("builds root, subpage, cover and file URLs", () => {
    expect(sharePagePath("tok123456")).toBe("/s/tok123456");
    expect(sharePagePath("tok123456", "page_2")).toBe("/s/tok123456/p/page_2");
    expect(sharePageUrl("tok123456", "https://notefable.com/")).toBe("https://notefable.com/s/tok123456");
    expect(sharePageUrl("tok123456", "https://notefable.com", "page_2")).toBe("https://notefable.com/s/tok123456/p/page_2");
    expect(shareCoverUrl("tok123456", "page_1")).toBe("/s/tok123456/cover?page=page_1");
    expect(shareFileUrl("tok123456", "page_1", "note-files/u1/uuid.png", "pic.png")).toBe(
      "/s/tok123456/file?page=page_1&key=note-files%2Fu1%2Fuuid.png&name=pic.png",
    );
  });

  it("computes expiry timestamps from presets", () => {
    const base = Date.UTC(2026, 10, 22, 12, 0, 0);
    expect(expiryFromPreset("never", base)).toBeNull();
    expect(expiryFromPreset("1h", base)).toBe(new Date(base + 3_600_000).toISOString());
    expect(expiryFromPreset("1d", base)).toBe(new Date(base + 86_400_000).toISOString());
    expect(expiryFromPreset("7d", base)).toBe(new Date(base + 7 * 86_400_000).toISOString());
    expect(expiryFromPreset("30d", base)).toBe(new Date(base + 30 * 86_400_000).toISOString());
  });

  it("checks active share state across disabled, trashed, and expired rows", () => {
    const now = new Date("2026-11-22T12:00:00.000Z");
    const future = new Date("2026-11-23T12:00:00.000Z");
    const past = new Date("2026-11-21T12:00:00.000Z");

    expect(isShareRowActive({ deletedAt: null, shareEnabled: true, shareToken: "token12345", shareExpiresAt: null }, now)).toBe(true);
    expect(isShareRowActive({ deletedAt: null, shareEnabled: true, shareToken: "token12345", shareExpiresAt: future }, now)).toBe(true);
    expect(isShareRowActive({ deletedAt: null, shareEnabled: true, shareToken: "token12345", shareExpiresAt: past }, now)).toBe(false);
    expect(isShareRowActive({ deletedAt: null, shareEnabled: false, shareToken: "token12345", shareExpiresAt: null }, now)).toBe(false);
    expect(isShareRowActive({ deletedAt: past, shareEnabled: true, shareToken: "token12345", shareExpiresAt: null }, now)).toBe(false);
    expect(isShareRowActive({ deletedAt: null, shareEnabled: true, shareToken: null, shareExpiresAt: null }, now)).toBe(false);

    expect(isPageShared({ shareEnabled: true, shareExpiresAt: null }, now.getTime())).toBe(true);
    expect(isPageShared({ shareEnabled: true, shareExpiresAt: future.toISOString() }, now.getTime())).toBe(true);
    expect(isPageShared({ shareEnabled: true, shareExpiresAt: past.toISOString() }, now.getTime())).toBe(false);
    expect(isPageShared({ shareEnabled: false, shareExpiresAt: null }, now.getTime())).toBe(false);
  });

  it("extracts and rewrites nested image and file URLs without leaking private routes", () => {
    const key1 = "note-files/user1/11111111-1111-1111-1111-111111111111.png";
    const key2 = "note-files/user1/22222222-2222-2222-2222-222222222222.pdf";
    const blocks = [
      {
        id: "b1",
        type: "image",
        props: { url: `/api/pages/files?key=${encodeURIComponent(key1)}&name=photo.png`, caption: "hi" },
        children: [
          {
            id: "b2",
            type: "file",
            props: { url: `/api/pages/files?key=${encodeURIComponent(key2)}&name=doc.pdf`, name: "doc.pdf" },
            children: [],
          },
        ],
      },
      {
        id: "b3",
        type: "image",
        props: { url: "" },
        children: [],
      },
    ];

    const keys = extractBlockFileKeys(blocks);
    expect([...keys]).toEqual([key1, key2]);

    const rewritten = rewriteBlocksForShare(blocks, "shareTok123", "page_9");
    expect(rewritten[0].props.url).toBe(shareFileUrl("shareTok123", "page_9", key1, "photo.png"));
    expect(rewritten[0].children[0].props.url).toBe(shareFileUrl("shareTok123", "page_9", key2, "doc.pdf"));
    expect(rewritten[1].props.url).toBe("");
    // Original blocks remain untouched.
    expect(blocks[0].props.url).toContain("/api/pages/files?");
  });
});
