import { describe, expect, it, vi } from "vitest";
import type { Account, Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { authCallbacks } from "@/lib/google-auth";

// next-auth 本体は vitest の Node ESM 解決で読み込めないため、コールバックだけを検証する。
vi.mock("next-auth", () => ({
  default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }),
}));
vi.mock("next-auth/providers/google", () => ({ default: {} }));

const google = { provider: "google", providerAccountId: "109876543210" } as Account;

describe("authCallbacks", () => {
  it("stores the Google account id on sign-in, not the per-login token.sub", () => {
    const token = authCallbacks.jwt({ token: { sub: "random-per-login" } as JWT, account: google });
    expect(token.googleSub).toBe("109876543210");
  });

  it("keeps the stored id on later requests", () => {
    const token = authCallbacks.jwt({ token: { googleSub: "109876543210" } as JWT, account: null });
    expect(token.googleSub).toBe("109876543210");
  });

  it("exposes the Google account id as session.user?.id", () => {
    const session = authCallbacks.session({
      session: { user: { id: "", email: "a@example.com" } } as Session,
      token: { sub: "random-per-login", googleSub: "109876543210" } as JWT,
    });
    expect(session.user?.id).toBe("109876543210");
  });

  it("does not use token.sub when no Google id is stored", () => {
    const session = authCallbacks.session({
      session: { user: { id: "" } } as Session,
      token: { sub: "random-per-login" } as JWT,
    });
    expect(session.user?.id).toBe("");
  });
});
