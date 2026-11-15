import { describe, expect, it } from "vitest";
import {
  answerConversationUrl,
  answerFileName,
  answerTitle,
  answerToMarkdownFile,
  answerToNoteContent,
  conversationToMarkdownFile,
  isStoredMessageId,
  type AnswerSource,
} from "./answer-export";
import { MAX_NOTE_BYTES, validateNoteContent } from "./note-document";

const source: AnswerSource = {
  conversationTitle: "Weekly sync",
  conversationUrl: "https://studymate.example/?chat=chat12345678901234567890&message=msg12345678901234567890",
  savedAt: new Date(2026, 9, 16, 12, 0, 0),
};

type Node = { id: string; type: string; props: Record<string, unknown>; content?: unknown[]; children: Node[] };
type Inline = { type: string; text?: string; href?: string; content?: Inline[]; styles?: Record<string, unknown> };

const inline = (block: Node) => (block.content ?? []) as Inline[];
const textOf = (block: Node) => inline(block).map((entry) => entry.text ?? inline({ content: entry.content } as Node).map((item) => item.text).join("")).join("");
const flat = (blocks: Node[]): Node[] => blocks.flatMap((block) => [block, ...flat(block.children)]);
const build = (markdown: string, overrides: Partial<AnswerSource> = {}) => answerToNoteContent(markdown, { ...source, ...overrides }) as { title: string; blocks: Node[] };
const expectValid = (result: { title: string; blocks: unknown[] }) =>
  expect(() => validateNoteContent({ title: result.title, icon: null, cover: null, coverPosition: null, blocks: result.blocks })).not.toThrow();
const wellFormed = (text: string) => expect(() => encodeURIComponent(text)).not.toThrow();

describe("answerTitle", () => {
  it("prefers the first heading and drops Markdown markers", () => {
    expect(answerTitle("Some intro.\n\n## Plan for **Q4** with `tools` and [docs](https://x.test)\n\nBody", "Chat")).toBe("Plan for Q4 with tools and docs");
    expect(answerTitle("# Title #\n", "Chat")).toBe("Title");
  });

  it("falls back to the first non-empty line without list, quote or emphasis markers", () => {
    expect(answerTitle("\n\n- **Bold** and _soft_ [link](<https://x.test/a b>) item\n- second", "Chat")).toBe("Bold and soft link item");
    expect(answerTitle("> quoted *line*", "Chat")).toBe("quoted line");
    expect(answerTitle("1. First step\n2. Second", "Chat")).toBe("First step");
  });

  it("ignores headings and text inside code fences", () => {
    expect(answerTitle("```bash\n# not a heading\n```\nReal text", "Chat")).toBe("Real text");
    expect(answerTitle("~~~\n# no\n~~~\n\n# Yes", "Chat")).toBe("Yes");
  });

  it("keeps Japanese and Chinese titles", () => {
    expect(answerTitle("# 週次レポートのまとめ\n本文", "Chat")).toBe("週次レポートのまとめ");
    expect(answerTitle("好的，下面是方案。\n\n1. 第一步", "Chat")).toBe("好的，下面是方案。");
  });

  it("truncates on a character boundary, never inside an emoji", () => {
    const title = answerTitle("😀".repeat(100), "Chat");
    expect(Array.from(title)).toHaveLength(80);
    expect(title.endsWith("…")).toBe(true);
    expect(title.slice(0, -1)).toBe("😀".repeat(79));
    wellFormed(title);

    const family = "👨‍👩‍👧";
    const long = answerTitle(family.repeat(100), "Chat");
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long.endsWith("…")).toBe(true);
    expect(long.slice(0, -1)).toMatch(new RegExp(`^(?:${family})+$`));
    wellFormed(long);
  });

  it("cuts long Japanese text at about 80 characters", () => {
    const title = answerTitle("あ".repeat(120), "Chat");
    expect(Array.from(title)).toHaveLength(80);
    expect(title.endsWith("…")).toBe(true);
  });

  it("uses the fallback for empty or symbol-only answers, and is never empty or longer than 200", () => {
    expect(answerTitle("", "My chat")).toBe("My chat");
    expect(answerTitle("---\n***\n| --- |", "My chat")).toBe("My chat");
    expect(answerTitle("```\ncode only\n```", "My chat")).toBe("My chat");
    expect(answerTitle("", "")).toBe("Untitled");
    expect(answerTitle("  \n ", "   ")).toBe("Untitled");
    const long = answerTitle("", "x".repeat(500));
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("message ids and conversation links", () => {
  it("tells database ids from the temporary ids of a message that was just streamed", () => {
    expect(isStoredMessageId("cmgx9k2a00001abcd1234efgh")).toBe(true);
    expect(isStoredMessageId(crypto.randomUUID())).toBe(false);
    expect(isStoredMessageId("")).toBe(false);
  });

  it("links to the conversation, and to the message only when it is stored", () => {
    expect(answerConversationUrl("https://app.example", "sess123")).toBe("https://app.example/?chat=sess123");
    expect(answerConversationUrl("https://app.example", "sess123", "cmgx9k2a00001abcd1234efgh")).toBe("https://app.example/?chat=sess123&message=cmgx9k2a00001abcd1234efgh");
    expect(answerConversationUrl("https://app.example", "sess123", crypto.randomUUID())).toBe("https://app.example/?chat=sess123");
    expect(answerConversationUrl("https://app.example", "sess123", null)).toBe("https://app.example/?chat=sess123");
  });
});

describe("answerFileName extension and footer escaping", () => {
  it("does not double the extension when the title already ends in .md", () => {
    expect(answerFileName("notes.md")).toBe("notes.md");
    expect(answerFileName("README.MD")).toBe("README.md");
  });

  it("escapes angle brackets and ampersands in the conversation title of the .md footer", () => {
    const footer = answerToMarkdownFile("Body", { conversationTitle: "a <b> & c", conversationUrl: "https://example.com/?chat=x", savedAt: new Date(2026, 9, 16) });
    expect(footer).toContain("a \\<b\\> \\& c");
    expect(footer).not.toContain("<b>");
  });
});

describe("answerFileName", () => {
  it("removes characters Windows and Android do not allow", () => {
    expect(answerFileName('Q4: plan/2026? <draft> "v2" | a\\b*')).toBe("Q4 plan 2026 draft v2 a b.md");
    expect(answerFileName("a\u0000b‮c\n d")).toBe("a b c d.md");
  });

  it("keeps Japanese and Chinese", () => {
    expect(answerFileName("週報: 2026/10 のまとめ")).toBe("週報 2026 10 のまとめ.md");
    expect(answerFileName("好的，下面是方案")).toBe("好的，下面是方案.md");
  });

  it("avoids hidden files, trailing dots and reserved device names", () => {
    expect(answerFileName("...hidden")).toBe("hidden.md");
    expect(answerFileName("Report ...")).toBe("Report.md");
    expect(answerFileName("CON")).toBe("_CON.md");
    expect(answerFileName("lpt1")).toBe("_lpt1.md");
    expect(answerFileName("console")).toBe("console.md");
  });

  it("limits the length in characters and in UTF-8 bytes", () => {
    const japanese = answerFileName("あ".repeat(100));
    expect(new TextEncoder().encode(japanese).byteLength).toBeLessThanOrEqual(160 + 3);
    expect(japanese.endsWith(".md")).toBe(true);
    expect(Array.from(answerFileName("a".repeat(300))).length).toBeLessThanOrEqual(80 + 3);
    wellFormed(answerFileName("😀".repeat(100)));
  });

  it("falls back to a plain name", () => {
    expect(answerFileName("")).toBe("answer.md");
    expect(answerFileName('/\\:*?"<>|')).toBe("answer.md");
  });
});

describe("answerToMarkdownFile", () => {
  it("keeps the answer as is and adds one source line, without front matter", () => {
    const file = answerToMarkdownFile("# Hi\r\n\r\nBody  \n\n", source);
    expect(file.startsWith("# Hi\n\nBody\n\n---\n\n")).toBe(true);
    expect(file).toBe(`# Hi\n\nBody\n\n---\n\nSaved from the conversation "[Weekly sync](${source.conversationUrl})" on 2026-10-16.\n`);
  });

  it("escapes the conversation title and tolerates a missing link", () => {
    const file = answerToMarkdownFile("x", { ...source, conversationTitle: "A [b] *c*", conversationUrl: "" });
    expect(file).toBe('x\n\n---\n\nSaved from the conversation "A \\[b\\] \\*c\\*" on 2026-10-16.\n');
  });
});

describe("conversationToMarkdownFile", () => {
  it("exports every question and answer in order, including messages after the clicked answer", () => {
    const file = conversationToMarkdownFile([
      { role: "USER", content: "First question" },
      { role: "ASSISTANT", content: "First answer" },
      { role: "USER", content: "第二个问题" },
      { role: "ASSISTANT", content: "二つ目の回答" },
    ], source);
    expect(file).toContain("# Weekly sync\n\n## You\n\nFirst question\n\n## NoteFable\n\nFirst answer\n\n## You\n\n第二个问题\n\n## NoteFable\n\n二つ目の回答");
    expect(file).toContain(source.conversationUrl);
  });

  it("preserves long messages, code and source links without including internal instructions", () => {
    const answer = `${"内容".repeat(30000)}\n\n\`\`\`ts\nconst x = 1;\n\`\`\`\n\n[Source](https://example.com)`;
    const file = conversationToMarkdownFile([
      { role: "SYSTEM", content: "Internal instructions" },
      { role: "USER", content: "Question\r\nwith two lines" },
      { role: "ASSISTANT", content: answer },
    ], source);
    expect(file).toContain(answer);
    expect(file).toContain("Question\nwith two lines");
    expect(file).not.toContain("Internal instructions");
  });

  it("keeps attachment-only and generated-image messages with protected image links", () => {
    const file = conversationToMarkdownFile([
      { role: "USER", content: "", attachments: [{ filename: "report [1].pdf" }, { filename: "photo.jpg", dataUrl: "/api/attachments/photo/image" }] },
      { role: "ASSISTANT", content: "", generatedImages: [{ id: "g1", dataUrl: "/api/attachments/g1/image" }] },
    ], source);
    expect(file).toContain("report \\[1\\].pdf");
    expect(file).toContain("[photo.jpg](<https://studymate.example/api/attachments/photo/image>)");
    expect(file).toContain("## NoteFable\n\n- [Generated image 1](<https://studymate.example/api/attachments/g1/image>)");
  });

  it("escapes the heading and does not turn non-HTTP attachment URLs into links", () => {
    const file = conversationToMarkdownFile([{ role: "USER", content: "Hi", attachments: [{ filename: "file", dataUrl: "javascript:alert(1)" }] }], { ...source, conversationTitle: "A [b] *c*" });
    expect(file).toContain("# A \\[b\\] \\*c\\*");
    expect(file).toContain("- file");
    expect(file).not.toContain("javascript:");
  });
});

describe("answerToNoteContent", () => {
  it("rewrites the angle-form source links and encodes spaces and parentheses", () => {
    const result = build([
      "Intro text.",
      "",
      "Sources:",
      "- [Example (docs)](<https://example.com/a b/(x)>)",
      "- [Plain](<https://example.org/>)",
    ].join("\n"));
    expectValid(result);
    const items = result.blocks.filter((block) => block.type === "bulletListItem");
    expect(items).toHaveLength(2);
    expect(inline(items[0])).toEqual([{ type: "link", href: "https://example.com/a%20b/%28x%29", content: [{ type: "text", text: "Example (docs)", styles: {} }] }]);
    expect(inline(items[1])[0]).toMatchObject({ type: "link", href: "https://example.org/" });
    expect(result.blocks[1].type).toBe("paragraph");
    expect(textOf(result.blocks[1])).toBe("Sources:");
  });

  it("handles other link forms the converter does not read", () => {
    const result = build([
      "[Wiki](https://en.wikipedia.org/wiki/Foo_(bar)) and [titled](https://x.test/p \"Tooltip\") and <https://auto.test/x>",
      "![diagram](https://img.test/a.png)",
      "`[code](<https://keep.test>)`",
    ].join("\n"));
    expectValid(result);
    const links = (block: Node) => inline(block).filter((entry) => entry.type === "link").map((entry) => entry.href);
    expect(links(result.blocks[0])).toEqual(["https://en.wikipedia.org/wiki/Foo_%28bar%29", "https://x.test/p", "https://auto.test/x"]);
    expect(links(result.blocks[1])).toEqual(["https://img.test/a.png"]);
    expect(textOf(result.blocks[1])).toBe("diagram");
    expect(textOf(result.blocks[2])).toBe("[code](<https://keep.test>)");
  });

  it("turns GFM tables into table blocks", () => {
    const result = build([
      "Before",
      "",
      "| Name | Age |",
      "| --- | :---: |",
      "| Alice | 30 |",
      "| Bob \\| B | `a|b` |",
      "| **Bold** | 1. one |",
      "",
      "After",
    ].join("\n"));
    expectValid(result);
    expect(result.blocks.slice(0, 3).map((block) => block.type)).toEqual(["paragraph", "table", "paragraph"]);
    const table = result.blocks[1].content as unknown as { headerRows?: number; rows: { cells: { content: Inline[] }[] }[] };
    expect(table.headerRows).toBe(1);
    const cells = table.rows.map((row) => row.cells.map((cell) => cell.content.map((entry) => entry.text).join("")));
    // \| とコードの中の | はセルの文字として残る。
    expect(cells).toEqual([["Name", "Age"], ["Alice", "30"], ["Bob | B", "a|b"], ["Bold", "1. one"]]);
    expect(table.rows[3].cells[0].content[0]).toMatchObject({ text: "Bold", styles: { bold: true } });
  });

  it("keeps a very wide table as a table", () => {
    const wide = Array.from({ length: 60 }, (_, index) => `c${index}`);
    const result = build([`| ${wide.join(" | ")} |`, `| ${wide.map(() => "---").join(" | ")} |`, `| ${wide.join(" | ")} |`].join("\n"));
    expectValid(result);
    expect(result.blocks[0].type).toBe("table");
  });

  it("does not treat a lone pipe line as a table", () => {
    const result = build("a | b\nnot a separator\n");
    expect(result.blocks.slice(0, 2).map(textOf)).toEqual(["a | b", "not a separator"]);
  });

  it("keeps code, lists, headings and quotes", () => {
    const result = build([
      "# Title",
      "## Part",
      "",
      "- one",
      "  - nested",
      "1. first",
      "- [x] done",
      "> quoted",
      "",
      "```ts",
      "const a = 1;",
      "",
      "const b = 2;",
      "```",
    ].join("\n"));
    expectValid(result);
    // 先頭の見出し（題名になったもの）は本文から外れる。
    expect(result.title).toBe("Title");
    expect(result.blocks.map((block) => block.type)).toEqual(["heading", "bulletListItem", "numberedListItem", "checkListItem", "quote", "codeBlock", "divider", "paragraph"]);
    expect(result.blocks[1].children.map((block) => block.type)).toEqual(["bulletListItem"]);
    expect(inline(result.blocks[5])).toEqual([{ type: "text", text: "const a = 1;\n\nconst b = 2;", styles: {} }]);
    expect(result.blocks[5].props).toEqual({ language: "ts" });
  });

  it("reads code fences the converter would otherwise get wrong", () => {
    const result = build([
      "~~~python title=\"x.py\"",
      "print('hi')",
      "~~~",
      "Then",
      "````md",
      "```js",
      "x",
      "```",
      "````",
      "Done",
      "``` bash",
      "ls",
    ].join("\n"));
    expectValid(result);
    expect(result.blocks.slice(0, 6).map((block) => block.type)).toEqual(["codeBlock", "paragraph", "codeBlock", "paragraph", "codeBlock", "divider"]);
    expect(result.blocks[0].props).toEqual({ language: "python" });
    expect(textOf(result.blocks[0])).toBe("print('hi')");
    expect(textOf(result.blocks[2])).toBe("```js\nx\n```");
    // 閉じていない囲みは、末尾までをコードとして扱う。
    expect(result.blocks[4].props).toEqual({ language: "bash" });
    expect(textOf(result.blocks[4])).toBe("ls");
  });

  it("uses the first heading as the title and drops it from the body only when it leads", () => {
    expect(build("# Plan\nBody").blocks.map((block) => block.type)).toEqual(["paragraph", "divider", "paragraph"]);
    const later = build("Intro\n## Plan\nBody");
    expect(later.title).toBe("Plan");
    expect(later.blocks.map((block) => block.type)).toEqual(["paragraph", "heading", "paragraph", "divider", "paragraph"]);
    // 切り詰めた題名は見出しと同じ文字ではないので、本文に残す。
    const long = build(`# ${"x".repeat(150)}\nBody`);
    expect(long.title.endsWith("…")).toBe(true);
    expect(long.blocks[0].type).toBe("heading");
  });

  it("falls back to the conversation title and keeps the title within the limit", () => {
    expect(build("```\ncode\n```", { conversationTitle: "My chat" }).title).toBe("My chat");
    const result = build(`# ${"長".repeat(500)}`);
    expect(result.title.length).toBeLessThanOrEqual(200);
    expectValid(result);
  });

  it("ends with a divider and a source paragraph that links back to the conversation", () => {
    const result = build("Hello");
    const [divider, paragraph] = result.blocks.slice(-2);
    expect(divider.type).toBe("divider");
    expect(divider.content).toBeUndefined();
    expect(inline(paragraph)).toEqual([
      expect.objectContaining({ type: "text", text: 'Saved from the conversation "' }),
      expect.objectContaining({ type: "link", href: source.conversationUrl, content: [expect.objectContaining({ text: "Weekly sync" })] }),
      expect.objectContaining({ type: "text", text: '" on 2026-10-16.' }),
    ]);
    expectValid(result);
  });

  it("writes the source as plain text when the link is unusable", () => {
    const result = build("Hello", { conversationUrl: "javascript:alert(1)" });
    expect(inline(result.blocks.at(-1)!).some((entry) => entry.type === "link")).toBe(false);
    expect(textOf(result.blocks.at(-1)!)).toBe('Saved from the conversation "Weekly sync" on 2026-10-16.');
    expectValid(result);
  });

  it("stays valid with an empty answer", () => {
    const result = build("   ");
    expect(result.blocks.map((block) => block.type)).toEqual(["divider", "paragraph"]);
    expectValid(result);
  });

  it("truncates at the block limit and says so", () => {
    const markdown = Array.from({ length: 2500 }, (_, index) => `Paragraph ${index}`).join("\n\n");
    const result = build(markdown);
    expectValid(result);
    expect(flat(result.blocks).length).toBeLessThanOrEqual(2000);
    const last = result.blocks.at(-1)!;
    expect(textOf(last)).toContain("too long to save in full");
    // 先頭から順に残っている。
    expect(textOf(result.blocks[0])).toBe("Paragraph 0");
    expect(textOf(result.blocks.at(-3)!)).toBe(`Paragraph ${flat(result.blocks).length - 3}`);
  });

  it("truncates at the size limit and says so", () => {
    const markdown = Array.from({ length: 400 }, () => "x".repeat(5000)).join("\n\n");
    const result = build(markdown);
    expectValid(result);
    expect(result.blocks.length).toBeLessThan(400);
    expect(result.blocks.length).toBeGreaterThan(100);
    expect(new TextEncoder().encode(JSON.stringify({ title: result.title, icon: null, cover: null, coverPosition: null, blocks: result.blocks })).byteLength).toBeLessThanOrEqual(MAX_NOTE_BYTES);
    expect(textOf(result.blocks.at(-1)!)).toContain("too long to save in full");
  });

  it("does not fail on a single block larger than the limit", () => {
    const result = build(`\`\`\`\n${"y".repeat(MAX_NOTE_BYTES)}\n\`\`\``);
    expectValid(result);
    expect(result.blocks.map((block) => block.type)).toEqual(["divider", "paragraph"]);
    expect(textOf(result.blocks[1])).toContain("too long to save in full");
  });

  it("flattens nesting that is deeper than a note can hold", () => {
    const markdown = Array.from({ length: 14 }, (_, depth) => `${"  ".repeat(depth)}- level ${depth}`).join("\n");
    const result = build(markdown);
    expectValid(result);
    expect(flat(result.blocks).filter((block) => block.type === "bulletListItem")).toHaveLength(14);
  });

  it("maps deep headings and Japanese text through the converter", () => {
    const result = build("#### 小見出し\n\n本文は**重要**です。");
    expectValid(result);
    expect(result.title).toBe("小見出し");
    expect(textOf(result.blocks[0])).toBe("本文は重要です。");
  });
});
