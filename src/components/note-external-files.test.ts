import { describe, expect, it } from "vitest";
import { Fragment, Schema, Slice } from "@tiptap/pm/model";
import { noteFileUrl } from "@/lib/note-file-keys";
import { withoutExternalFiles } from "./note-external-files";

// BlockNote の文書と同じ形（blockGroup > blockContainer > 中身 + 子の blockGroup）の最小の schema。
const schema = new Schema({
  nodes: {
    doc: { content: "blockGroup" },
    blockGroup: { content: "blockContainer+" },
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
    expect(cleaned.openStart).toBe(0);
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

  it("gives an empty slice when only external files were dropped", () => {
    expect(withoutExternalFiles(new Slice(Fragment.from(image("https://example.com/cat.png")), 0, 0))).toBe(Slice.empty);
  });
});
