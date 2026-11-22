import { describe, expect, it } from "vitest";
import { extractNoteChunks, inlineText, leadingText, MAX_CHUNK_CHARS, MAX_CHUNKS_PER_NOTE, MIN_HEADING_SPLIT_CHARS, walkBlocks } from "./note-text";

const text = (value: string, styles = {}) => ({ type: "text", text: value, styles });
const link = (...content: unknown[]) => ({ type: "link", href: "https://example.com", content });
const block = (id: string | undefined, type: string, content: unknown[] | undefined, children: unknown[] = []) => ({ id, type, props: {}, content, children });

describe("note-text helpers", () => {
  it("walks blocks in document order without recursion limits", () => {
    let deepest: unknown = block("leaf", "paragraph", [text("end")]);
    for (let depth = 0; depth < 15_000; depth++) deepest = block(`n${depth}`, "paragraph", [text("x")], [deepest]);
    const ids = [...walkBlocks([deepest])].map((b) => b.id);
    expect(ids[0]).toBe("n14999");
    expect(ids.at(-1)).toBe("leaf");
  });

  it("extracts inline text from styled spans, links and tables", () => {
    expect(inlineText([text("hello "), link(text("world", { bold: true }))])).toBe("hello world");
    expect(inlineText({ rows: [{ cells: [[text("A")], [text("B")]] }, { cells: [[text("C")], [text("D")]] }] })).toBe("A B C D");
    expect(leadingText([block("a", "paragraph", [text("First")]), block("b", "paragraph", [text("Second")])])).toBe("First Second");
  });

  it("returns empty chunks for blank or Untitled notes with no body", () => {
    expect(extractNoteChunks("Untitled", [])).toEqual([]);
    expect(extractNoteChunks("   ", [block("a", "paragraph", [])])).toEqual([]);
  });

  it("emits one title-only chunk when title is meaningful and body is empty", () => {
    expect(extractNoteChunks("2026 Tokyo Trip", [])).toEqual([
      { chunkIndex: 0, blockId: null, chunkText: "", embedInput: "2026 Tokyo Trip" },
    ]);
  });

  it("prefixes meaningful title onto chunks and splits on headings once chunk reaches threshold", () => {
    const blocks = [
      block("h1", "heading", [text("Section 1")]),
      block("p1", "paragraph", [text("a".repeat(MIN_HEADING_SPLIT_CHARS))]),
      block("h2", "heading", [text("Section 2")]),
      block("p2", "paragraph", [text("Details here")]),
    ];
    const chunks = extractNoteChunks("House Inspection", blocks);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ chunkIndex: 0, blockId: "h1" });
    expect(chunks[0].embedInput).toMatch(/^House Inspection\n\nSection 1 /);
    expect(chunks[1]).toMatchObject({ chunkIndex: 1, blockId: "h2", chunkText: "Section 2 Details here", embedInput: "House Inspection\n\nSection 2 Details here" });
  });

  it("splits oversized blocks safely without breaking surrogate pairs and caps chunk count", () => {
    const emojis = "🎉".repeat(MAX_CHUNK_CHARS);
    const chunks = extractNoteChunks("Untitled", [block("b1", "paragraph", [text(emojis)])]);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) {
      // サロゲートペアが途中で切れていないこと（単独の上位・下位サロゲートが無い）。
      expect(chunk.chunkText).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
      expect(chunk.embedInput).toBe(chunk.chunkText);
    }

    const huge = Array.from({ length: MAX_CHUNKS_PER_NOTE + 8 }, (_, index) => block(`b${index}`, "paragraph", [text("x".repeat(MAX_CHUNK_CHARS))]));
    expect(extractNoteChunks("Huge", huge)).toHaveLength(MAX_CHUNKS_PER_NOTE);
  });
});
