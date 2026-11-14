import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: vi.fn(),
  auth: vi.fn(),
  currentUser: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  del: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ optionalEnv: (key: string) => (key === "AUTH_GOOGLE_ID" ? "client-id" : undefined) }));
vi.mock("@/lib/google-auth", () => ({
  isGoogleLoginConfigured: mocks.configured,
  isAccountLoginConfigured: mocks.configured,
  isEmailLoginConfigured: () => false,
  auth: mocks.auth,
}));
vi.mock("@/lib/auth", () => ({
  getOrCreateAnonymousUser: mocks.currentUser,
  isAccountUser: (user: { googleSub: string | null; verifiedEmail?: string | null }) => Boolean(user.googleSub || user.verifiedEmail),
  currentAccountProfile: async () => {
    if (!mocks.configured()) return null;
    const session = await mocks.auth();
    const user = session?.user;
    return user?.id ? { name: user.name ?? null, email: user.email ?? null, image: user.image ?? null } : null;
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: { anonymousUser: { update: mocks.update, updateMany: mocks.updateMany, findUniqueOrThrow: mocks.findUnique } } }));
vi.mock("@/lib/storage", () => ({ deleteStoredImage: mocks.del }));
import { GET, PATCH } from "./route";

const google = { id: "sub-1", name: "Mine Kaku", email: "a@example.com", image: "https://example.com/p.png" };
const row = { id: "u1", googleSub: "sub-1", displayName: null, avatarIcon: null, avatarImage: null };
const photoId = "11111111-1111-4111-8111-111111111111";
const patch = (body: unknown) => new Request("http://localhost/api/account", { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) });

describe("account profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configured.mockReturnValue(true);
    mocks.auth.mockResolvedValue({ user: google });
    mocks.currentUser.mockResolvedValue(row);
    mocks.update.mockImplementation(async ({ data }) => ({ ...row, ...data }));
    mocks.del.mockResolvedValue(undefined);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockImplementation(async () => ({ ...mocks.currentUser.mock.results.at(-1)?.value, ...{} }));
  });

  it("hides the sign-in UI when no login is configured", async () => {
    mocks.configured.mockReturnValue(false);
    expect(await (await GET()).json()).toEqual({ configured: false, user: null });
    expect((await PATCH(patch({ icon: "🚀" }))).status).toBe(404);
  });

  it("shows no user when signed out", async () => {
    mocks.auth.mockResolvedValue(null);
    expect(await (await GET()).json()).toEqual({ configured: true, google: true, email: false, user: null, googleClientId: "client-id" });
  });

  it("shows the Google name and photo by default", async () => {
    const body = await (await GET()).json();
    expect(body.user).toEqual({
      name: "Mine Kaku", googleName: "Mine Kaku", email: "a@example.com", image: "https://example.com/p.png", displayName: null, icon: null, avatarUrl: null,
    });
  });

  it("shows the name and icon the user chose", async () => {
    mocks.currentUser.mockResolvedValue({ ...row, displayName: "Kaku", avatarIcon: "🦊" });
    expect((await (await GET()).json()).user).toMatchObject({ name: "Kaku", displayName: "Kaku", icon: "🦊", googleName: "Mine Kaku" });
  });

  it("still shows the Google profile when the database cannot be read", async () => {
    mocks.currentUser.mockRejectedValue(new Error("db down"));
    expect((await (await GET()).json()).user).toMatchObject({ name: "Mine Kaku", icon: null });
  });

  it("saves only what was sent, on the signed-in user's own row", async () => {
    const response = await PATCH(patch({ displayName: "  Kaku  ", googleSub: "someone-else" }));
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { displayName: "Kaku" } });
    expect((await response.json()).user).toMatchObject({ name: "Kaku", displayName: "Kaku" });
  });

  it("goes back to the Google profile with null", async () => {
    await PATCH(patch({ displayName: null, icon: null }));
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: "u1", avatarImage: null }, data: { displayName: null, avatarIcon: null, avatarImage: null } });
  });

  it("drops the uploaded photo (and deletes its file) when an emoji is chosen or the Google look is restored", async () => {
    const withPhoto = { ...row, avatarImage: `avatars/u1/${photoId}.webp` };
    mocks.currentUser.mockResolvedValue(withPhoto);
    mocks.findUnique.mockResolvedValue({ ...withPhoto, avatarIcon: "🦊", avatarImage: null });
    const response = await PATCH(patch({ icon: "🦊" }));
    expect(response.status).toBe(200);
    // 読んだときの写真のままの場合だけ外す
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: "u1", avatarImage: `avatars/u1/${photoId}.webp` }, data: { avatarIcon: "🦊", avatarImage: null } });
    expect(mocks.del).toHaveBeenCalledWith(`avatars/u1/${photoId}.webp`);
    expect((await response.json()).user).toMatchObject({ icon: "🦊", avatarUrl: null });
  });

  it("does not delete or clear a photo that another tab uploaded in the meantime", async () => {
    mocks.currentUser.mockResolvedValue({ ...row, avatarImage: `avatars/u1/${photoId}.webp` });
    mocks.updateMany.mockResolvedValue({ count: 0 });
    expect((await PATCH(patch({ icon: "🦊" }))).status).toBe(409);
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it("also detects a concurrent first photo upload when choosing an emoji", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    expect((await PATCH(patch({ icon: "🦊" }))).status).toBe(409);
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: "u1", avatarImage: null }, data: { avatarIcon: "🦊", avatarImage: null } });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it("keeps the uploaded photo when only the name changes", async () => {
    mocks.currentUser.mockResolvedValue({ ...row, avatarImage: `avatars/u1/${photoId}.webp` });
    await PATCH(patch({ displayName: "Kaku" }));
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { displayName: "Kaku" } });
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it("shows the uploaded photo's URL", async () => {
    mocks.currentUser.mockResolvedValue({ ...row, avatarImage: `avatars/u1/${photoId}.webp` });
    expect((await (await GET()).json()).user.avatarUrl).toBe(`/api/account/avatar?v=${photoId}`);
  });

  it("does not let a signed-out visitor edit anything", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await PATCH(patch({ icon: "🚀" }))).status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("does not edit an anonymous (not Google-linked) row", async () => {
    mocks.currentUser.mockResolvedValue({ ...row, googleSub: null });
    expect((await PATCH(patch({ icon: "🚀" }))).status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([["not json"], [{}], [{ icon: "abc" }], [{ displayName: "x".repeat(41) }], [{ displayName: 5 }]])("rejects %j", async (body) => {
    expect((await PATCH(patch(body))).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
