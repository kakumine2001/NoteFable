import { describe, expect, it, vi } from "vitest";

// ブロック検証は純粋な処理なので、DB と Cookie には触らせない。
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ getOrCreateAnonymousUser: vi.fn() }));

const { buildOrderedNotionBlocks, parseNotionSaveBlocks, parseStoredBlocks } = await import(
  "./notion-saves"
);

const MIB = 1024 * 1024;

describe("parseNotionSaveBlocks", () => {
  it("keeps text and files in the given order", () => {
    const result = parseNotionSaveBlocks(
      [
        { type: "text", text: "  intro  " },
        { type: "file", filename: "chart.png", mimeType: "image/png", size: 2048 },
        { type: "text", text: "outro" },
      ],
      5 * MIB,
    );

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.parsed.blocks).toEqual([
      { type: "text", text: "intro" },
      { type: "file", fileIndex: 0 },
      { type: "text", text: "outro" },
    ]);
    expect(result.parsed.files).toEqual([
      { filename: "chart.png", mimeType: "image/png", size: 2048, blockType: "image" },
    ]);
  });

  it("accepts a draft made only of files", () => {
    const result = parseNotionSaveBlocks(
      [{ type: "file", filename: "report.pdf", mimeType: "application/pdf", size: 10 }],
      5 * MIB,
    );

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.parsed.files[0].blockType).toBe("file");
  });

  it("rejects an empty draft", () => {
    expect(parseNotionSaveBlocks([], 5 * MIB)).toEqual({
      ok: false,
      error: "Content is required.",
    });
    expect(parseNotionSaveBlocks([{ type: "text", text: "   " }], 5 * MIB)).toEqual({
      ok: false,
      error: "Add text or a file before saving.",
    });
  });

  it("enforces the workspace limit on the server as well", () => {
    const result = parseNotionSaveBlocks(
      [{ type: "file", filename: "clip.mp4", mimeType: "video/mp4", size: 5 * MIB + 1 }],
      5 * MIB,
    );

    expect(result.ok).toBe(false);
  });

  it("rejects a size that is not a safe integer", () => {
    const result = parseNotionSaveBlocks(
      [{ type: "file", filename: "clip.mp4", mimeType: "video/mp4", size: Number.NaN }],
      5 * MIB,
    );

    expect(result.ok).toBe(false);
  });

  it("rejects an unknown block shape", () => {
    expect(parseNotionSaveBlocks([{ type: "image", url: "https://example.com" }], 5 * MIB)).toEqual({
      ok: false,
      error: "Content is invalid.",
    });
  });
});

describe("parseStoredBlocks", () => {
  it("reads back the ordered blocks and ignores unknown entries", () => {
    expect(
      parseStoredBlocks([
        { type: "text", text: "intro" },
        { type: "file", fileId: "f1" },
        { type: "file" },
        null,
      ]),
    ).toEqual([{ type: "text", text: "intro" }, { type: "file", fileId: "f1" }]);
  });
});

describe("buildOrderedNotionBlocks", () => {
  it("maps file blocks to uploaded Notion files and drops the ones still missing", () => {
    const blocks = [
      { type: "text" as const, text: "intro" },
      { type: "file" as const, fileId: "f1" },
      { type: "file" as const, fileId: "f2" },
    ];
    const files = new Map([
      ["f1", { filename: "chart.png", blockType: "image", notionFileUploadId: "u1" }],
      ["f2", { filename: "report.pdf", blockType: "file", notionFileUploadId: null }],
    ]);

    expect(buildOrderedNotionBlocks(blocks, files)).toEqual([
      { type: "text", text: "intro" },
      { type: "file", filename: "chart.png", fileUploadId: "u1", blockType: "image" },
    ]);
  });
});
