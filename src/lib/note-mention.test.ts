import { describe, expect, it } from "vitest";
import { validateNoteContent } from "@/lib/note-document";
import { blocksToMarkdown, markdownToBlocks } from "@/lib/note-markdown";
import { codeBlockText } from "@/lib/note-block-actions";
import { inlineText } from "@/lib/note-text";
import { noteToMarkdownFile } from "@/lib/note-io";
import { nativeCanOpenPage } from "@/lib/native-bridge";
import { dateMention, isNoteDate, localDate, notePageIdFromUrl, pageMention, validMention } from "@/lib/note-mention";

const paragraph = (content: unknown[]) => ({ id: "b1", type: "paragraph", props: {}, content, children: [] });
const save = (content: unknown[]) => validateNoteContent({ title: "T", icon: null, cover: null, blocks: [paragraph(content)] });

describe("note mentions", () => {
  it("accepts page and date mentions as saved by the editor", () => {
    expect(() => save([{ type: "text", text: "see ", styles: {} }, pageMention("cmabc123", "三分化"), dateMention("2026-11-05")])).not.toThrow();
  });

  it("rejects malformed mentions", () => {
    expect(validMention({ type: "mention", props: { kind: "page", pageId: "../x", title: "", date: "" } })).toBe(false);
    expect(validMention({ type: "mention", props: { kind: "date", pageId: "", title: "", date: "2026-02-30" } })).toBe(false);
    expect(validMention({ type: "mention", props: { kind: "date", pageId: "p", title: "", date: "2026-02-03" } })).toBe(false);
    expect(validMention({ type: "mention", props: { kind: "user", pageId: "", title: "", date: "" } })).toBe(false);
    expect(validMention({ type: "mention", props: { kind: "page", pageId: "p", title: "", date: "" }, content: [] })).toBe(false);
    // リンクの中には置けない。
    expect(() => save([{ type: "link", href: "https://example.com", content: [pageMention("p", "x")] }])).toThrow();
  });

  it("round-trips through the AI markdown", () => {
    const blocks = [paragraph([{ type: "text", text: "Go to ", styles: {} }, pageMention("cm1", "Day [1]"), { type: "text", text: " on ", styles: {} }, dateMention("2026-11-05")])];
    const markdown = blocksToMarkdown(blocks);
    expect(markdown).toBe("Go to [@Day \\[1\\]](page:cm1) on [@2026-11-05](date:2026-11-05)");
    const back = markdownToBlocks(markdown)[0].content as unknown[];
    expect(back).toEqual([{ type: "text", text: "Go to ", styles: {} }, pageMention("cm1", "Day [1]"), { type: "text", text: " on ", styles: {} }, dateMention("2026-11-05")]);
  });

  it("keeps ordinary links and unknown schemes as before", () => {
    expect(markdownToBlocks("[a](https://x.test) [b](page:../bad)")[0].content).toEqual([
      { type: "link", href: "https://x.test", content: [{ type: "text", text: "a", styles: {} }] },
      { type: "text", text: " [b](page:../bad)", styles: {} },
    ]);
  });

  it("turns mentions into text for code blocks", () => {
    expect(codeBlockText({ content: [pageMention("p", "Plan"), { type: "text", text: " ", styles: {} }, dateMention("2026-01-02")] })).toBe("@Plan @2026-01-02");
  });

  it("validates dates and builds local dates", () => {
    expect(isNoteDate("2024-02-29")).toBe(true);
    expect(isNoteDate("2025-02-29")).toBe(false);
    expect(localDate(1, new Date(2026, 11, 31, 23))).toBe("2027-01-01");
  });

  it("reads page ids only from same-origin app links", () => {
    const origin = "https://app.notefable.com";
    expect(notePageIdFromUrl("https://app.notefable.com/app?view=pages&page=cm1", origin)).toBe("cm1");
    expect(notePageIdFromUrl("?view=pages&page=cm2", origin)).toBe("cm2");
    expect(notePageIdFromUrl("https://evil.test/app?view=pages&page=cm1", origin)).toBeNull();
    expect(notePageIdFromUrl("https://app.notefable.com/app?view=chat&page=cm1", origin)).toBeNull();
  });
  it("exposes mention labels to search text", () => {
    expect(inlineText([{ type: "text", text: "see ", styles: {} }, pageMention("p", "三分化"), dateMention("2026-11-05")])).toBe("see 三分化2026-11-05");
  });

  it("only routes page links to apps that say they can open them", () => {
    const post = () => {};
    expect(nativeCanOpenPage({ NoteFableNative: { postMessage: post } })).toBe(false);
    expect(nativeCanOpenPage({ NoteFableNative: { postMessage: post, canOpenPage: () => true } })).toBe(true);
    expect(nativeCanOpenPage({ NoteFableNative: { postMessage: post, canOpenPage: () => { throw new Error("x"); } } })).toBe(false);
    expect(nativeCanOpenPage({})).toBe(false);
  });

  it("writes mentions as plain @text in exported Markdown", () => {
    const file = noteToMarkdownFile({ title: "T", blocks: [paragraph([{ type: "text", text: "See ", styles: {} }, pageMention("cm1", "Day [1]"), { type: "text", text: " ", styles: {} }, dateMention("2026-11-05")])] });
    expect(file.markdown).toContain("See @Day \\[1\\] @2026-11-05");
    expect(file.markdown).not.toContain("page:");
  });

  it("keeps literal mention syntax in code and pipes in table mentions", () => {
    const code = { id: "c", type: "codeBlock", props: {}, content: [{ type: "text", text: "[@Name](page:p1)", styles: {} }], children: [] };
    expect(noteToMarkdownFile({ title: "T", blocks: [code] }).markdown).toContain("[@Name](page:p1)");
    const cell = (content: unknown[]) => ({ type: "tableCell", props: {}, content });
    const table = { id: "t", type: "table", props: {}, children: [], content: { type: "tableContent", rows: [
      { cells: [cell([{ type: "text", text: "a", styles: {} }]), cell([{ type: "text", text: "b", styles: {} }])] },
      { cells: [cell([pageMention("p1", "Sales | Q4")]), cell([{ type: "text", text: "x", styles: {} }])] },
    ] } };
    const back = markdownToBlocks(blocksToMarkdown([table]))[0].content as { rows: { cells: { content: unknown[] }[] }[] };
    expect(back.rows[1].cells.map((c) => c.content)).toEqual([[pageMention("p1", "Sales | Q4")], [{ type: "text", text: "x", styles: {} }]]);
  });
});
