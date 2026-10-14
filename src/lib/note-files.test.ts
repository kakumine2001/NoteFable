import { describe, expect, it } from "vitest";
import { NoteValidationError, validateNoteContent } from "./note-document";
import { noteFileKeyParts, noteFileUrl, parseNoteFileUrl, safeFileName } from "./note-file-keys";
import { assertNoteFilesOwner, classifyUpload } from "./note-files";
import { blocksToMarkdown, markdownToBlocks, type NoteBlock } from "./note-markdown";
import { applyPageEdits } from "./page-edit";

const UUID = "00000000-0000-0000-0000-000000000000";
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const url = (owner = "user1", ext = "png", name = "pic.png") => noteFileUrl(`note-files/${owner}/${UUID}.${ext}`, name);
const media = (type: "image" | "file", props: Record<string, unknown> = {}) => ({
  id: `${type}-1`, type, props: { url: url(), name: "pic.png", ...props }, children: [],
});

describe("note file URLs", () => {
  it("round-trips the key and keeps the file name out of the path", () => {
    const parsed = parseNoteFileUrl(url("user1", "pdf", "報告 書.pdf"));
    expect(parsed).toEqual({ path: `note-files/user1/${UUID}.pdf`, ownerId: "user1", extension: "pdf" });
  });

  it("accepts an empty URL (a block waiting for its upload) and rejects everything else", () => {
    expect(parseNoteFileUrl("")).toBe("empty");
    for (const bad of [
      "https://evil.example/x.png", "//evil.example/x.png", "javascript:alert(1)", "/api/pages/files",
      `/api/pages/files?key=note-files/user1/${UUID}.png&extra=1`, `/api/pages/files?key=../../etc/passwd`,
      `/api/pages/files?key=note-files/user1/not-a-uuid.png`, `/api/pages/files?key=note-files/user1/${UUID}.exe-too-long`, 42, null,
    ]) expect(parseNoteFileUrl(bad)).toBeNull();
    expect(noteFileKeyParts("page-covers/user1/x.png")).toBeNull();
  });

  it("cleans file names", () => {
    expect(safeFileName("../../a/b\\c:d*e?.txt")).toBe("cde.txt");
    expect(safeFileName("x".repeat(500)).length).toBe(120);
    expect(safeFileName(undefined)).toBe("");
  });
});

describe("classifyUpload", () => {
  it("recognizes images by their first bytes, whatever the name says", () => {
    expect(classifyUpload(png, "renamed.pdf")).toEqual({ kind: "image", extension: "png" });
  });
  it("accepts allowed documents and rejects code-carrying types", () => {
    const text = Buffer.from("hello");
    expect(classifyUpload(text, "notes.PDF")).toEqual({ kind: "file", extension: "pdf" });
    expect(classifyUpload(text, "data.csv")).toEqual({ kind: "file", extension: "csv" });
    for (const name of ["a.exe", "a.html", "a.svg", "a.js", "a.bat", "noextension", ".pdf.exe"]) expect(classifyUpload(text, name)).toBeNull();
  });
});

describe("image and file blocks in notes", () => {
  it("validates image and file blocks with our own URLs", () => {
    expect(() => validateNoteContent({ title: "t", blocks: [
      media("image", { caption: "cap", showPreview: true, previewWidth: 512, textAlignment: "center", backgroundColor: "default" }),
      { ...media("file"), id: "f1", props: { url: url("user1", "pdf", "a.pdf"), name: "a.pdf" } },
      { ...media("image"), id: "empty", props: { url: "" } },
    ] })).not.toThrow();
  });

  it("rejects external URLs, inline content and unknown props", () => {
    const bad = (block: unknown) => expect(() => validateNoteContent({ title: "t", blocks: [block] })).toThrow(NoteValidationError);
    bad(media("image", { url: "https://tracker.example/pixel.png" }));
    bad({ ...media("image"), content: [{ type: "text", text: "x", styles: {} }] });
    bad(media("image", { onerror: "alert(1)" }));
    bad(media("file", { showPreview: true }));
    bad(media("image", { previewWidth: 99999 }));
    bad(media("image", { caption: "x".repeat(501) }));
  });

  it("refuses files that belong to another user", () => {
    const blocks = [{ id: "p", type: "paragraph", props: {}, children: [media("image", { url: url("someoneelse") })] }];
    expect(() => assertNoteFilesOwner(blocks, "user1")).toThrow(NoteValidationError);
    expect(() => assertNoteFilesOwner([media("image")], "user1")).not.toThrow();
    expect(() => assertNoteFilesOwner([media("image", { url: "" })], "someone-else")).not.toThrow();
  });
});

describe("media blocks and the AI edit tools", () => {
  const page = () => [
    ...(markdownToBlocks("intro") as NoteBlock[]),
    media("image", { caption: "A cat" }) as unknown as NoteBlock,
    { id: "toggle", type: "paragraph", props: {}, content: [], children: [media("file", { name: "a.pdf" }) as unknown as NoteBlock] } as unknown as NoteBlock,
  ];

  it("shows uploads as readable placeholders", () => {
    expect(blocksToMarkdown(page())).toContain("[Image: pic.png — A cat]");
    expect(blocksToMarkdown(page())).toContain("[File: a.pdf]");
  });

  it("lets edits delete or replace an upload, and flags every change that removes one", () => {
    // 番号: [1] intro [2] image [3] 親 [4] file
    const removed = applyPageEdits(page(), [{ op: "delete", block: 2, markdown: null }]);
    expect(blocksToMarkdown(removed.blocks)).not.toContain("[Image:");
    expect(removed.changes[0]).toMatchObject({ op: "delete", before: "[Image: pic.png — A cat]", dropsMedia: true });

    const replaced = applyPageEdits(page(), [{ op: "replace", block: 2, markdown: "text" }]);
    expect(blocksToMarkdown(replaced.blocks)).toContain("text");
    expect(replaced.changes[0].dropsMedia).toBe(true);

    // 親ごと消すと中のファイルも外れる。
    const parent = applyPageEdits(page(), [{ op: "delete", block: 3, markdown: null }]);
    expect(blocksToMarkdown(parent.blocks)).not.toContain("[File:");
    expect(parent.changes[0].dropsMedia).toBe(true);

    // 文字だけのブロックの編集には付かない。
    expect(applyPageEdits(page(), [{ op: "replace", block: 1, markdown: "x" }]).changes[0].dropsMedia).toBeUndefined();
  });

  it("turns an image line with one of our own file URLs into an image block, and nothing else", () => {
    const [image] = markdownToBlocks(`![A cat (small)](${url("user1", "png", "cat (1).png")})`) as unknown as { type: string; props: Record<string, unknown> }[];
    expect(image).toMatchObject({ type: "image", props: { caption: "A cat (small)", name: "cat (1).png", showPreview: true } });
    expect(parseNoteFileUrl(image.props.url)).toMatchObject({ ownerId: "user1", extension: "png" });
    expect(validateNoteContent({ title: "t", blocks: [image] }).blocks).toHaveLength(1);

    // 外部 URL・画像以外・他の書き方は段落のままで、画像ブロックにならない。
    for (const line of [
      "![x](https://tracker.example/pixel.png)", `![x](${url("user1", "pdf", "a.pdf")})`, `![x](${url()}&extra=1)`,
      "![x](/api/pages/files?key=../../etc/passwd&name=a)", `text ![x](${url()})`,
    ]) expect((markdownToBlocks(line)[0] as { type: string }).type).toBe("paragraph");
  });

  it("round-trips an AI-written image into the placeholder an AI would read back", () => {
    const { blocks, changes } = applyPageEdits(page(), [{ op: "insert_after", block: 1, markdown: `![Diagram](${url("user1", "jpg", "d.jpg")})` }]);
    expect(blocksToMarkdown(blocks)).toContain("[Image: d.jpg — Diagram]");
    expect(changes[0].after).toBe("[Image: d.jpg — Diagram]");
  });

  it("still lets edits change other blocks and insert text after an upload", () => {
    const { blocks } = applyPageEdits(page(), [
      { op: "replace", block: 1, markdown: "new intro" },
      { op: "insert_after", block: 2, markdown: "below the image" },
    ]);
    const text = blocksToMarkdown(blocks);
    expect(text.startsWith("new intro\n[Image: pic.png — A cat]\nbelow the image")).toBe(true);
    expect(text).toContain("[File: a.pdf]");
  });
});
