import { describe, expect, it } from "vitest";
import { validateNoteContent } from "@/lib/note-document";
import { isImportableMarkdownFile, markdownFileToNoteContent, noteToMarkdownFile, titleFromFileName } from "./note-io";

describe("note Markdown export and import helpers", () => {
  it("exports a note with H1 heading and safe .md file name", () => {
    const exported = noteToMarkdownFile({
      title: "Project / Roadmap",
      blocks: [
        { id: "b1", type: "paragraph", props: {}, content: [{ type: "text", text: "Hello world", styles: {} }], children: [] },
        { id: "b2", type: "bulletListItem", props: {}, content: [{ type: "text", text: "Item 1", styles: {} }], children: [] },
      ],
    });
    expect(exported.fileName).toBe("Project Roadmap.md");
    expect(exported.markdown).toBe("# Project / Roadmap\n\nHello world\n\n- Item 1\n");
  });

  it("separates blocks with blank lines so other Markdown apps keep them apart, and keeps list items together", () => {
    const text = (id: string, type: string, value: string) => ({ id, type, props: {}, content: [{ type: "text", text: value, styles: {} }], children: [] });
    const exported = noteToMarkdownFile({
      title: "T",
      blocks: [
        text("a", "paragraph", "One"),
        text("b", "paragraph", "Two"),
        { id: "c", type: "divider", props: {}, children: [] },
        text("d", "bulletListItem", "x"),
        text("e", "bulletListItem", "y"),
        text("f", "numberedListItem", "z"),
        text("g", "paragraph", ""),
        text("h", "quote", "q"),
      ],
    });
    expect(exported.markdown).toBe("# T\n\nOne\n\nTwo\n\n---\n\n- x\n- y\n\n1. z\n\n> q\n");
    // 書き出したものを読み戻しても、段落は分かれたまま。
    const back = markdownFileToNoteContent("t.md", exported.markdown).content;
    expect(back.blocks.map((block) => block.type)).toEqual(["paragraph", "paragraph", "divider", "bulletListItem", "bulletListItem", "numberedListItem", "quote"]);
  });

  it("handles empty note bodies cleanly", () => {
    const exported = noteToMarkdownFile({ title: "  ", blocks: [] });
    expect(exported.fileName).toBe("Untitled.md");
    expect(exported.markdown).toBe("# Untitled\n");
  });

  it("extracts leading heading on import without duplicating it in body and passes validateNoteContent", () => {
    const { content, truncated } = markdownFileToNoteContent(
      "notes.md",
      "\uFEFF# Weekly Review\n\n- Ship feature\n- [x] Write tests\n\n![chart](https://example.com/chart.png)\n",
    );
    expect(truncated).toBe(false);
    expect(content.title).toBe("Weekly Review");
    const validated = validateNoteContent(content);
    expect(validated.blocks.length).toBeGreaterThanOrEqual(3);
    // 先頭の見出しは本文に重複しない。
    expect(validated.blocks[0]?.type).toBe("bulletListItem");
  });

  it("keeps a note's own title through export and import", () => {
    const long = "T".repeat(150);
    for (const title of [long, "Release #", "#", "1. First steps", "**Bold** plan", "a_b_c `code` [x](y) <z> ~~s~~", "C:\\temp \\* star", "- [ ] not a task", "> quote"]) {
      const exported = noteToMarkdownFile({ title, blocks: [] });
      expect(markdownFileToNoteContent("x.md", exported.markdown).content.title).toBe(title);
    }
  });

  it("imports a long fenced block and an oversized ragged table without running out of stack or memory", () => {
    const log = `# Log\n\n\`\`\`\n${Array.from({ length: 200_000 }, () => "x").join("\n")}\n\`\`\`\n`;
    const code = markdownFileToNoteContent("log.md", log).content;
    expect(code.blocks).toHaveLength(1);
    expect(code.blocks[0]?.type).toBe("codeBlock");
    // 取り込めたノートは、そのまま書き出せる。
    expect(noteToMarkdownFile({ title: "Log", blocks: code.blocks }).markdown.split("\n").length).toBeGreaterThan(200_000);

    // 見出しが 5000 列、本文が 1 列だけの 5000 行。そろえると 2500 万セルになるので、表にしない。
    const header = `|${"a|".repeat(5000)}`;
    const table = [header, `|${"-|".repeat(5000)}`, ...Array.from({ length: 5000 }, () => "|x|")].join("\n");
    const ragged = markdownFileToNoteContent("t.md", table);
    expect(ragged.content.blocks.some((block) => block.type === "table")).toBe(false);
  });

  it("falls back to filename when markdown has no leading heading", () => {
    const { content } = markdownFileToNoteContent("folder/meeting-notes.markdown", "Action item one\n\n## Details\nBody");
    expect(content.title).toBe("meeting-notes");
    expect(validateNoteContent(content).blocks.length).toBeGreaterThanOrEqual(2);
  });

  it("validates allowed import extensions and strips them cleanly", () => {
    expect(isImportableMarkdownFile("readme.md")).toBe(true);
    expect(isImportableMarkdownFile("DRAFT.MARKDOWN")).toBe(true);
    expect(isImportableMarkdownFile("plain.txt")).toBe(true);
    expect(isImportableMarkdownFile("photo.png")).toBe(false);
    expect(titleFromFileName("path/to/My Notes.md")).toBe("My Notes");
    expect(titleFromFileName(".md")).toBe("Untitled");
  });
});
