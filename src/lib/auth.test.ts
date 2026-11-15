import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  session: { updateMany: vi.fn() },
  chatProject: { updateMany: vi.fn() },
  noteGroup: { updateMany: vi.fn() },
  notePage: { updateMany: vi.fn() },
  noteRevision: { updateMany: vi.fn() },
  noteProposal: { updateMany: vi.fn() },
  noteCoverAsset: { updateMany: vi.fn() },
  user: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
}));
const cookieStore = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
const session = vi.hoisted(() => ({ value: null as unknown, configured: true, emailConfigured: true }));
const deleted = vi.hoisted(() => ({ isDeletedLogin: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("@/lib/deleted-accounts", () => deleted);
vi.mock("@/lib/google-auth", () => ({
  isGoogleLoginConfigured: () => session.configured,
  isEmailLoginConfigured: () => session.emailConfigured,
  isAccountLoginConfigured: () => session.configured || session.emailConfigured,
  auth: async () => session.value,
}));

import { getOrCreateUser } from "@/lib/auth";

const google = { user: { id: "g-1", email: "a@example.com", name: "A", image: null } };

describe("getOrCreateUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COOKIE_SECRET = "test-secret";
    cookieStore.get.mockReturnValue(undefined);
    session.value = null;
    session.configured = true;
    session.emailConfigured = true;
    prismaMock.user.upsert.mockResolvedValue({ id: "device-user", googleSub: null });
    deleted.isDeletedLogin.mockResolvedValue(false);
  });

  it("does not re-create a deleted Google account from a session issued before the deletion", async () => {
    session.value = { ...google, signedInAt: 100 };
    prismaMock.user.findUnique.mockResolvedValue(null);
    deleted.isDeletedLogin.mockResolvedValue(true);
    const user = await getOrCreateUser();
    expect(deleted.isDeletedLogin).toHaveBeenCalledWith({ kind: "google", sub: "g-1" }, 100);
    expect(user.id).toBe("device-user");
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("does not re-create a deleted email account from an old session", async () => {
    session.value = { loginEmail: "B@Example.com" };
    prismaMock.user.findUnique.mockResolvedValue(null);
    deleted.isDeletedLogin.mockResolvedValue(true);
    const user = await getOrCreateUser();
    expect(deleted.isDeletedLogin).toHaveBeenCalledWith({ kind: "email", email: "b@example.com" }, null);
    expect(user.id).toBe("device-user");
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("does not check deletion marks for an account that exists", async () => {
    session.value = google;
    prismaMock.user.findUnique.mockResolvedValue({ id: "account-user", email: "a@example.com", name: "A", image: null });
    await getOrCreateUser();
    expect(deleted.isDeletedLogin).not.toHaveBeenCalled();
  });

  it("uses the device user when not logged in", async () => {
    const user = await getOrCreateUser();
    expect(user.id).toBe("device-user");
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("uses the device user when Google login is not configured", async () => {
    session.configured = false;
    session.emailConfigured = false;
    session.value = google;
    const user = await getOrCreateUser();
    expect(user.id).toBe("device-user");
  });

  it("returns the existing account user on another device", async () => {
    session.value = google;
    prismaMock.user.findUnique.mockResolvedValue({
      id: "account-user", email: "a@example.com", name: "A", image: null,
    });
    const user = await getOrCreateUser();
    expect(user.id).toBe("account-user");
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it("claims the current device data on the first Google login", async () => {
    session.value = google;
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({ id: "device-user", googleSub: "g-1" });
    const user = await getOrCreateUser();
    expect(user.id).toBe("device-user");
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: "device-user", googleSub: null, verifiedEmail: null },
      data: expect.objectContaining({ googleSub: "g-1" }),
    });
  });

  it("creates a new user when the device already belongs to another Google account", async () => {
    session.value = google;
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.user.create.mockResolvedValue({ id: "new-user" });
    const user = await getOrCreateUser();
    expect(user.id).toBe("new-user");
    expect(prismaMock.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ googleSub: "g-1" }),
    });
  });

  it("does not expose a Google-linked device row after sign-out", async () => {
    prismaMock.user.upsert.mockResolvedValue({ id: "linked-user", googleSub: "g-1" });
    prismaMock.user.create.mockResolvedValue({ id: "fresh-anonymous" });
    const user = await getOrCreateUser();
    expect(user.id).toBe("fresh-anonymous");
    expect(cookieStore.set).toHaveBeenCalled();
    expect(prismaMock.user.create).toHaveBeenCalledWith({
      data: { deviceId: expect.any(String) },
    });
  });

  it("returns the winning row when a concurrent first login hits the unique key", async () => {
    session.value = google;
    prismaMock.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "winner" });
    prismaMock.user.updateMany.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    const user = await getOrCreateUser();
    expect(user.id).toBe("winner");
  });

  it("records Google's verified email so an email sign-in finds the same user", async () => {
    session.value = { ...google, googleEmailVerified: true };
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "account-user", googleSub: "g-1", verifiedEmail: null, email: "a@example.com", name: "A", image: null,
    });
    prismaMock.user.update.mockResolvedValue({ id: "account-user" });
    await getOrCreateUser();
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "account-user" },
      data: expect.objectContaining({ verifiedEmail: "a@example.com" }),
    });
  });

  it("does not record an unverified Google email", async () => {
    session.value = { ...google, googleEmailVerified: false };
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "account-user", googleSub: "g-1", verifiedEmail: null, email: "a@example.com", name: "A", image: null,
    });
    await getOrCreateUser();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("links a first Google login to the user who signed in by email with the same verified address", async () => {
    session.value = { ...google, googleEmailVerified: true };
    prismaMock.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "email-user", googleSub: null, verifiedEmail: "a@example.com" });
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({ id: "email-user", googleSub: "g-1" });
    const user = await getOrCreateUser();
    expect(user.id).toBe("email-user");
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: "email-user", googleSub: null },
      data: expect.objectContaining({ googleSub: "g-1" }),
    });
    expect(prismaMock.user.upsert).not.toHaveBeenCalled();
  });

  it("never links an unverified Google email to an email user", async () => {
    session.value = { ...google, googleEmailVerified: false };
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({ id: "device-user" });
    await getOrCreateUser();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalledWith({ where: { verifiedEmail: "a@example.com" } });
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: "device-user", googleSub: null, verifiedEmail: null },
      data: expect.not.objectContaining({ verifiedEmail: expect.anything() }),
    });
  });

  it("an email sign-in returns the user who already has that address", async () => {
    session.value = { loginEmail: "A@Example.com" };
    prismaMock.user.findUnique.mockResolvedValue({ id: "google-user", googleSub: "g-1", verifiedEmail: "a@example.com" });
    const user = await getOrCreateUser();
    expect(user.id).toBe("google-user");
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { verifiedEmail: "a@example.com" } });
    expect(prismaMock.user.upsert).not.toHaveBeenCalled();
  });

  it("a first email sign-in claims the current device data", async () => {
    session.value = { loginEmail: "a@example.com" };
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({ id: "device-user", verifiedEmail: "a@example.com" });
    const user = await getOrCreateUser();
    expect(user.id).toBe("device-user");
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: "device-user", googleSub: null, verifiedEmail: null },
      data: { verifiedEmail: "a@example.com", email: "a@example.com" },
    });
  });

  it("ignores an email session when email sign-in is turned off", async () => {
    session.emailConfigured = false;
    session.value = { loginEmail: "a@example.com" };
    const user = await getOrCreateUser();
    expect(user.id).toBe("device-user");
  });

  it("does not expose an email-linked device row after sign-out", async () => {
    prismaMock.user.upsert.mockResolvedValue({ id: "linked-user", googleSub: null, verifiedEmail: "a@example.com" });
    prismaMock.user.create.mockResolvedValue({ id: "fresh-anonymous" });
    const user = await getOrCreateUser();
    expect(user.id).toBe("fresh-anonymous");
  });

  it("signs in a Google account whose verified email belongs to another Google user, without taking the email", async () => {
    session.value = { ...google, googleEmailVerified: true };
    prismaMock.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "other", googleSub: "g-old", verifiedEmail: "a@example.com" });
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({ id: "device-user", googleSub: "g-1" });
    const user = await getOrCreateUser();
    expect(user.id).toBe("device-user");
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: "device-user", googleSub: null, verifiedEmail: null },
      data: expect.not.objectContaining({ verifiedEmail: expect.anything() }),
    });
  });
  it("keeps the Google user separate when an email-only user already holds the address", async () => {
    session.value = { ...google, googleEmailVerified: true };
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "google-user", googleSub: "g-1", verifiedEmail: null, email: "a@example.com", name: "A", image: null,
    });
    prismaMock.user.update
      .mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }))
      .mockResolvedValueOnce({ id: "google-user" });
    const user = await getOrCreateUser();
    expect(user.id).toBe("google-user");
    expect(prismaMock.user.update).toHaveBeenLastCalledWith({
      where: { id: "google-user" },
      data: { email: "a@example.com", name: "A", image: null },
    });
  });
});
