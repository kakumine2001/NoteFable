import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE } from "./route";
import { noteFileUrl } from "@/lib/note-file-keys";

const mocks = vi.hoisted(() => ({
  userId: "owner1",
  discard: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getOrCreateUser: async () => ({ id: mocks.userId }),
}));

vi.mock("@/lib/stored-files", () => ({
  discardUnreferencedNoteFiles: mocks.discard,
  scheduleStorageMaintenance: vi.fn(),
  storeFile: vi.fn(),
}));

describe("DELETE /api/pages/files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userId = "owner1";
    mocks.discard.mockResolvedValue(2);
  });

  it("deletes unreferenced note files belonging to the current user (accepts raw keys and /api/pages/files URLs)", async () => {
    const key1 = "note-files/owner1/11111111-1111-4111-8111-111111111111.png";
    const key2 = "note-files/owner1/22222222-2222-4222-8222-222222222222.jpg";
    const req = new Request("http://localhost/api/pages/files", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: [key1, noteFileUrl(key2, "photo.jpg")] }),
    });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 2 });
    expect(mocks.discard).toHaveBeenCalledWith("owner1", [key1, key2]);
  });

  it("rejects keys belonging to another user with 404", async () => {
    const otherKey = "note-files/someoneelse/11111111-1111-4111-8111-111111111111.png";
    const req = new Request("http://localhost/api/pages/files", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: [otherKey] }),
    });
    const res = await DELETE(req);
    expect(res.status).toBe(404);
    expect(mocks.discard).not.toHaveBeenCalled();
  });

  it("rejects malformed keys and arrays over 200 entries", async () => {
    const badReq = new Request("http://localhost/api/pages/files", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: ["../secret.png"] }),
    });
    expect((await DELETE(badReq)).status).toBe(404);

    const tooMany = Array.from({ length: 201 }, (_, i) => `note-files/owner1/11111111-1111-4111-8111-${String(i).padStart(12, "0")}.png`);
    const bigReq = new Request("http://localhost/api/pages/files", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: tooMany }),
    });
    expect((await DELETE(bigReq)).status).toBe(400);
    expect(mocks.discard).not.toHaveBeenCalled();
  });
});
