import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildImageContext, type ImageInputAttachment } from "./image-context";

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

  it("reuses the latest generated image without mixing older references", async () => {
    const result = await buildImageContext("背景だけ青に", [
      { role: "ASSISTANT", content: "", attachments: [attachment()] },
      { role: "USER", content: "作って", attachments: [attachment("older.png")] },
    ], []);
    expect(result.images.map((image) => image.filename)).toEqual(["previous.png"]);
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith("previous.png", 15 * 1024 * 1024);
  });

  it("prefers current explicit references and never reads historical image bytes", async () => {
    const result = await buildImageContext("この写真で", [{ role: "USER", content: "old", attachments: [attachment()] }], [current]);
    expect(result.images).toEqual([current]);
    expect(read).not.toHaveBeenCalled();
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
    expect(result.prompt).toContain("previous image is unavailable");
    expect(result.prompt).toContain("赤い花");
    expect(result.prompt.endsWith(JSON.stringify("別の画像：青い車"))).toBe(true);
  });

  it("caps historical references to three and does not block a new subject on an oversized old reference", async () => {
    const result = await buildImageContext("編集", [{ role: "USER", content: "", attachments: [1, 2, 3, 4].map((n) => attachment(`${n}.png`)) }], []);
    expect(result.images).toHaveLength(3);
    const oversized = await buildImageContext("新しい題材", [{ role: "USER", content: "", attachments: [{ ...attachment(), size: 16 * 1024 * 1024 }] }], []);
    expect(oversized.images).toEqual([]);
    expect(oversized.prompt).toContain("exceeds the history budget");
  });
});
