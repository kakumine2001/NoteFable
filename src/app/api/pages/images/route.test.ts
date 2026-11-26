import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrCreateUser: vi.fn(),
  createImageApiGeneration: vi.fn(),
  createImageApiEdit: vi.fn(),
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
  createImageApiEdit: mocks.createImageApiEdit,
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
const SAMPLE_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const SAMPLE_PNG_BASE64 = SAMPLE_PNG_BYTES.toString("base64");
const SAMPLE_JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const SAMPLE_GIF_BYTES = Buffer.from("GIF89a\x01\x00\x01\x00", "latin1");

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/pages/images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeMultipartRequest(fields: { prompt?: string; size?: string; referenceImage?: File | string }, headers?: Record<string, string>) {
  const form = new FormData();
  if (fields.prompt !== undefined) form.set("prompt", fields.prompt);
  if (fields.size !== undefined) form.set("size", fields.size);
  if (fields.referenceImage !== undefined) form.set("referenceImage", fields.referenceImage);
  return new Request("http://localhost/api/pages/images", {
    method: "POST",
    headers,
    body: form,
  });
}

describe("POST /api/pages/images", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOrCreateUser.mockResolvedValue({ id: "user-1" });
    mocks.assertStorageRoom.mockResolvedValue(undefined);
    mocks.consumeUsage.mockResolvedValue({ ok: true, ticket: { id: "ticket-1" } });
    mocks.createImageApiGeneration.mockResolvedValue({ data: [{ b64_json: SAMPLE_PNG_BASE64 }] });
    mocks.createImageApiEdit.mockResolvedValue({ data: [{ b64_json: SAMPLE_PNG_BASE64 }] });
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
    expect(typeof json.reportToken).toBe("string");
    expect(json.reportToken.length).toBeGreaterThan(20);
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

  it("generates an image from a multipart sketch reference without persisting the reference image", async () => {
    const sketch = new File([SAMPLE_PNG_BYTES], "sketch.png", { type: "image/png" });
    const response = await POST(makeMultipartRequest({ prompt: "watercolor illustration", size: "1536x1024", referenceImage: sketch }));
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json).toMatchObject({
      name: "ai-image.png",
      mimeType: "image/png",
      prompt: "watercolor illustration",
    });
    expect(typeof json.reportToken).toBe("string");
    expect(mocks.createImageApiGeneration).not.toHaveBeenCalled();
    expect(mocks.createImageApiEdit).toHaveBeenCalledTimes(1);
    const [editPrompt, editSize, editQuality, editInputs] = mocks.createImageApiEdit.mock.calls[0];
    expect(editPrompt).toContain("watercolor illustration");
    expect(editSize).toBe("1536x1024");
    expect(editQuality).toBe("auto");
    expect(editInputs).toHaveLength(1);
    expect(editInputs[0]).toMatchObject({ filename: "sketch.png", mimeType: "image/png" });
    // Only the generated image is persisted; the reference sketch is never written to storage.
    expect(mocks.storeFile).toHaveBeenCalledTimes(1);
    expect(mocks.storeFile).toHaveBeenCalledWith(
      { id: "user-1" },
      expect.objectContaining({ kind: "NOTE_FILE", mimeType: "image/png" }),
      { enforce: false },
    );
  });

  it("allows omitting the prompt when referenceImage is present and accepts size auto", async () => {
    const sketch = new File([SAMPLE_JPEG_BYTES], "board.jpg", { type: "image/jpeg" });
    const response = await POST(makeMultipartRequest({ size: "auto", referenceImage: sketch }));
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.prompt.length).toBeGreaterThan(10);
    expect(mocks.createImageApiEdit).toHaveBeenCalledWith(
      expect.stringContaining("sketch"),
      "auto",
      "auto",
      [expect.objectContaining({ mimeType: "image/jpeg" })],
    );
  });

  it("rejects unsupported reference formats (GIF / non-image) and oversized sketches before consuming usage", async () => {
    const gif = new File([SAMPLE_GIF_BYTES], "anim.gif", { type: "image/png" });
    expect((await POST(makeMultipartRequest({ referenceImage: gif }))).status).toBe(400);

    const text = new File([Buffer.from("not an image")], "fake.png", { type: "image/png" });
    expect((await POST(makeMultipartRequest({ referenceImage: text }))).status).toBe(400);

    const huge = new File([Buffer.concat([SAMPLE_PNG_BYTES, Buffer.alloc(4 * 1024 * 1024)])], "huge.png", { type: "image/png" });
    expect((await POST(makeMultipartRequest({ referenceImage: huge }))).status).toBe(413);

    const tooLongPrompt = new File([SAMPLE_PNG_BYTES], "sketch.png", { type: "image/png" });
    expect((await POST(makeMultipartRequest({ prompt: "a".repeat(4001), referenceImage: tooLongPrompt }))).status).toBe(400);

    expect(mocks.consumeUsage).not.toHaveBeenCalled();
    expect(mocks.createImageApiEdit).not.toHaveBeenCalled();
  });

  it("retries createImageApiEdit once on transient failure and refunds quota when both attempts fail", async () => {
    const sketch = new File([SAMPLE_PNG_BYTES], "sketch.png", { type: "image/png" });
    mocks.createImageApiEdit
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({ data: [{ b64_json: SAMPLE_PNG_BASE64 }] });
    const ok = await POST(makeMultipartRequest({ prompt: "clean diagram", referenceImage: sketch }));
    expect(ok.status).toBe(201);
    expect(mocks.createImageApiEdit).toHaveBeenCalledTimes(2);
    expect(mocks.refundUsage).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.getOrCreateUser.mockResolvedValue({ id: "user-1" });
    mocks.assertStorageRoom.mockResolvedValue(undefined);
    mocks.consumeUsage.mockResolvedValue({ ok: true, ticket: { id: "ticket-2" } });
    mocks.createImageApiEdit.mockRejectedValue(new Error("down"));
    const failed = await POST(makeMultipartRequest({ prompt: "clean diagram", referenceImage: sketch }));
    expect(failed.status).toBe(502);
    expect(mocks.createImageApiEdit).toHaveBeenCalledTimes(2);
    expect(mocks.refundUsage).toHaveBeenCalledTimes(1);
    expect(mocks.refundUsage).toHaveBeenCalledWith({ id: "ticket-2" });
  });
});
