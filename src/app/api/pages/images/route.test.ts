import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrCreateUser: vi.fn(),
  createImageApiGeneration: vi.fn(),
  findGeneratedImage: vi.fn(),
  assertStorageRoom: vi.fn(),
  storeFile: vi.fn(),
  scheduleStorageMaintenance: vi.fn(),
  consumeUsage: vi.fn(),
  refundUsage: vi.fn(),
  usageLimitResponse: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getOrCreateUser: mocks.getOrCreateUser }));
vi.mock("@/lib/image-generation", () => ({
  createImageApiGeneration: mocks.createImageApiGeneration,
  findGeneratedImage: mocks.findGeneratedImage,
}));
vi.mock("@/lib/stored-files", () => ({
  assertStorageRoom: mocks.assertStorageRoom,
  storeFile: mocks.storeFile,
  scheduleStorageMaintenance: mocks.scheduleStorageMaintenance,
}));
vi.mock("@/lib/usage-limits", () => ({
  clientNetworkKey: () => "127.0.0.1",
  consumeUsage: mocks.consumeUsage,
  refundUsage: mocks.refundUsage,
  usageLimitResponse: mocks.usageLimitResponse,
}));

import { POST } from "./route";

// Minimal valid 1x1 PNG header bytes that pass sniffImage.
const SAMPLE_PNG_BASE64 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]).toString("base64");

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/pages/images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/pages/images", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOrCreateUser.mockResolvedValue({ id: "user-1" });
    mocks.assertStorageRoom.mockResolvedValue(undefined);
    mocks.consumeUsage.mockResolvedValue({ ok: true, ticket: { id: "ticket-1" } });
    mocks.createImageApiGeneration.mockResolvedValue({ data: [{ b64_json: SAMPLE_PNG_BASE64 }] });
    mocks.findGeneratedImage.mockReturnValue(SAMPLE_PNG_BASE64);
    mocks.storeFile.mockResolvedValue(undefined);
    mocks.refundUsage.mockResolvedValue(undefined);
  });

  it("generates and stores a page image with mimeType for note, whiteboard, and slides", async () => {
    const response = await POST(makeRequest({ prompt: "A calm lighthouse", size: "1024x1024" }));
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json).toMatchObject({
      name: "ai-image.png",
      mimeType: "image/png",
      prompt: "A calm lighthouse",
    });
    expect(json.url).toContain("/api/pages/files?key=note-files%2Fuser-1%2F");
    expect(mocks.createImageApiGeneration).toHaveBeenCalledWith("A calm lighthouse", "1024x1024", "auto");
    expect(mocks.storeFile).toHaveBeenCalledWith(
      { id: "user-1" },
      expect.objectContaining({ kind: "NOTE_FILE", mimeType: "image/png" }),
      { enforce: false },
    );
    expect(mocks.refundUsage).not.toHaveBeenCalled();
  });

  it("refunds usage when upstream image generation fails", async () => {
    mocks.createImageApiGeneration.mockRejectedValue(new Error("upstream failure"));
    const response = await POST(makeRequest({ prompt: "A calm lighthouse", size: "1536x1024" }));
    expect(response.status).toBe(502);
    expect(mocks.refundUsage).toHaveBeenCalledWith({ id: "ticket-1" });
  });

  it("rejects empty prompts before consuming usage", async () => {
    const response = await POST(makeRequest({ prompt: "   " }));
    expect(response.status).toBe(400);
    expect(mocks.consumeUsage).not.toHaveBeenCalled();
  });
});
