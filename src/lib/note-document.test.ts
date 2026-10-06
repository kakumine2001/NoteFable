import { describe, expect, it } from "vitest";
import { MAX_NOTE_BYTES, readNoteRequest, validateNoteContent, validateNoteUpdate } from "./note-document";

const paragraph = { id: "p1", type: "paragraph", props: { textColor: "default", backgroundColor: "default", textAlignment: "left" }, content: [{ type: "text", text: "中文 日本語", styles: { bold: true } }], children: [] };

describe("page document boundary", () => {
  it("preserves CJK text, block ordering, nested lists and formatting", () => {
    const blocks = [paragraph, { id: "p2", type: "checkListItem", props: { checked: true }, content: [], children: [{ ...paragraph, id: "p3" }] }, { id: "p4", type: "codeBlock", props: { language: "javascript" }, content: [{ type: "text", text: "const a = 1;", styles: {} }], children: [] }, { id: "p5", type: "divider", props: {}, children: [] }];
    expect(validateNoteContent({ title: " 学习笔记 ", blocks })).toEqual({ title: "学习笔记", icon: null, cover: null, coverPosition: null, blocks });
  });

  it.each(["image", "file", "table", "toggleListItem", "html"])("rejects unsupported %s blocks", (type) => {
    expect(() => validateNoteContent({ title: "Test", blocks: [{ ...paragraph, type }] })).toThrow("unsupported");
  });

  it("rejects script links, duplicate IDs and unsupported heading levels", () => {
    expect(() => validateNoteContent({ title: "Test", blocks: [{ ...paragraph, content: [{ type: "link", href: "javascript:alert(1)", content: paragraph.content }] }] })).toThrow();
    expect(() => validateNoteContent({ title: "Test", blocks: [paragraph, paragraph] })).toThrow();
    expect(() => validateNoteContent({ title: "Test", blocks: [{ ...paragraph, type: "heading", props: { level: 6 } }] })).toThrow();
  });

  it("requires a valid optimistic version", () => {
    expect(validateNoteUpdate({ title: "", blocks: [], version: 0 }).title).toBe("Untitled");
    expect(() => validateNoteUpdate({ title: "Test", blocks: [], version: -1 })).toThrow("version");
  });

  it("limits the bytes actually received without trusting Content-Length", async () => {
    const request = new Request("http://localhost/api/pages", { method: "POST", body: "x".repeat(MAX_NOTE_BYTES + 1) });
    await expect(readNoteRequest(request)).rejects.toMatchObject({ status: 413 });
    await expect(readNoteRequest(new Request("http://localhost/api/pages", { method: "POST", body: "{bad" }))).rejects.toThrow("Invalid JSON");
  });
});

describe("page icon and cover", () => {
  it("accepts one emoji icon and a preset cover, and defaults both to null", () => {
    expect(validateNoteContent({ title: "A", blocks: [] })).toMatchObject({ icon: null, cover: null, coverPosition: null });
    expect(validateNoteContent({ title: "A", icon: "📚", cover: "gradient-ocean", blocks: [] })).toMatchObject({ icon: "📚", cover: "gradient-ocean" });
    expect(validateNoteContent({ title: "A", icon: "👍🏽", blocks: [] }).icon).toBe("👍🏽");
  });

  it("rejects text icons and unknown or URL covers", () => {
    expect(() => validateNoteContent({ title: "A", icon: "hello", blocks: [] })).toThrow("emoji");
    expect(() => validateNoteContent({ title: "A", icon: "📚 x", blocks: [] })).toThrow("emoji");
    expect(() => validateNoteContent({ title: "A", cover: "https://example.com/x.png", blocks: [] })).toThrow("cover");
    expect(() => validateNoteContent({ title: "A", cover: "toString", blocks: [] })).toThrow("cover");
  });
});

describe("uploaded page covers", () => {
  const key = "upload:page-covers/cmabc123/0e111e3a-9e25-4944-ade7-b460580fa925.jpg";

  it("accepts an uploaded cover key with a 0-100 position", () => {
    expect(validateNoteContent({ title: "A", cover: key, coverPosition: 30, blocks: [] })).toMatchObject({ cover: key, coverPosition: 30 });
  });

  it("rejects path tricks, other folders and out-of-range positions", () => {
    for (const cover of ["upload:page-covers/../images/x.jpg", "upload:images/2026/01/01/0e111e3a-9e25-4944-ade7-b460580fa925.jpg", "upload:page-covers/a/b/0e111e3a-9e25-4944-ade7-b460580fa925.jpg", `${key}.exe`]) {
      expect(() => validateNoteContent({ title: "A", cover, blocks: [] })).toThrow("cover");
    }
    expect(() => validateNoteContent({ title: "A", cover: key, coverPosition: 101, blocks: [] })).toThrow("position");
    expect(() => validateNoteContent({ title: "A", cover: key, coverPosition: 1.5, blocks: [] })).toThrow("position");
  });
});
