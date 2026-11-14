import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  anonymousUser: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
  },
}));
const cookieStore = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
const session = vi.hoisted(() => ({ value: null as unknown, configured: true, emailConfigured: true }));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("@/lib/google-auth", () => ({
  isGoogleLoginConfigured: () => session.configured,
  isEmailLoginConfigured: () => session.emailConfigured,
  isAccountLoginConfigured: () => session.configured || session.emailConfigured,
  auth: async () => session.value,
}));

import { getOrCreateAnonymousUser } from "@/lib/auth";

const google = { user: { id: "g-1", email: "a@example.com", name: "A", image: null } };

describe("getOrCreateAnonymousUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COOKIE_SECRET = "test-secret";
    cookieStore.get.mockReturnValue(undefined);
    session.value = null;
    session.configured = true;
    session.emailConfigured = true;
    prismaMock.anonymousUser.upsert.mockResolvedValue({ id: "device-user", googleSub: null });
  });

  it("uses the device user when not logged in", async () => {
    const user = await getOrCreateAnonymousUser();
    expect(user.id).toBe("device-user");
    expect(prismaMock.anonymousUser.findUnique).not.toHaveBeenCalled();
  });

  it("uses the device user when Google login is not configured", async () => {
    session.configured = false;
    session.emailConfigured = false;
    session.value = google;
    const user = await getOrCreateAnonymousUser();
    expect(user.id).toBe("device-user");
  });

  it("returns the existing account user on another device", async () => {
    session.value = google;
    prismaMock.anonymousUser.findUnique.mockResolvedValue({
      id: "account-user", email: "a@example.com", name: "A", image: null,
    });
    const user = await getOrCreateAnonymousUser();
    expect(user.id).toBe("account-user");
    expect(prismaMock.anonymousUser.updateMany).not.toHaveBeenCalled();
  });

  it("claims the current device data on the first Google login", async () => {
    session.value = google;
    prismaMock.anonymousUser.findUnique.mockResolvedValue(null);
    prismaMock.anonymousUser.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.anonymousUser.findUniqueOrThrow.mockResolvedValue({ id: "device-user", googleSub: "g-1" });
    const user = await getOrCreateAnonymousUser();
    expect(user.id).toBe("device-user");
    expect(prismaMock.anonymousUser.updateMany).toHaveBeenCalledWith({
      where: { id: "device-user", googleSub: null, verifiedEmail: null },
      data: expect.objectContaining({ googleSub: "g-1" }),
    });
  });

  it("creates a new user when the device already belongs to another Google account", async () => {
    session.value = google;
    prismaMock.anonymousUser.findUnique.mockResolvedValue(null);
    prismaMock.anonymousUser.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.anonymousUser.create.mockResolvedValue({ id: "new-user" });
    const user = await getOrCreateAnonymousUser();
    expect(user.id).toBe("new-user");
    expect(prismaMock.anonymousUser.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ googleSub: "g-1" }),
    });
  });

  it("does not expose a Google-linked device row after sign-out", async () => {
    prismaMock.anonymousUser.upsert.mockResolvedValue({ id: "linked-user", googleSub: "g-1" });
    prismaMock.anonymousUser.create.mockResolvedValue({ id: "fresh-anonymous" });
    const user = await getOrCreateAnonymousUser();
    expect(user.id).toBe("fresh-anonymous");
    expect(cookieStore.set).toHaveBeenCalled();
    expect(prismaMock.anonymousUser.create).toHaveBeenCalledWith({
      data: { deviceId: expect.any(String) },
    });
  });

  it("returns the winning row when a concurrent first login hits the unique key", async () => {
    session.value = google;
    prismaMock.anonymousUser.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "winner" });
    prismaMock.anonymousUser.updateMany.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    const user = await getOrCreateAnonymousUser();
    expect(user.id).toBe("winner");
  });

  it("records Google's verified email so an email sign-in finds the same user", async () => {
    session.value = { ...google, googleEmailVerified: true };
    prismaMock.anonymousUser.findUnique.mockResolvedValueOnce({
      id: "account-user", googleSub: "g-1", verifiedEmail: null, email: "a@example.com", name: "A", image: null,
    });
    prismaMock.anonymousUser.update.mockResolvedValue({ id: "account-user" });
    await getOrCreateAnonymousUser();
    expect(prismaMock.anonymousUser.update).toHaveBeenCalledWith({
      where: { id: "account-user" },
      data: expect.objectContaining({ verifiedEmail: "a@example.com" }),
    });
  });

  it("does not record an unverified Google email", async () => {
    session.value = { ...google, googleEmailVerified: false };
    prismaMock.anonymousUser.findUnique.mockResolvedValueOnce({
      id: "account-user", googleSub: "g-1", verifiedEmail: null, email: "a@example.com", name: "A", image: null,
    });
    await getOrCreateAnonymousUser();
    expect(prismaMock.anonymousUser.update).not.toHaveBeenCalled();
  });

  it("links a first Google login to the user who signed in by email with the same verified address", async () => {
    session.value = { ...google, googleEmailVerified: true };
    prismaMock.anonymousUser.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "email-user", googleSub: null, verifiedEmail: "a@example.com" });
    prismaMock.anonymousUser.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.anonymousUser.findUniqueOrThrow.mockResolvedValue({ id: "email-user", googleSub: "g-1" });
    const user = await getOrCreateAnonymousUser();
    expect(user.id).toBe("email-user");
    expect(prismaMock.anonymousUser.updateMany).toHaveBeenCalledWith({
      where: { id: "email-user", googleSub: null },
      data: expect.objectContaining({ googleSub: "g-1" }),
    });
    expect(prismaMock.anonymousUser.upsert).not.toHaveBeenCalled();
  });

  it("never links an unverified Google email to an email user", async () => {
    session.value = { ...google, googleEmailVerified: false };
    prismaMock.anonymousUser.findUnique.mockResolvedValue(null);
    prismaMock.anonymousUser.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.anonymousUser.findUniqueOrThrow.mockResolvedValue({ id: "device-user" });
    await getOrCreateAnonymousUser();
    expect(prismaMock.anonymousUser.findUnique).not.toHaveBeenCalledWith({ where: { verifiedEmail: "a@example.com" } });
    expect(prismaMock.anonymousUser.updateMany).toHaveBeenCalledWith({
      where: { id: "device-user", googleSub: null, verifiedEmail: null },
      data: expect.not.objectContaining({ verifiedEmail: expect.anything() }),
    });
  });

  it("an email sign-in returns the user who already has that address", async () => {
    session.value = { loginEmail: "A@Example.com" };
    prismaMock.anonymousUser.findUnique.mockResolvedValue({ id: "google-user", googleSub: "g-1", verifiedEmail: "a@example.com" });
    const user = await getOrCreateAnonymousUser();
    expect(user.id).toBe("google-user");
    expect(prismaMock.anonymousUser.findUnique).toHaveBeenCalledWith({ where: { verifiedEmail: "a@example.com" } });
    expect(prismaMock.anonymousUser.upsert).not.toHaveBeenCalled();
  });

  it("a first email sign-in claims the current device data", async () => {
    session.value = { loginEmail: "a@example.com" };
    prismaMock.anonymousUser.findUnique.mockResolvedValue(null);
    prismaMock.anonymousUser.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.anonymousUser.findUniqueOrThrow.mockResolvedValue({ id: "device-user", verifiedEmail: "a@example.com" });
    const user = await getOrCreateAnonymousUser();
    expect(user.id).toBe("device-user");
    expect(prismaMock.anonymousUser.updateMany).toHaveBeenCalledWith({
      where: { id: "device-user", googleSub: null, verifiedEmail: null },
      data: { verifiedEmail: "a@example.com", email: "a@example.com" },
    });
  });

  it("ignores an email session when email sign-in is turned off", async () => {
    session.emailConfigured = false;
    session.value = { loginEmail: "a@example.com" };
    const user = await getOrCreateAnonymousUser();
    expect(user.id).toBe("device-user");
  });

  it("does not expose an email-linked device row after sign-out", async () => {
    prismaMock.anonymousUser.upsert.mockResolvedValue({ id: "linked-user", googleSub: null, verifiedEmail: "a@example.com" });
    prismaMock.anonymousUser.create.mockResolvedValue({ id: "fresh-anonymous" });
    const user = await getOrCreateAnonymousUser();
    expect(user.id).toBe("fresh-anonymous");
  });

  it("signs in a Google account whose verified email belongs to another Google user, without taking the email", async () => {
    session.value = { ...google, googleEmailVerified: true };
    prismaMock.anonymousUser.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "other", googleSub: "g-old", verifiedEmail: "a@example.com" });
    prismaMock.anonymousUser.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.anonymousUser.findUniqueOrThrow.mockResolvedValue({ id: "device-user", googleSub: "g-1" });
    const user = await getOrCreateAnonymousUser();
    expect(user.id).toBe("device-user");
    expect(prismaMock.anonymousUser.updateMany).toHaveBeenCalledWith({
      where: { id: "device-user", googleSub: null, verifiedEmail: null },
      data: expect.not.objectContaining({ verifiedEmail: expect.anything() }),
    });
  });
});
