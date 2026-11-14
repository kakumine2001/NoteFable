import { describe, expect, it } from "vitest";
import { validateNoteContent } from "./note-document";
import { blocksToMarkdown, markdownToBlocks, type NoteBlock } from "./note-markdown";
import { applyPageEdits, MAX_EDITS, PageEditError } from "./page-edit";

// 番号: [1] Title [2] intro [3] a [4] a1 [5] b [6] last
const page = () => markdownToBlocks("# Title\nintro\n- a\n  - a1\n- b\nlast") as NoteBlock[];
const md = (blocks: NoteBlock[]) => blocksToMarkdown(blocks);

describe("applyPageEdits", () => {
  it("replaces, inserts and deletes against the numbering of the original read", () => {
    const { blocks, changes } = applyPageEdits(page(), [
      { op: "replace", block: 2, markdown: "**new intro**" },
      { op: "delete", block: 5, markdown: null },
      { op: "insert_after", block: 6, markdown: "- appended" },
      { op: "insert_after", block: 0, markdown: "> first" },
    ]);
    expect(md(blocks)).toBe("> first\n# Title\n**new intro**\n- a\n  - a1\nlast\n- appended");
    expect(changes).toEqual([
      { op: "replace", block: 2, before: "intro", after: "**new intro**" },
      { op: "delete", block: 5, before: "- b" },
      { op: "insert_after", block: 6, after: "- appended" },
      { op: "insert_after", block: 0, after: "> first" },
    ]);
    expect(() => validateNoteContent({ title: "t", blocks })).not.toThrow();
  });

  it("replaces a block together with its children and keeps untouched ids", () => {
    const original = page();
    const { blocks } = applyPageEdits(original, [{ op: "replace", block: 3, markdown: "- only" }]);
    expect(md(blocks)).toBe("# Title\nintro\n- only\n- b\nlast");
    expect(blocks[0].id).toBe(original[0].id);
  });

  it("inserts a nested block as a sibling at the same level and keeps the order of several inserts", () => {
    const { blocks } = applyPageEdits(page(), [
      { op: "insert_after", block: 4, markdown: "- a2" },
      { op: "insert_after", block: 4, markdown: "- a3" },
    ]);
    expect(md(blocks)).toBe("# Title\nintro\n- a\n  - a1\n  - a2\n  - a3\n- b\nlast");
  });

  it("rejects bad numbers, ops and markdown with messages the model can act on", () => {
    const run = (edits: unknown) => () => applyPageEdits(page(), edits);
    expect(run("nope")).toThrow(PageEditError);
    expect(run([{ op: "replace", block: 0, markdown: "x" }])).toThrow(/block number from read_note \(1-6\)/);
    expect(run([{ op: "replace", block: 7, markdown: "x" }])).toThrow(/1-6/);
    expect(run([{ op: "insert_after", block: 7, markdown: "x" }])).toThrow(/0 for the start/);
    expect(run([{ op: "rename", block: 1, markdown: "x" }])).toThrow(/op must be one of/);
    expect(run([{ op: "replace", block: 1, markdown: "  " }])).toThrow(/markdown is required/);
    expect(run([{ op: "replace", block: 1, markdown: "x".repeat(20_001) }])).toThrow(/longer than/);
    expect(run(Array.from({ length: 4 }, () => ({ op: "insert_after", block: 1, markdown: "x".repeat(19_000) })))).toThrow(/in total/);
    expect(run(Array.from({ length: MAX_EDITS + 1 }, () => ({ op: "delete", block: 1, markdown: null })))).toThrow(/At most/);
  });

  it("rejects conflicting edits", () => {
    const run = (edits: unknown) => () => applyPageEdits(page(), edits);
    expect(run([{ op: "replace", block: 2, markdown: "x" }, { op: "delete", block: 2, markdown: null }])).toThrow(/more than once/);
    expect(run([{ op: "delete", block: 3, markdown: null }, { op: "replace", block: 4, markdown: "x" }])).toThrow(/inside a block/);
    expect(run([{ op: "replace", block: 3, markdown: "x" }, { op: "insert_after", block: 4, markdown: "y" }])).toThrow(/inside a block/);
  });

  it("allows inserting after a block that is replaced or deleted", () => {
    const { blocks } = applyPageEdits(page(), [
      { op: "delete", block: 2, markdown: null },
      { op: "insert_after", block: 2, markdown: "after deleted" },
    ]);
    expect(md(blocks)).toBe("# Title\nafter deleted\n- a\n  - a1\n- b\nlast");
  });

  it("keeps block colors and alignment when one block is replaced by the same type, and warns about lost inline formatting", () => {
    const blocks = markdownToBlocks("plain\nfancy") as NoteBlock[];
    blocks[1].props = { textColor: "red", textAlignment: "center" };
    blocks[1].content = [{ type: "text", text: "fancy", styles: { underline: true } }];
    const { blocks: next, changes } = applyPageEdits(blocks, [{ op: "replace", block: 2, markdown: "fancier" }, { op: "replace", block: 1, markdown: "# now a heading" }]);
    expect(next[1].props).toEqual({ textColor: "red", textAlignment: "center" });
    expect(next[0].type).toBe("heading");
    expect(changes[0].dropsFormatting).toBe(true);
    expect(changes[1].dropsFormatting).toBeUndefined();
    expect(() => validateNoteContent({ title: "t", blocks: next })).not.toThrow();
  });

  it("warns when a replaced block's children carry colors that cannot be kept", () => {
    const blocks = markdownToBlocks("- parent\n  - child") as NoteBlock[];
    ((blocks[0].children as NoteBlock[])[0]).props = { backgroundColor: "yellow" };
    expect(applyPageEdits(blocks, [{ op: "replace", block: 1, markdown: "- parent" }]).changes[0].dropsFormatting).toBe(true);
  });

  it("keeps a table's header settings and column widths when it is replaced by a table, and warns about cell formatting", () => {
    type Table = { headerRows?: number; headerCols?: number; columnWidths: unknown[]; rows: { cells: { props: Record<string, unknown> }[] }[] };
    const table = () => {
      const blocks = markdownToBlocks("| a | b |\n| --- | --- |\n| c | d |\n| e | f |") as NoteBlock[];
      const content = blocks[0].content as Table;
      delete content.headerRows;
      content.headerCols = 1;
      content.columnWidths = [120, 300];
      return { blocks, content };
    };
    const plain = table();
    const edited = applyPageEdits(plain.blocks, [{ op: "replace", block: 1, markdown: "| a | b |\n| --- | --- |\n| c | D |" }]);
    expect(edited.blocks[0].content).toMatchObject({ headerCols: 1, columnWidths: [120, 300] });
    expect(edited.blocks[0].content).not.toHaveProperty("headerRows");
    expect(edited.changes[0].dropsFormatting).toBeUndefined();
    expect(() => validateNoteContent({ title: "t", blocks: edited.blocks })).not.toThrow();
    // 列数が変わったら列幅は引き継がない。
    const wider = applyPageEdits(table().blocks, [{ op: "replace", block: 1, markdown: "| a | b | c |\n| --- | --- | --- |" }]);
    expect(wider.blocks[0].content).toMatchObject({ headerCols: 1, columnWidths: [null, null, null] });
    // セルの色や結合は Markdown で表せないので警告する。
    const colored = table();
    colored.content.rows[1].cells[0].props.backgroundColor = "yellow";
    expect(applyPageEdits(colored.blocks, [{ op: "replace", block: 1, markdown: "| a | b |\n| --- | --- |" }]).changes[0].dropsFormatting).toBe(true);
  });

  it("does not modify the input blocks", () => {
    const original = page();
    const snapshot = JSON.stringify(original);
    applyPageEdits(original, [{ op: "delete", block: 1, markdown: null }]);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});
