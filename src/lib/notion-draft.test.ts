import { describe, expect, it } from "vitest";
import {
  appendFiles,
  buildNotionSaveRequest,
  createFileBlocks,
  createTextBlock,
  createTranscriptBlocks,
  hasDraftContent,
  insertFilesAtCaret,
  moveBlock,
  removeBlock,
  type NotionDraftBlock,
} from "./notion-draft";

const MIB = 1024 * 1024;

function textBlock(text: string, id = crypto.randomUUID()): NotionDraftBlock {
  return { id, type: "text", text };
}

function fileBlock(name: string, size = 1024, id = crypto.randomUUID()): NotionDraftBlock {
  return {
    id,
    type: "file",
    entry: { id: crypto.randomUUID(), file: new File([new Uint8Array(size)], name) },
  };
}

function describeBlocks(blocks: NotionDraftBlock[]) {
  return blocks.map((block) =>
    block.type === "text" ? `text:${block.text}` : `file:${block.entry.file.name}`,
  );
}

describe("insertFilesAtCaret", () => {
  it("splits the paragraph at the caret and inserts the file between the halves", () => {
    const blocks = [textBlock("Hello world", "a")];
    const inserted = insertFilesAtCaret(blocks, "a", 5, [new File(["x"], "a.png")]);

    expect(describeBlocks(inserted)).toEqual(["text:Hello", "file:a.png", "text:world"]);
  });

  it("keeps the trailing paragraph when the caret sits at the end", () => {
    const blocks = [textBlock("Done", "a")];
    const inserted = insertFilesAtCaret(blocks, "a", 4, [new File(["x"], "b.pdf")]);

    expect(describeBlocks(inserted)).toEqual(["text:Done", "file:b.pdf"]);
  });

  it("inserts several files in the order they were chosen", () => {
    const blocks = [textBlock("a b", "a")];
    const inserted = insertFilesAtCaret(blocks, "a", 1, [
      new File(["x"], "one.png"),
      new File(["x"], "two.png"),
    ]);

    expect(describeBlocks(inserted)).toEqual([
      "text:a",
      "file:one.png",
      "file:two.png",
      "text:b",
    ]);
  });

  it("appends to the end when the caret block is no longer a text block", () => {
    const blocks = [fileBlock("a.png", 4, "f")];
    const inserted = insertFilesAtCaret(blocks, "f", 0, [new File(["x"], "b.pdf")]);

    expect(describeBlocks(inserted)).toEqual(["file:a.png", "file:b.pdf"]);
  });

  it("leaves the original blocks untouched", () => {
    const blocks = [textBlock("Hello world", "a")];
    insertFilesAtCaret(blocks, "a", 5, [new File(["x"], "a.png")]);

    expect(describeBlocks(blocks)).toEqual(["text:Hello world"]);
  });
});

describe("moveBlock and removeBlock", () => {
  it("moves a file past a paragraph", () => {
    const blocks: NotionDraftBlock[] = [
      textBlock("one", "t1"),
      fileBlock("a.png", 4, "f1"),
      textBlock("two", "t2"),
    ];

    expect(describeBlocks(moveBlock(blocks, "f1", 1))).toEqual([
      "text:one",
      "text:two",
      "file:a.png",
    ]);
    expect(describeBlocks(moveBlock(blocks, "f1", -1))).toEqual([
      "file:a.png",
      "text:one",
      "text:two",
    ]);
  });

  it("returns the same list when the move would leave the draft", () => {
    const blocks: NotionDraftBlock[] = [fileBlock("a.png", 4, "f1")];

    expect(moveBlock(blocks, "f1", -1)).toBe(blocks);
    expect(moveBlock(blocks, "f1", 1)).toBe(blocks);
  });

  it("drops the block the user removed", () => {
    const blocks: NotionDraftBlock[] = [textBlock("one", "t1"), fileBlock("a.png", 4, "f1")];

    expect(describeBlocks(removeBlock(blocks, "f1"))).toEqual(["text:one"]);
  });
});

describe("buildNotionSaveRequest", () => {
  it("keeps the order of paragraphs and files and skips empty paragraphs", () => {
    const blocks: NotionDraftBlock[] = [
      textBlock("  intro  "),
      fileBlock("chart.png", 2048),
      textBlock("   "),
      textBlock("outro"),
    ];
    const request = buildNotionSaveRequest("Title", blocks, 5 * MIB);

    expect(request.ok).toBe(true);
    if (!request.ok) return;

    expect(request.blocks).toEqual([
      { type: "text", text: "intro" },
      { type: "file", filename: "chart.png", mimeType: "application/octet-stream", size: 2048 },
      { type: "text", text: "outro" },
    ]);
    expect(request.files).toHaveLength(1);
  });

  it("allows saving a title with attachments and no text", () => {
    const request = buildNotionSaveRequest("Only files", [fileBlock("a.pdf", 10)], 5 * MIB);

    expect(request.ok).toBe(true);
  });

  it("rejects a draft with nothing to save", () => {
    expect(buildNotionSaveRequest("Title", [textBlock("   ")], 5 * MIB)).toEqual({
      ok: false,
      error: "Add text or a file before saving.",
    });
  });

  it("rejects a file over the workspace limit before uploading anything", () => {
    const request = buildNotionSaveRequest("Title", [fileBlock("big.pdf", 5 * MIB + 1)], 5 * MIB);

    expect(request.ok).toBe(false);
  });
});

describe("createTranscriptBlocks", () => {
  it("splits the conversation transcript at the message separators", () => {
    const blocks = createTranscriptBlocks("User:\nhi\n\n---\n\nAssistant:\nhello");

    expect(describeBlocks(blocks)).toEqual(["text:User:\nhi", "text:Assistant:\nhello"]);
  });

  it("returns an empty block list for an empty conversation", () => {
    expect(describeBlocks(createTranscriptBlocks("   "))).toEqual([]);
  });
});

describe("appendFiles and hasDraftContent", () => {
  it("appends files after the existing blocks", () => {
    const blocks = [textBlock("one")];
    const appended = appendFiles(blocks, [new File(["x"], "a.png")]);

    expect(describeBlocks(appended)).toEqual(["text:one", "file:a.png"]);
  });

  it("treats a file as content even without text", () => {
    expect(hasDraftContent([createTextBlock()])).toBe(false);
    expect(hasDraftContent(createFileBlocks([new File(["x"], "a.png")]))).toBe(true);
  });
});
