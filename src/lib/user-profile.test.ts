import { describe, expect, it } from "vitest";
import { avatarVersion, MAX_DISPLAY_NAME, parseDisplayName, parseProfilePatch, toAccountUser } from "./user-profile";

describe("parseDisplayName", () => {
  it("tidies spaces and keeps the name", () => {
    expect(parseDisplayName("  Mine   Kaku ")).toEqual({ ok: true, value: "Mine Kaku" });
    expect(parseDisplayName("郭峰")).toEqual({ ok: true, value: "郭峰" });
  });

  it("treats an empty name or null as going back to the Google name", () => {
    expect(parseDisplayName("")).toEqual({ ok: true, value: null });
    expect(parseDisplayName("   ")).toEqual({ ok: true, value: null });
    expect(parseDisplayName(null)).toEqual({ ok: true, value: null });
  });

  it("rejects non-strings, control characters, direction overrides and long names", () => {
    expect(parseDisplayName(5)).toEqual({ ok: false });
    expect(parseDisplayName(undefined)).toEqual({ ok: false });
    expect(parseDisplayName("a\u0000b")).toEqual({ ok: false });
    expect(parseDisplayName("a‮b")).toEqual({ ok: false });
    expect(parseDisplayName("x".repeat(MAX_DISPLAY_NAME + 1))).toEqual({ ok: false });
    expect(parseDisplayName("x".repeat(MAX_DISPLAY_NAME))).toMatchObject({ ok: true });
  });

  it("counts characters, not UTF-16 units", () => {
    expect(parseDisplayName("😀".repeat(MAX_DISPLAY_NAME))).toMatchObject({ ok: true });
    expect(parseDisplayName("😀".repeat(MAX_DISPLAY_NAME + 1))).toEqual({ ok: false });
  });
});

describe("parseProfilePatch", () => {
  it("updates only the fields that were sent", () => {
    expect(parseProfilePatch({ displayName: "Kaku" })).toEqual({ ok: true, data: { displayName: "Kaku" } });
    expect(parseProfilePatch({ icon: "🚀" })).toEqual({ ok: true, data: { avatarIcon: "🚀" } });
    expect(parseProfilePatch({ icon: null, displayName: "" })).toEqual({ ok: true, data: { avatarIcon: null, displayName: null } });
  });

  it("accepts a supported display language but not automatic or unknown ones", () => {
    expect(parseProfilePatch({ locale: "ja" })).toEqual({ ok: true, data: { locale: "ja" } });
    expect(parseProfilePatch({ locale: "zh-Hant" })).toEqual({ ok: true, data: { locale: "zh-Hant" } });
    for (const locale of [null, "auto", "fr", "", 5]) {
      expect(parseProfilePatch({ locale })).toEqual({ ok: false, error: "Choose one of the listed languages." });
    }
  });

  it.each([[null], ["x"], [[]], [{}], [{ other: 1 }], [{ icon: "abc" }], [{ icon: "📚📚" }], [{ icon: 5 }], [{ displayName: 5 }]])(
    "rejects %j",
    (body) => {
      expect(parseProfilePatch(body).ok).toBe(false);
    },
  );

  it("ignores fields it does not know, so nothing else can be written", () => {
    expect(parseProfilePatch({ icon: "🚀", googleSub: "x", email: "y@z.com" })).toEqual({ ok: true, data: { avatarIcon: "🚀" } });
  });
});

describe("toAccountUser", () => {
  const google = { name: "Mine Kaku", email: "a@example.com", image: "https://example.com/p.png" };

  it("uses the Google name and photo by default", () => {
    expect(toAccountUser({ displayName: null, avatarIcon: null, avatarImage: null }, google)).toEqual({
      name: "Mine Kaku", googleName: "Mine Kaku", email: "a@example.com", image: "https://example.com/p.png", displayName: null, icon: null, avatarUrl: null, locale: null,
    });
  });

  it("prefers the name and icon the user chose, but keeps the Google values available", () => {
    expect(toAccountUser({ displayName: "Kaku", avatarIcon: "🦊", avatarImage: null }, google)).toMatchObject({
      name: "Kaku", googleName: "Mine Kaku", image: "https://example.com/p.png", displayName: "Kaku", icon: "🦊",
    });
  });

  it("returns the chosen display language and drops unknown stored values", () => {
    expect(toAccountUser({ displayName: null, avatarIcon: null, avatarImage: null, locale: "zh-Hant" }, google).locale).toBe("zh-Hant");
    expect(toAccountUser({ displayName: null, avatarIcon: null, avatarImage: null, locale: "fr" }, google).locale).toBeNull();
  });
});

describe("uploaded photo", () => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  const google = { name: "Mine Kaku", email: "a@example.com", image: "https://example.com/p.png" };

  it("gives a versioned URL that changes with every upload", () => {
    expect(toAccountUser({ displayName: null, avatarIcon: null, avatarImage: `avatars/u1/${id}.webp` }, google).avatarUrl).toBe(`/api/account/avatar?v=${id}`);
    expect(avatarVersion(`avatars/u1/${id}.png`)).toBe(id);
  });

  it("has no URL without a valid stored photo", () => {
    expect(toAccountUser({ displayName: null, avatarIcon: null, avatarImage: null }, google).avatarUrl).toBeNull();
    expect(avatarVersion("avatars/u1/not-a-uuid.png")).toBeNull();
    expect(avatarVersion(null)).toBeNull();
  });
});
