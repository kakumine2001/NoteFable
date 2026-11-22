import { describe, expect, it } from "vitest";
import type { Block } from "@blocknote/core";
import { codeBlockText, copyNoteBlocks, selectedRootBlocks } from "./note-block-actions";
import { validateNoteContent } from "./note-document";

const parent = validateNoteContent({ title: "Test", blocks: [{ id: "a", type: "paragraph", props: {}, content: [{ type: "text", text: "中文", styles: { bold: true } }, { type: "link", href: "https://example.com", content: [{ type: "text", text: "日本語", styles: {} }] }], children: [{ id: "b", type: "paragraph", props: {}, content: [], children: [] }] }] }).blocks[0];

describe("note block operations", () => {
  it("duplicates nested blocks without duplicate IDs or shared references", () => {
    const copy = copyNoteBlocks([parent])[0];
    expect(copy.id).not.toBe(parent.id);
    expect(copy.children[0].id).not.toBe(parent.children[0].id);
    expect(copy.content).toEqual(parent.content);
    expect(copy.content).not.toBe(parent.content);
    expect(() => validateNoteContent({ title: "Test", blocks: [parent, copy] })).not.toThrow();
  });
  it("does not duplicate selected children twice", () => {
    expect(selectedRootBlocks([parent, parent.children[0]])).toEqual([parent]);
  });
  it("preserves all displayed text when converting links and formatting to code", () => {
    const text = codeBlockText(parent);
    expect(text).toBe("中文日本語");
    const code = { ...parent, type: "codeBlock", props: { language: "text" }, content: [{ type: "text", text, styles: {} }] } as Block;
    expect(() => validateNoteContent({ title: "Test", blocks: [code] })).not.toThrow();
  });

  it("preserves inline math latex when converting to code and clones math blocks cleanly", () => {
    const withMath = validateNoteContent({
      title: "Math",
      blocks: [
        { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "Area: ", styles: {} }, { type: "mathInline", props: { latex: "\\pi r^2" } }], children: [] },
        { id: "m1", type: "mathBlock", props: { latex: "E = mc^2" }, children: [] },
      ],
    }).blocks;
    expect(codeBlockText(withMath[0])).toBe("Area: \\pi r^2");
    const copies = copyNoteBlocks(withMath);
    expect(copies[1].id).not.toBe(withMath[1].id);
    expect(copies[1].props).toEqual(withMath[1].props);
    expect(() => validateNoteContent({ title: "Math", blocks: [...withMath, ...copies] })).not.toThrow();
  });
});
