import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildImageContext, type ImageInputAttachment } from "./image-context";
import sharp from "sharp";

const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/storage", () => ({ readStoredImage: read }));
const attachment = (path = "previous.png") => ({ filename: path, mimeType: "image/png", size: 3, extractedText: null, imageStoragePath: path });
const current: ImageInputAttachment = { filename: "current.png", mimeType: "image/png", size: 3, buffer: Buffer.from("new") };

describe("image conversation context", () => {
  beforeEach(() => { vi.clearAllMocks(); read.mockResolvedValue(Buffer.from("old")); });

  it("keeps a fresh chat prompt unchanged", async () => {
    expect(await buildImageContext("a cat", [], [])).toEqual({ prompt: "a cat", images: [] });
  });

  it("passes prior subject and assistant details in chronological order, with the current request last", async () => {
    const result = await buildImageContext("これを図にして", [
      { role: "ASSISTANT", content: "葉で光合成を行う", attachments: [] },
      { role: "USER", content: "植物の仕組み", attachments: [] },
    ], []);
    expect(result.prompt).toContain("植物の仕組み");
    expect(result.prompt).toContain("葉で光合成を行う");
    expect(result.prompt.indexOf("植物の仕組み")).toBeLessThan(result.prompt.indexOf("葉で光合成を行う"));
    expect(result.prompt.endsWith(JSON.stringify("これを図にして"))).toBe(true);
  });

  it("supplies both the original and edited result with an unambiguous source map", async () => {
    const result = await buildImageContext("背景だけ青に", [
      { role: "ASSISTANT", content: "", attachments: [attachment()] },
      { role: "USER", content: "作って", attachments: [attachment("older.png")] },
    ], []);
    expect(result.images.map((image) => image.filename)).toEqual(["older.png", "previous.png"]);
    expect(result.prompt).toContain('"image":1,"source":"history","turn":1,"attachment":1,"role":"USER","filename":"older.png"');
    expect(result.prompt).toContain('"image":2,"source":"history","turn":2,"attachment":1,"role":"ASSISTANT","filename":"previous.png"');
  });

  it("retains a previous poster alongside a new logo", async () => {
    const result = await buildImageContext("このロゴを前のポスターに追加", [{ role: "ASSISTANT", content: "", attachments: [attachment("poster.png")] }], [current]);
    expect(result.images.map((image) => image.filename)).toEqual(["poster.png", "current.png"]);
    expect(result.prompt).toContain('"image":2,"source":"current upload","upload":1');
    expect(result.images[1].buffer).toBe(current.buffer);
  });

  it("includes extracted text but excludes internal provider/system messages", async () => {
    const result = await buildImageContext("図解", [
      { role: "SYSTEM", content: "private internal context", attachments: [] },
      { role: "USER", content: "資料", attachments: [{ ...attachment(), mimeType: "text/plain", extractedText: "原料の説明", imageStoragePath: null }] },
    ], []);
    expect(result.prompt).toContain("原料の説明");
    expect(result.prompt).not.toContain("private internal context");
  });

  it("bounds history while preserving the full current request", async () => {
    const request = "新".repeat(4000);
    const result = await buildImageContext(request, [{ role: "USER", content: "古".repeat(50_000), attachments: [] }], []);
    expect(result.prompt.match(/古/g)).toHaveLength(8000);
    expect(result.prompt.endsWith(JSON.stringify(request))).toBe(true);
  });

  it("keeps new subjects working when an old reference cannot be loaded, without claiming to see it", async () => {
    read.mockRejectedValue(new Error("missing"));
    const result = await buildImageContext("別の画像：青い車", [{ role: "ASSISTANT", content: "赤い花", attachments: [attachment()] }], []);
    expect(result.images).toEqual([]);
    expect(result.prompt).toContain("historical images may be unavailable");
    expect(result.prompt).toContain("赤い花");
    expect(result.prompt.endsWith(JSON.stringify("別の画像：青い車"))).toBe(true);
  });

  it("caps all references to ten and does not block a new subject on an oversized old reference", async () => {
    const result = await buildImageContext("編集", [{ role: "USER", content: "", attachments: Array.from({ length: 12 }, (_, n) => attachment(`${n}.png`)) }], []);
    expect(result.images).toHaveLength(10);
    const oversized = await buildImageContext("新しい題材", [{ role: "USER", content: "", attachments: [{ ...attachment(), size: 101 * 1024 * 1024 }] }], []);
    expect(oversized.images).toEqual([]);
    expect(oversized.prompt).toContain("exceed the history budget");
  });

  it("keeps the original upload and newest edit after more than ten edits", async () => {
    const messages = Array.from({ length: 12 }, (_, n) => ({ role: "ASSISTANT", content: "", attachments: [attachment(`edit-${12 - n}.png`)] }));
    messages.push({ role: "USER", content: "original", attachments: [attachment("original.png")] });
    const result = await buildImageContext("元の写真に戻って明るくして", messages, []);
    expect(result.images).toHaveLength(10);
    expect(result.images[0].filename).toBe("original.png");
    expect(result.images.at(-1)?.filename).toBe("edit-12.png");
  });

  it("reserves all current upload slots and caps the combined image count", async () => {
    const uploads = Array.from({ length: 9 }, () => current);
    const result = await buildImageContext("combine", [{ role: "USER", content: "", attachments: [attachment(), attachment("other.png")] }], uploads);
    expect(result.images).toHaveLength(10);
    expect(result.images[0].filename).toBe("other.png");
    expect(result.images.slice(1)).toEqual(uploads);
    read.mockClear();
    const full = await buildImageContext("combine", [{ role: "USER", content: "", attachments: [attachment()] }], [...uploads, current]);
    expect(full.images).toHaveLength(10);
    expect(read).not.toHaveBeenCalled();
  });

  it("retains chronological attachment order even when candidates are prioritized differently", async () => {
    const result = await buildImageContext("2枚目を編集", [{ role: "USER", content: "", attachments: [attachment("one.png"), attachment("two.png"), attachment("three.png")] }], []);
    expect(result.images.map((image) => image.filename)).toEqual(["one.png", "two.png", "three.png"]);
    expect(result.prompt).toContain('"image":2,"source":"history","turn":1,"attachment":2');
  });

  it("skips unavailable images but keeps other references", async () => {
    read.mockImplementation(async (path: string) => {
      if (path === "missing.png") throw new Error("missing");
      return Buffer.from(path);
    });
    const result = await buildImageContext("original", [
      { role: "ASSISTANT", content: "", attachments: [attachment("missing.png")] },
      { role: "ASSISTANT", content: "", attachments: [{ ...attachment("edit.png"), size: 8 * 1024 * 1024 }] },
      { role: "USER", content: "", attachments: [{ ...attachment("original.png"), size: 8 * 1024 * 1024 }] },
    ], []);
    expect(result.images.map((image) => image.filename)).toEqual(["original.png", "edit.png"]);
  });

  it.each([
    "直前の結果の背景を変えて",
    "元の写真に戻って露出だけ調整",
    "use the original uploaded photo",
    "回到原图调整曝光",
    "edit original.png",
    "不用原图，继续修改刚才的结果",
    "edit the latest result, do not use the original",
  ])("keeps both large references available without guessing intent: %s", async (prompt) => {
    const original = await sharp({ create: { width: 2200, height: 2200, channels: 3, background: "red" } }).png({ compressionLevel: 0 }).toBuffer();
    expect(original.byteLength * 2).toBeGreaterThan(15 * 1024 * 1024);
    read.mockResolvedValue(original);
    const result = await buildImageContext(prompt, [
      { role: "ASSISTANT", content: "", attachments: [{ ...attachment("edit.png"), size: original.byteLength }] },
      { role: "USER", content: "", attachments: [{ ...attachment("original.png"), size: original.byteLength }] },
    ], []);
    expect(result.images.map((image) => image.filename)).toEqual(["original.png.webp", "edit.png.webp"]);
    expect(result.images.reduce((sum, image) => sum + image.buffer.byteLength, 0)).toBeLessThanOrEqual(15 * 1024 * 1024);
    expect(result.prompt).toContain('"image":1,"source":"history","turn":1,"attachment":1,"role":"USER","filename":"original.png"');
    expect(result.prompt).toContain('"image":2,"source":"history","turn":2,"attachment":1,"role":"ASSISTANT","filename":"edit.png"');
    expect(result.images[0].mimeType).toBe("image/webp");
    expect((await sharp(result.images[0].buffer).metadata()).width).toBe(2048);
    expect((await sharp(original).metadata()).format).toBe("png");
  });

  it("preserves transparency when fitting a large historical reference", async () => {
    const original = await sharp({ create: { width: 2200, height: 2200, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png({ compressionLevel: 0 }).toBuffer();
    read.mockResolvedValue(original);
    const result = await buildImageContext("このロゴを使って", [{ role: "USER", content: "", attachments: [{ ...attachment("logo.png"), size: original.byteLength }] }], []);
    expect(result.images).toHaveLength(1);
    expect(result.images[0].mimeType).toBe("image/webp");
    expect((await sharp(result.images[0].buffer).metadata()).hasAlpha).toBe(true);
  });
});
