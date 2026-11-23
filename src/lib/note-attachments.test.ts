import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(), findFirst: vi.fn(), pageFindFirst: vi.fn(), createProposal: vi.fn(), read: vi.fn(), write: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  databaseSchema: "notefable",
  prisma: { attachment: { findMany: mocks.findMany, findFirst: mocks.findFirst }, notePage: { findFirst: mocks.pageFindFirst }, noteProposal: { create: mocks.createProposal } },
}));
vi.mock("@/lib/storage", () => ({ readStoredImage: mocks.read }));
vi.mock("@/lib/stored-files", () => ({
  storeFile: async (_owner: unknown, file: { path: string; buffer: Buffer; mimeType: string }) => { await mocks.write(file.path, file.buffer, file.mimeType); return file.path; },
}));
import { noteFileUrl, parseNoteFileUrl } from "./note-file-keys";
import { runPageTool } from "./page-tools";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
type Proposed = { proposed: { blocks: { type: string; props: Record<string, unknown> }[] } };

// 画面へ流すイベントには本文を入れず、保存した提案（payload）にだけ完全なブロックが入る。
function proposedBlocks() {
  const calls = mocks.createProposal.mock.calls;
  return (calls[calls.length - 1][0] as { data: { payload: Proposed } }).data.payload.proposed.blocks;
}

describe("chat attachments in the note tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createProposal.mockImplementation(async ({ data }: { data: { kind: string; payload: unknown } }) => ({ id: "prop1", kind: data.kind, status: "PENDING", payload: data.payload, appliedPageId: null }));
    mocks.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === "att1" ? { filename: "diagram (v2).png", size: 1000, imageStoragePath: "images/2026/10/14/a.png" } : null);
    mocks.read.mockResolvedValue(png);
    mocks.write.mockResolvedValue(undefined);
  });

  it("leaves out the turns a regeneration is replacing", async () => {
    mocks.findMany.mockResolvedValue([]);
    const { listChatAttachments, createAttachmentResolver } = await import("./note-attachments");
    await listChatAttachments("mine", "s1", ["m9"]);
    expect(mocks.findMany.mock.calls.at(-1)?.[0].where).toEqual({ message: { active: true, id: { notIn: ["m9"] }, session: { id: "s1", userId: "mine" } } });
    mocks.findFirst.mockResolvedValue(null);
    await expect(createAttachmentResolver("mine", "s1", ["m9"])(["![x](attachment:att1)"])).rejects.toThrow();
    expect(mocks.findFirst.mock.calls.at(-1)?.[0].where).toMatchObject({ id: "att1", message: { active: true, id: { notIn: ["m9"] } } });
  });

  it("lists only this chat's attachments and says which can go into a note", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "att1", filename: "a.png", mimeType: "image/png", size: 1000, imageStoragePath: "images/x.png" },
      { id: "att2", filename: "n.pdf", mimeType: "application/pdf", size: 5000, imageStoragePath: null },
      { id: "att3", filename: "big.png", mimeType: "image/png", size: 9 * 1024 * 1024, imageStoragePath: "images/y.png" },
    ]);
    const result = await runPageTool("list_chat_attachments", {}, "mine", "s1");
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({ message: { active: true, session: { id: "s1", userId: "mine" } } });
    const { attachments } = JSON.parse(result.content);
    expect(attachments.map((a: { id: string; canInsertIntoNote: boolean }) => [a.id, a.canInsertIntoNote])).toEqual([["att1", true], ["att2", false], ["att3", false]]);
    expect(attachments[1].note).toContain("cannot be placed");

    mocks.findMany.mockResolvedValue([]);
    expect(JSON.parse((await runPageTool("list_chat_attachments", {}, "mine", "s1")).content).note).toContain("not attached");
  });

  it("copies an attached image into the user's note files when a new note proposal uses it", async () => {
    const result = await runPageTool("propose_note_create", { title: "Diagram", markdown: "Look:\n![Cell diagram](attachment:att1)", icon: null }, "mine", "s1");
    expect(result.isError).toBeUndefined();
    // 同じ会話・同じ所有者の添付だけを探す。
    expect(mocks.findFirst.mock.calls[0][0].where).toMatchObject({ id: "att1", message: { active: true, session: { id: "s1", userId: "mine" } } });
    const [path, buffer, mime] = mocks.write.mock.calls[0];
    expect(path).toMatch(/^note-files\/mine\/[0-9a-f-]{36}\.png$/);
    expect(buffer).toBe(png);
    expect(mime).toBe("image/png");
    const [, image] = proposedBlocks();
    expect(image).toMatchObject({ type: "image", props: { caption: "Cell diagram", name: "diagram (v2).png", showPreview: true } });
    expect(parseNoteFileUrl(image.props.url)).toMatchObject({ ownerId: "mine", extension: "png" });
    expect((result.events as { content: string }[])[0].content).toContain("[Image: diagram (v2).png — Cell diagram]");
  });

  it("can replace an uploaded image in an existing note with an attached one", async () => {
    const old = { id: "img", type: "image", props: { url: noteFileUrl("note-files/mine/00000000-0000-0000-0000-000000000000.png", "old.png"), name: "old.png" }, children: [] };
    mocks.pageFindFirst.mockResolvedValue({ id: "p1", title: "T", version: 2, blocks: [{ id: "a", type: "paragraph", props: {}, content: [{ type: "text", text: "hi", styles: {} }], children: [] }, old] });
    const result = await runPageTool("propose_note_edit", { noteId: "p1", version: 2, title: null, edits: [{ op: "replace", block: 2, markdown: "![New](attachment:att1)" }] }, "mine", "s1");
    expect(result.isError).toBeUndefined();
    const [, image] = proposedBlocks();
    expect(image.props.name).toBe("diagram (v2).png");
    expect(JSON.stringify((result.events as unknown[])[0])).toContain("dropsMedia");
  });

  it("rejects attachments that are not this user's images, and unreadable or oversized ones", async () => {
    const create = (markdown: string) => runPageTool("propose_note_create", { title: "t", markdown, icon: null }, "mine", "s1");
    expect(await create("![x](attachment:other)")).toMatchObject({ isError: true, content: expect.stringContaining("not an image the user sent") });
    mocks.read.mockRejectedValueOnce(new Error("gone"));
    expect(await create("![x](attachment:att1)")).toMatchObject({ isError: true, content: expect.stringContaining("could not be read") });
    mocks.read.mockResolvedValueOnce(Buffer.from("not an image at all"));
    expect(await create("![x](attachment:att1)")).toMatchObject({ isError: true, content: expect.stringContaining("not a PNG") });
    mocks.read.mockResolvedValueOnce(Buffer.concat([png, Buffer.alloc(4 * 1024 * 1024)]));
    expect(await create("![x](attachment:att1)")).toMatchObject({ isError: true, content: expect.stringContaining("larger than") });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.createProposal).not.toHaveBeenCalled();
  });

  it("treats an attachment reference that is not alone on its line as plain text", async () => {
    const result = await runPageTool("propose_note_create", { title: "t", markdown: "see ![x](attachment:att1) here", icon: null }, "mine", "s1");
    expect(result.isError).toBeUndefined();
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(proposedBlocks().every((b) => b.type === "paragraph")).toBe(true);
  });

  it("copies one attachment once and limits how many images one proposal may add", async () => {
    mocks.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({ filename: `${where.id}.png`, imageStoragePath: `images/${where.id}.png` }));
    await runPageTool("propose_note_create", { title: "t", markdown: "![a](attachment:x1)\n![b](attachment:x1)", icon: null }, "mine", "s1");
    expect(proposedBlocks()).toHaveLength(2);
    expect(mocks.write).toHaveBeenCalledTimes(1);

    mocks.write.mockClear();
    const many = Array.from({ length: 6 }, (_, i) => `![](attachment:y${i})`).join("\n");
    expect(await runPageTool("propose_note_create", { title: "t", markdown: many, icon: null }, "mine", "s1")).toMatchObject({ isError: true, content: expect.stringContaining("At most 5") });
  });

  it("checks every edit together: the cap holds across edits and nothing is written when one reference fails", async () => {
    mocks.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === "bad" ? null : { filename: `${where.id}.png`, size: 100, imageStoragePath: `images/${where.id}.png` });
    mocks.pageFindFirst.mockResolvedValue({ id: "p1", title: "T", version: 1, blocks: [{ id: "a", type: "paragraph", props: {}, content: [{ type: "text", text: "hi", styles: {} }], children: [] }] });
    const edit = (edits: { op: string; block: number; markdown: string | null }[]) => runPageTool("propose_note_edit", { noteId: "p1", version: 1, title: null, edits }, "mine", "s1");
    const six = Array.from({ length: 6 }, (_, i) => ({ op: "insert_after", block: 1, markdown: `![](attachment:z${i})` }));
    expect(await edit(six)).toMatchObject({ isError: true, content: expect.stringContaining("At most 5") });
    // 3 枚目の参照が不正なら、1・2 枚目も書かない。
    const broken = ["a1", "a2", "bad"].map((id) => ({ op: "insert_after", block: 1, markdown: `![](attachment:${id})` }));
    expect(await edit(broken)).toMatchObject({ isError: true, content: expect.stringContaining("not an image the user sent") });
    expect(mocks.write).not.toHaveBeenCalled();

    // 同じ添付を複数の edit が使っても 1 回だけコピーする。
    const same = [1, 2].map(() => ({ op: "insert_after", block: 1, markdown: "![](attachment:dup)" }));
    expect((await edit(same)).isError).toBeUndefined();
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });

  it("leaves code fences alone, understands CRLF, and rejects an oversized image before reading it", async () => {
    mocks.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({ filename: "p.png", size: where.id === "huge" ? 9 * 1024 * 1024 : 100, imageStoragePath: "images/p.png" }));
    const fenced = "```\n![x](attachment:att1)\n```";
    const kept = await runPageTool("propose_note_create", { title: "t", markdown: fenced, icon: null }, "mine", "s1");
    expect(kept.isError).toBeUndefined();
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(proposedBlocks().map((b) => b.type)).toEqual(["codeBlock"]);

    const crlf = await runPageTool("propose_note_create", { title: "t", markdown: "a\r\n![x](attachment:att1)\r\nb", icon: null }, "mine", "s1");
    expect(crlf.isError).toBeUndefined();
    expect(proposedBlocks().map((b) => b.type)).toEqual(["paragraph", "image", "paragraph"]);

    mocks.read.mockClear();
    expect(await runPageTool("propose_note_create", { title: "t", markdown: "![x](attachment:huge)", icon: null }, "mine", "s1")).toMatchObject({ isError: true, content: expect.stringContaining("larger than") });
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("shortens a very long file name so the result is still an image block", async () => {
    mocks.findFirst.mockResolvedValue({ filename: `${"資料".repeat(28)}.png`, size: 100, imageStoragePath: "images/p.png" });
    const result = await runPageTool("propose_note_create", { title: "t", markdown: "![x](attachment:att1)", icon: null }, "mine", "s1");
    expect(result.isError).toBeUndefined();
    const [image] = proposedBlocks();
    expect(image.type).toBe("image");
    expect(String(image.props.name).endsWith(".png")).toBe(true);
    expect(String(image.props.url).length).toBeLessThanOrEqual(600);
  });

  it("refuses a model-written URL that points into another user's files", async () => {
    const foreign = noteFileUrl("note-files/someoneelse/00000000-0000-0000-0000-000000000000.png", "x.png");
    const result = await runPageTool("propose_note_create", { title: "t", markdown: `![x](${foreign})`, icon: null }, "mine", "s1");
    expect(result).toMatchObject({ isError: true, content: expect.stringContaining("not yours") });
    expect(mocks.createProposal).not.toHaveBeenCalled();
  });
});
