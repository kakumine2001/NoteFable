import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { prepareClaudeImage } from "@/lib/claude-image";
import { prepareAttachments } from "@/lib/files";
const storage = vi.hoisted(() => ({ write: vi.fn().mockResolvedValue("images/original.png") }));
vi.mock("@/lib/storage", () => ({ writeStoredImage: storage.write }));

describe("Claude image input copies", () => {
  it("keeps small compatible image bytes intact", async () => {
    const original = await sharp({ create: { width: 64, height: 64, channels: 3, background: "white" } }).png().toBuffer();
    const result = await prepareClaudeImage(original, "image/png");
    expect(result.buffer).toBe(original);
    expect(result.mimeType).toBe("image/png");
    expect(result.compressed).toBe(false);
  });
  it("stores the exact large PNG original but sends a bounded JPEG copy", async () => {
    const original = await sharp(randomBytes(1536 * 1536 * 3), { raw: { width: 1536, height: 1536, channels: 3 } }).png().toBuffer();
    expect(original.byteLength).toBeGreaterThan(5 * 1024 * 1024);
    const [attachment] = await prepareAttachments([new File([new Uint8Array(original)], "original.png", { type: "image/png" })], 1024 * 1024);
    expect(storage.write.mock.calls.at(-1)?.[0].equals(original)).toBe(true);
    expect(attachment.size).toBe(original.byteLength);
    expect(attachment.mimeType).toBe("image/png");
    expect(attachment.imageInputBytes).toBeLessThanOrEqual(1024 * 1024);
    expect(attachment.imageInputDataUrl).toMatch(/^data:image\/jpeg;base64,/);
    const compressed = Buffer.from(attachment.imageInputDataUrl!.split(",")[1], "base64");
    expect((await sharp(compressed).metadata()).format).toBe("jpeg");
    expect(attachment.imageStoragePath).toBe("images/original.png");
  });
  it("resizes overlong images even if their bytes are small, and rejects undecodable input", async () => {
    const original = await sharp({ create: { width: 9000, height: 4, channels: 3, background: "white" } }).png().toBuffer();
    const result = await prepareClaudeImage(original, "image/png");
    expect((await sharp(result.buffer).metadata()).width).toBeLessThanOrEqual(8000);
    await expect(prepareClaudeImage(Buffer.from("not an image"), "image/png")).rejects.toThrow();
  });
});
