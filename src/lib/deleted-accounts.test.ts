import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/env", () => ({ getCookieSecret: () => "secret" }));
vi.mock("@/lib/prisma", () => ({ prisma: { deletedAccount: { findUnique: mocks.findUnique } } }));
import { deletedAccountKey, deletedAccountKeys, isDeletedLogin } from "./deleted-accounts";

describe("deleted account marks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keys are HMACs, not the login IDs, and differ by kind", () => {
    const google = deletedAccountKey({ kind: "google", sub: "a@example.com" });
    const email = deletedAccountKey({ kind: "email", email: "a@example.com" });
    expect(google).not.toContain("example");
    expect(google).not.toBe(email);
    expect(deletedAccountKeys({ googleSub: "a@example.com", verifiedEmail: "a@example.com" })).toEqual([google, email]);
    expect(deletedAccountKeys({ googleSub: null, verifiedEmail: null })).toEqual([]);
  });

  it("rejects sessions signed in before the deletion, including old cookies without a time", async () => {
    mocks.findUnique.mockResolvedValue({ deletedAt: new Date(2_000_000_000_000) });
    expect(await isDeletedLogin({ kind: "google", sub: "g1" }, 1_999_999_000)).toBe(true);
    expect(await isDeletedLogin({ kind: "google", sub: "g1" }, null)).toBe(true);
    expect(await isDeletedLogin({ kind: "google", sub: "g1" }, 2_000_000_100)).toBe(false);
  });

  it("allows logins that were never deleted", async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect(await isDeletedLogin({ kind: "email", email: "b@example.com" }, null)).toBe(false);
  });
});
