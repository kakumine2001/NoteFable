import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ configured: vi.fn(), profile: vi.fn(), currentUser: vi.fn(), deleteAccount: vi.fn() }));
vi.mock("@/lib/google-auth", () => ({
  isGoogleLoginConfigured: mocks.configured,
  isAccountLoginConfigured: mocks.configured,
  isEmailLoginConfigured: () => true,
}));
vi.mock("@/lib/auth", () => ({
  getOrCreateUser: mocks.currentUser,
  isAccountUser: (user: { googleSub: string | null; verifiedEmail?: string | null }) => Boolean(user.googleSub || user.verifiedEmail),
  currentAccountProfile: mocks.profile,
}));
vi.mock("@/lib/account-deletion", () => ({ deleteAccount: mocks.deleteAccount }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/storage", () => ({ deleteStoredImage: vi.fn() }));
import { DELETE } from "./route";

const row = { id: "u1", googleSub: "sub-1", verifiedEmail: "a@example.com", avatarImage: null };
function request(headers: Record<string, string> = {}) {
  return new NextRequest("https://notefable.com/api/account", {
    method: "DELETE",
    headers: { host: "notefable.com", cookie: "__Secure-authjs.session-token=abc; __Secure-authjs.session-token.0=x; notefable_device=d.s; other=1", ...headers },
  });
}

describe("DELETE /api/account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configured.mockReturnValue(true);
    mocks.profile.mockResolvedValue({ name: "Mine", email: "a@example.com", image: null });
    mocks.currentUser.mockResolvedValue(row);
    mocks.deleteAccount.mockResolvedValue({ failed: [] });
  });

  it("deletes the signed-in account and clears the sign-in and device cookies", async () => {
    const response = await DELETE(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(mocks.deleteAccount).toHaveBeenCalledWith(row);
    const cleared = response.cookies.getAll().filter((cookie) => cookie.maxAge === 0).map((cookie) => cookie.name).sort();
    expect(cleared).toEqual(["__Secure-authjs.session-token", "__Secure-authjs.session-token.0", "notefable_device"]);
  });

  it("accepts the native app, which sends no Origin, but rejects other sites", async () => {
    expect((await DELETE(request({ origin: "https://evil.example" }))).status).toBe(403);
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
    expect((await DELETE(request({ origin: "https://notefable.com" }))).status).toBe(200);
  });

  it("refuses when nobody is signed in or the row is anonymous", async () => {
    mocks.profile.mockResolvedValueOnce(null);
    expect((await DELETE(request())).status).toBe(401);
    mocks.currentUser.mockResolvedValueOnce({ ...row, googleSub: null, verifiedEmail: null });
    expect((await DELETE(request())).status).toBe(401);
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
  });

  it("is unavailable when sign-in is off", async () => {
    mocks.configured.mockReturnValue(false);
    expect((await DELETE(request())).status).toBe(404);
  });
});
