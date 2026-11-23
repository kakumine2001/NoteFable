import { describe, expect, it } from "vitest";
import { normalizeColumns, unwrapColumns } from "./note-columns";
import { validateNoteContent } from "./note-document";
import { blocksToMarkdown, flattenBlocks } from "./note-markdown";
import { noteToMarkdownFile } from "./note-io";
import { applyPageEdits } from "./page-edit";

const p = (id: string, text: string) => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] });
const column = (id: string, children: unknown[], width = 1) => ({ id, type: "column", props: { width }, children });
const columns = (id: string, ...children: unknown[]) => ({ id, type: "columnList", props: {}, children });
const note = (blocks: unknown[]) => ({ title: "Columns", icon: null, cover: null, blocks });

describe("columns", () => {
  const doc = [p("a", "Intro"), columns("l", column("c1", [p("b", "Left")], 1.5), column("c2", [p("c", "Right"), p("d", "More")], 0.5)), p("e", "Outro")];

  it("accepts a column list with two or more columns", () => {
    expect(validateNoteContent(note(doc)).blocks).toHaveLength(3);
  });

  it("rejects malformed column structures", () => {
    const bad = [
      [columns("l", column("c1", [p("b", "Only")]))], // 1 column
      [columns("l", column("c1", [p("b", "x")]), p("y", "not a column"))], // non-column in list
      [column("c1", [p("b", "x")])], // column outside a list
      [columns("l", column("c1", []), column("c2", [p("b", "x")]))], // empty column
      [columns("l", column("c1", [p("b", "x")], 0), column("c2", [p("c", "y")]))], // width 0
      [columns("l", column("c1", [columns("n", column("c3", [p("b", "x")]), column("c4", [p("c", "y")]))]), column("c2", [p("d", "z")]))], // list directly in column
      [{ ...columns("l", column("c1", [p("b", "x")]), column("c2", [p("c", "y")])), props: { width: 1 } }], // props on list
      [{ ...columns("l", column("c1", [p("b", "x")]), column("c2", [p("c", "y")])), content: [] }], // content on list
    ];
    for (const blocks of bad) expect(() => validateNoteContent(note(blocks))).toThrow();
  });

  it("writes column contents in order without numbering the containers", () => {
    expect(blocksToMarkdown(doc)).toBe("Intro\nLeft\nRight\nMore\nOutro");
    expect(blocksToMarkdown(doc, 0, { n: 0 })).toBe("[1] Intro\n[2] Left\n[3] Right\n[4] More\n[5] Outro");
    expect(flattenBlocks(doc).map((block) => block.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("exports columns as separate paragraphs", () => {
    expect(noteToMarkdownFile({ title: "T", blocks: doc }).markdown).toBe("# T\n\nIntro\n\nLeft\n\nRight\n\nMore\n\nOutro\n");
  });

  it("unwraps and normalizes column lists", () => {
    expect(unwrapColumns(doc).map((block) => block.id)).toEqual(["a", "b", "c", "d", "e"]);
    const emptied = [columns("l", column("c1", []), column("c2", [p("c", "Right")]))];
    expect(normalizeColumns(emptied)).toEqual([p("c", "Right")]);
    expect(normalizeColumns([columns("l", column("c1", []), column("c2", []))])).toEqual([]);
    const three = [columns("l", column("c1", []), column("c2", [p("c", "x")]), column("c3", [p("d", "y")]))];
    expect((normalizeColumns(three)[0] as { children: unknown[] }).children).toHaveLength(2);
  });

  it("keeps the structure valid after an AI edit empties a column", () => {
    const { blocks } = applyPageEdits(doc as never, [{ op: "delete", block: 2 }]);
    expect(blocks.map((block) => block.id)).toEqual(["a", "c", "d", "e"]);
    expect(() => validateNoteContent(note(blocks))).not.toThrow();
    const replaced = applyPageEdits(doc as never, [{ op: "replace", block: 3, markdown: "New right" }]).blocks;
    expect(replaced[1].type).toBe("columnList");
    expect(() => validateNoteContent(note(replaced))).not.toThrow();
  });
});
