import { describe, expect, it } from "vitest";
import { toParagraphBlocks } from "./notion";

describe("toParagraphBlocks", () => {
  it("splits a long paragraph into bounded blocks", () => {
    const blocks = toParagraphBlocks("a".repeat(4_001));

    expect(blocks).toHaveLength(3);
    expect(blocks.every((block) => block.paragraph.rich_text.length === 1)).toBe(true);
    expect(
      blocks.every(
        (block) => block.paragraph.rich_text[0].text.content.length <= 1_900,
      ),
    ).toBe(true);
    expect(
      blocks.map((block) => block.paragraph.rich_text[0].text.content).join(""),
    ).toBe("a".repeat(4_001));
  });

  it("does not split an emoji surrogate pair across blocks", () => {
    const content = `${"a".repeat(1_899)}📚tail`;
    const blocks = toParagraphBlocks(content);
    const chunks = blocks.map((block) => block.paragraph.rich_text[0].text.content);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe("a".repeat(1_899));
    expect(chunks[1]).toBe("📚tail");
    expect(chunks.join("")).toBe(content);
  });

  it("keeps blank lines as paragraph boundaries and drops empty paragraphs", () => {
    const blocks = toParagraphBlocks(" first \n\n\n second ");

    expect(
      blocks.map((block) => block.paragraph.rich_text[0].text.content),
    ).toEqual(["first", "second"]);
  });
});
