import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: vi.fn(),
  auth: vi.fn(),
  currentUser: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  write: vi.fn(),
  read: vi.fn(),
  del: vi.fn(),
}));
vi.mock("@/lib/google-auth", () => ({ isGoogleLoginConfigured: mocks.configured, auth: mocks.auth }));
vi.mock("@/lib/auth", () => ({ getOrCreateAnonymousUser: mocks.currentUser }));
vi.mock("@/lib/prisma", () => ({ prisma: { anonymousUser: { updateMany: mocks.updateMany, findUniqueOrThrow: mocks.findUnique } } }));
vi.mock("@/lib/storage", () => ({
  getImageExtension: (mime: string) => ({ "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" })[mime] ?? ".bin",
  writeStoredImageAt: mocks.write,
  readStoredImage: mocks.read,
  deleteStoredImage: mocks.del,
}));
import { GET, POST } from "./route";

const google = { id: "sub-1", name: "Mine Kaku", email: "a@example.com", image: "https://example.com/p.png" };
const oldId = "11111111-1111-4111-8111-111111111111";
const row = { id: "u1", googleSub: "sub-1", displayName: null, avatarIcon: "🦊", avatarImage: null };
let stored: string | null = null;
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function upload(bytes: Buffer | string, name = "file") {
  const form = new FormData();
  form.append(name, new Blob([typeof bytes === "string" ? bytes : new Uint8Array(bytes)]), "avatar");
  return new Request("http://localhost/api/account/avatar", { method: "POST", body: form });
}

describe("avatar upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configured.mockReturnValue(true);
    mocks.auth.mockResolvedValue({ user: google });
    mocks.currentUser.mockResolvedValue(row);
    stored = null;
    mocks.write.mockImplementation(async (path: string) => { stored = path; });
    mocks.del.mockResolvedValue(undefined);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockImplementation(async () => ({ ...row, avatarImage: stored, avatarIcon: null }));
  });

  it("stores the photo under the user's own folder and replaces the emoji icon", async () => {
    const response = await POST(upload(png));
    expect(response.status).toBe(201);
    const [path, buffer, mime] = mocks.write.mock.calls[0];
    expect(path).toMatch(/^avatars\/u1\/[0-9a-f-]{36}\.png$/);
    expect(mime).toBe("image/png");
    expect(buffer.equals(png)).toBe(true);
    // 読んだときの写真（なし）のままの場合だけ差し替える
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: "u1", avatarImage: null }, data: { avatarImage: path, avatarIcon: null } });
    const body = await response.json();
    expect(body.user.avatarUrl).toMatch(/^\/api\/account\/avatar\?v=[0-9a-f-]{36}$/);
    expect(body.user.icon).toBeNull();
  });

  it("deletes the previous photo after replacing it", async () => {
    mocks.currentUser.mockResolvedValue({ ...row, avatarImage: `avatars/u1/${oldId}.webp` });
    await POST(upload(png));
    expect(mocks.del).toHaveBeenCalledWith(`avatars/u1/${oldId}.webp`);
  });

  it("keeps the other tab's photo and removes its own new file when two uploads race", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const response = await POST(upload(png));
    expect(response.status).toBe(409);
    expect(mocks.del).toHaveBeenCalledTimes(1);
    expect(mocks.del).toHaveBeenCalledWith(mocks.write.mock.calls[0][0]);
  });

  it("removes the new file again if the database update fails", async () => {
    mocks.updateMany.mockRejectedValue(new Error("db down"));
    await expect(POST(upload(png))).rejects.toThrow("db down");
    expect(mocks.del).toHaveBeenCalledWith(mocks.write.mock.calls[0][0]);
  });

  it("keeps the committed photo when reading the updated profile fails", async () => {
    mocks.findUnique.mockRejectedValueOnce(new Error("read failed"));
    await expect(POST(upload(png))).rejects.toThrow("read failed");
    expect(mocks.updateMany).toHaveBeenCalled();
    expect(mocks.del).not.toHaveBeenCalledWith(mocks.write.mock.calls[0][0]);
  });

  it("only accepts real images, judged by the content and not by the name", async () => {
    expect((await POST(upload("<svg onload=alert(1)>"))).status).toBe(400);
    expect((await POST(upload("just text"))).status).toBe(400);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("rejects a wrong field name, an oversized photo, and a signed-out visitor", async () => {
    expect((await POST(upload(png, "other"))).status).toBe(400);
    expect((await POST(upload(Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024)])))).status).toBe(413);
    mocks.auth.mockResolvedValue(null);
    expect((await POST(upload(png))).status).toBe(401);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("does not store a photo on an anonymous (not Google-linked) row", async () => {
    mocks.currentUser.mockResolvedValue({ ...row, googleSub: null });
    expect((await POST(upload(png))).status).toBe(401);
    expect(mocks.write).not.toHaveBeenCalled();
  });
});

describe("avatar download", () => {
  const get = (v?: string) => new Request(`http://localhost/api/account/avatar${v ? `?v=${v}` : ""}`);
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configured.mockReturnValue(true);
    mocks.auth.mockResolvedValue({ user: google });
    mocks.currentUser.mockResolvedValue({ ...row, avatarImage: `avatars/u1/${oldId}.png` });
    mocks.read.mockResolvedValue(png);
  });

  it("returns only the signed-in user's own photo, cached for the current version", async () => {
    const response = await GET(get(oldId));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(mocks.read).toHaveBeenCalledWith(`avatars/u1/${oldId}.png`);
  });

  it("does not cache a stale or missing version", async () => {
    expect((await GET(get("22222222-2222-4222-8222-222222222222"))).headers.get("Cache-Control")).toBe("private, no-store");
    expect((await GET(get())).headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("is a 404 without a photo, when signed out, or when the file is gone", async () => {
    mocks.currentUser.mockResolvedValue({ ...row, avatarImage: null });
    expect((await GET(get())).status).toBe(404);
    mocks.currentUser.mockResolvedValue({ ...row, avatarImage: `avatars/u1/${oldId}.png` });
    mocks.read.mockRejectedValue(new Error("gone"));
    expect((await GET(get(oldId))).status).toBe(404);
    mocks.auth.mockResolvedValue(null);
    expect((await GET(get(oldId))).status).toBe(404);
  });
});
