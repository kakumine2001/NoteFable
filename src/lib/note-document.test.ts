import { describe, expect, it } from "vitest";
import { MAX_NOTE_BYTES, readNoteRequest, validateNoteContent, validateNoteUpdate } from "./note-document";

const paragraph = { id: "p1", type: "paragraph", props: { textColor: "default", backgroundColor: "default", textAlignment: "left" }, content: [{ type: "text", text: "中文 日本語", styles: { bold: true } }], children: [] };

describe("page document boundary", () => {
  it("preserves CJK text, block ordering, nested lists and formatting", () => {
    const blocks = [paragraph, { id: "p2", type: "checkListItem", props: { checked: true }, content: [], children: [{ ...paragraph, id: "p3" }] }, { id: "p4", type: "codeBlock", props: { language: "javascript" }, content: [{ type: "text", text: "const a = 1;", styles: {} }], children: [] }, { id: "p5", type: "divider", props: {}, children: [] }];
    expect(validateNoteContent({ title: " 学习笔记 ", blocks })).toEqual({ title: "学习笔记", blocks });
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
