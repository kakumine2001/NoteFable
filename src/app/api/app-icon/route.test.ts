import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), updateMany: vi.fn(), read: vi.fn(), write: vi.fn(), del: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getOrCreateUser: mocks.user,
  isAccountUser: (user: { googleSub?: string | null; verifiedEmail?: string | null }) => Boolean(user.googleSub || user.verifiedEmail),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { updateMany: mocks.updateMany } } }));
vi.mock("@/lib/storage", () => ({
  StoredImageNotFoundError: class StoredImageNotFoundError extends Error {},
  getImageExtension: (type: string) => ({ "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" })[type] ?? ".bin",
  readStoredImage: mocks.read,
  writeStoredImageAt: mocks.write,
  deleteStoredImage: mocks.del,
}));
import { appIconAccountKey } from "@/lib/account-app-icon";
import { StoredImageNotFoundError } from "@/lib/storage";
import { GET, PUT } from "./route";

const MINE = appIconAccountKey("mine");

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG_URL = `data:image/png;base64,${PNG_BASE64}`;
const GIF_URL = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
const OLD_IMAGE = "app-icons/mine/11111111-1111-1111-1111-111111111111.png";

const put = (body: unknown) => PUT(new Request("http://localhost/api/app-icon", { method: "PUT", body: typeof body === "string" ? body : JSON.stringify(body) }));
const account = (fields: Record<string, unknown> = {}) => ({ id: "mine", googleSub: "g1", verifiedEmail: null, appIcon: null, appIconImage: null, appIconUpdatedAt: null, ...fields });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue(account());
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.write.mockImplementation(async (path: string) => path);
  mocks.del.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("reading the account icon", () => {
  it("reports an icon that was never synced", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ icon: null, updatedAt: null, account: MINE });
  });

  it("gives each account its own opaque key", () => {
    expect(MINE).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(MINE).not.toContain("mine");
    expect(appIconAccountKey("other")).not.toBe(MINE);
  });

  it("returns a character with its update time", async () => {
    mocks.user.mockResolvedValue(account({ appIcon: "character:sora", appIconUpdatedAt: new Date("2026-11-22T00:00:00Z") }));
    expect(await (await GET()).json()).toEqual({ icon: "character:sora", updatedAt: "2026-11-22T00:00:00.000Z", account: MINE });
  });

  it("returns an uploaded image as a data URL read from storage", async () => {
    mocks.user.mockResolvedValue(account({ appIcon: "image", appIconImage: OLD_IMAGE, appIconUpdatedAt: new Date("2026-11-22T00:00:00Z") }));
    mocks.read.mockResolvedValue(Buffer.from(PNG_BASE64, "base64"));
    expect(await (await GET()).json()).toEqual({ icon: PNG_URL, updatedAt: "2026-11-22T00:00:00.000Z", account: MINE });
    expect(mocks.read).toHaveBeenCalledWith(OLD_IMAGE, 64 * 1024);
  });

  it("answers the default icon, keeping the update time, when the stored image is gone", async () => {
    mocks.user.mockResolvedValue(account({ appIcon: "image", appIconImage: OLD_IMAGE, appIconUpdatedAt: new Date("2026-11-22T00:00:00Z") }));
    mocks.read.mockRejectedValue(new StoredImageNotFoundError("Stored image not found."));
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ icon: null, updatedAt: "2026-11-22T00:00:00.000Z", account: MINE });
    expect(console.error).toHaveBeenCalled();
  });

  it("answers 503 when the stored image cannot be read for now", async () => {
    mocks.user.mockResolvedValue(account({ appIcon: "image", appIconImage: OLD_IMAGE, appIconUpdatedAt: new Date() }));
    mocks.read.mockRejectedValue(new Error("blob down"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Could not load your icon." });
  });

  it("refuses a guest", async () => {
    mocks.user.mockResolvedValue(account({ id: "guest", googleSub: null, appIcon: "character:sora" }));
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Sign in to sync your icon." });
  });
});

describe("saving the account icon", () => {
  it("saves a character on the user's own row", async () => {
    const response = await put({ icon: "character:loop" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.icon).toBe("character:loop");
    expect(typeof body.updatedAt).toBe("string");
    expect(body.account).toBe(MINE);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "mine", appIconImage: null },
      data: { appIcon: "character:loop", appIconImage: null, appIconUpdatedAt: expect.any(Date) },
    });
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it.each([[null], [""], ["quill"], ["character:quill"]])("stores the default character as null for %j", async (icon) => {
    expect((await put({ icon })).status).toBe(200);
    expect(mocks.updateMany.mock.calls[0][0].data.appIcon).toBeNull();
  });

  it("stores an image in storage, keeps only the path on the row and removes the old image", async () => {
    mocks.user.mockResolvedValue(account({ appIcon: "image", appIconImage: OLD_IMAGE }));
    const response = await put({ icon: PNG_URL });
    expect(response.status).toBe(200);
    expect((await response.json()).icon).toBe(PNG_URL);
    const [path, bytes, type] = mocks.write.mock.calls[0];
    expect(path).toMatch(/^app-icons\/mine\/[0-9a-f-]{36}\.png$/);
    expect(Buffer.compare(bytes, Buffer.from(PNG_BASE64, "base64"))).toBe(0);
    expect(type).toBe("image/png");
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "mine", appIconImage: OLD_IMAGE },
      data: { appIcon: "image", appIconImage: path, appIconUpdatedAt: expect.any(Date) },
    });
    expect(mocks.del).toHaveBeenCalledWith(OLD_IMAGE);
  });

  it("removes the old image when switching back to a character", async () => {
    mocks.user.mockResolvedValue(account({ appIcon: "image", appIconImage: OLD_IMAGE }));
    expect((await put({ icon: "character:piko" })).status).toBe(200);
    expect(mocks.del).toHaveBeenCalledWith(OLD_IMAGE);
  });

  it("still succeeds when the old image cannot be removed", async () => {
    mocks.user.mockResolvedValue(account({ appIcon: "image", appIconImage: OLD_IMAGE }));
    mocks.del.mockRejectedValue(new Error("blob down"));
    expect((await put({ icon: null })).status).toBe(200);
  });

  it("answers 409 and drops the new image when another device replaced the icon meanwhile", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const response = await put({ icon: PNG_URL });
    expect(response.status).toBe(409);
    expect(mocks.del).toHaveBeenCalledWith(mocks.write.mock.calls[0][0]);
  });

  it("drops the new image and answers 503 when the write fails", async () => {
    mocks.updateMany.mockRejectedValue(new Error("db down"));
    const response = await put({ icon: PNG_URL });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Could not save your icon. Please try again." });
    expect(mocks.del).toHaveBeenCalledWith(mocks.write.mock.calls[0][0]);
  });

  it.each([
    ["a missing field", {}],
    ["a non-string", { icon: 5 }],
    ["an unknown character", { icon: "character:nobody" }],
    ["an old emoji", { icon: "🦊" }],
    ["a GIF", { icon: GIF_URL }],
    ["a non-image disguised as PNG", { icon: `data:image/png;base64,${Buffer.from("hello world").toString("base64")}` }],
    ["a data URL that is not base64", { icon: "data:image/png,abc" }],
    ["an image over 64 KB", { icon: `data:image/png;base64,${Buffer.concat([Buffer.from(PNG_BASE64, "base64"), Buffer.alloc(64 * 1024)]).toString("base64")}` }],
    ["broken JSON", "{"],
  ])("rejects %s without writing", async (_name, body) => {
    expect((await put(body)).status).toBe(400);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an oversized body", async () => {
    expect((await put({ icon: `data:image/png;base64,${"A".repeat(200_000)}` })).status).toBe(413);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it.each([["a valid body", { icon: "character:sora" }], ["a bad body", "{"]])("refuses a guest with %s without writing", async (_name, body) => {
    mocks.user.mockResolvedValue(account({ id: "guest", googleSub: null }));
    expect((await put(body)).status).toBe(401);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("accepts an account that signed in by email", async () => {
    mocks.user.mockResolvedValue(account({ id: "mail", googleSub: null, verifiedEmail: "a@example.test" }));
    expect((await put({ icon: "character:velo" })).status).toBe(200);
    expect(mocks.updateMany.mock.calls[0][0].where).toEqual({ id: "mail", appIconImage: null });
  });
});
