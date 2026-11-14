import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn(), url: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getOrCreateUser: async () => ({ id: "owner" }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { attachment: { findFirst: mocks.find } } }));
vi.mock("@/lib/storage", () => ({ getStoredImageReadUrl: mocks.url, readStoredImage: mocks.read }));
import { GET } from "./route";
const context = { params: Promise.resolve({ attachmentId: "attachment" }) };
describe("private attachment image reads", () => {
  beforeEach(() => vi.clearAllMocks());
  it("checks owner before issuing a read redirect and does not proxy large bytes", async () => {
    mocks.find.mockResolvedValue({ imageStoragePath: "images/owned.png", mimeType: "image/png" });
    mocks.url.mockResolvedValue("https://private.example/owned.png?short-lived-signature");
    const result = await GET(new Request("http://localhost/image"), context);
    expect(mocks.find.mock.calls[0][0].where.message.session.userId).toBe("owner");
    expect(result.status).toBe(302);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(mocks.url).toHaveBeenCalledWith("images/owned.png");
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("does not grant read access for missing or other-owner attachments", async () => {
    mocks.find.mockResolvedValue(null);
    expect((await GET(new Request("http://localhost/image"), context)).status).toBe(404);
    expect(mocks.url).not.toHaveBeenCalled();
  });
});
