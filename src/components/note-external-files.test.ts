import { describe, expect, it } from "vitest";
import { Fragment, Schema, Slice } from "@tiptap/pm/model";
import { noteFileUrl } from "@/lib/note-file-keys";
import { withoutExternalFiles } from "./note-external-files";

// BlockNote の文書と同じ形（blockGroup > blockContainer > 中身 + 子の blockGroup）の最小の schema。
const schema = new Schema({
  nodes: {
    doc: { content: "blockGroup" },
    blockGroup: { content: "(blockContainer | columnList)+" },
    columnList: { content: "column column+" },
    column: { content: "blockContainer+" },
    blockContainer: { content: "blockContent blockGroup?" },
    paragraph: { group: "blockContent", content: "text*" },
    image: { group: "blockContent", attrs: { url: { default: "" } } },
    file: { group: "blockContent", attrs: { url: { default: "" } } },
    text: {},
  },
});
const own = noteFileUrl("note-files/user1/00000000-0000-0000-0000-000000000000.png", "a.png");
const container = (content: ReturnType<typeof schema.node>, children?: ReturnType<typeof schema.node>[]) =>
  schema.node("blockContainer", null, children ? [content, schema.node("blockGroup", null, children)] : [content]);
const paragraph = (text: string) => container(schema.node("paragraph", null, [schema.text(text)]));
const image = (url: string) => container(schema.node("image", { url }));
const file = (url: string) => container(schema.node("file", { url }));
const names = (slice: Slice) => {
  const out: string[] = [];
  slice.content.descendants((node) => { if (node.type.name !== "blockContainer" && node.type.name !== "blockGroup" && !node.isText) out.push(`${node.type.name}:${node.attrs.url ?? node.textContent}`); });
  return out;
};

describe("pasted or dropped files from outside the app", () => {
  it("removes image and file blocks that point outside the app, and keeps the rest", () => {
    const slice = new Slice(Fragment.fromArray([paragraph("hello"), image("https://example.com/cat.png"), file("http://example.com/a.pdf"), image(own)]), 1, 1);
    const cleaned = withoutExternalFiles(slice);
    expect(names(cleaned)).toEqual(["paragraph:hello", `image:${own}`]);
    expect([cleaned.openStart, cleaned.openEnd]).toEqual([1, 1]);
  });

  it("leaves the app's own files and empty upload placeholders untouched (moving blocks keeps working)", () => {
    const slice = new Slice(Fragment.fromArray([image(own), image(""), paragraph("x")]), 0, 0);
    expect(withoutExternalFiles(slice)).toBe(slice);
  });

  it("removes nested external images and drops a child group left empty", () => {
    const parent = container(schema.node("paragraph", null, [schema.text("parent")]), [image("https://example.com/cat.png")]);
    const cleaned = withoutExternalFiles(new Slice(Fragment.from(parent), 0, 0));
    expect(names(cleaned)).toEqual(["paragraph:parent"]);
    let groups = 0;
    cleaned.content.descendants((node) => { if (node.type.name === "blockGroup") groups += 1; });
    expect(groups).toBe(0);
    cleaned.content.forEach((node) => node.check());
  });

  it("keeps a pasted group open so the blocks land beside the current block, not inside it", () => {
    // BlockNote の HTML の貼り付け・ドロップは blockGroup 1 つを深さ 3 で開いた slice になる。
    const group = schema.node("blockGroup", null, [paragraph("Hello"), image("https://example.com/cat.png"), paragraph("World")]);
    const cleaned = withoutExternalFiles(new Slice(Fragment.from(group), 3, 3));
    expect(names(cleaned)).toEqual(["paragraph:Hello", "paragraph:World"]);
    expect([cleaned.openStart, cleaned.openEnd]).toEqual([3, 3]);
    // 端のブロックが消えたら、その時の端の深さまでにする（画像のような葉は開かない）。
    const own2 = schema.node("blockGroup", null, [image("https://example.com/cat.png"), image(own)]);
    const trimmed = withoutExternalFiles(new Slice(Fragment.from(own2), 3, 3));
    expect([trimmed.openStart, trimmed.openEnd]).toEqual([2, 2]);
  });

  it("removes a column left empty and unwraps a column list left with one column", () => {
    const column = (...blocks: ReturnType<typeof schema.node>[]) => schema.node("column", null, blocks);
    const two = schema.node("columnList", null, [column(paragraph("left")), column(image("https://example.com/cat.png"))]);
    const cleaned = withoutExternalFiles(new Slice(Fragment.from(schema.node("blockGroup", null, [two])), 0, 0));
    expect(names(cleaned)).toEqual(["paragraph:left"]);
    cleaned.content.forEach((node) => node.check());
    const three = schema.node("columnList", null, [column(paragraph("a")), column(image("https://example.com/x.png")), column(paragraph("b"))]);
    const kept = withoutExternalFiles(new Slice(Fragment.from(schema.node("blockGroup", null, [three])), 0, 0));
    expect(names(kept)).toEqual(["columnList:ab", "column:a", "paragraph:a", "column:b", "paragraph:b"]);
    kept.content.forEach((node) => node.check());
    let columns = 0;
    kept.content.descendants((node) => { if (node.type.name === "column") columns += 1; });
    expect(columns).toBe(2);
  });

  it("gives an empty slice when only external files were dropped", () => {
    expect(withoutExternalFiles(new Slice(Fragment.from(image("https://example.com/cat.png")), 0, 0))).toBe(Slice.empty);
  });
});
