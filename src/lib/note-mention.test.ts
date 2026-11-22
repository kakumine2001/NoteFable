import { describe, expect, it } from "vitest";
import { validateNoteContent } from "@/lib/note-document";
import { blocksToMarkdown, markdownToBlocks } from "@/lib/note-markdown";
import { codeBlockText } from "@/lib/note-block-actions";
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
});
