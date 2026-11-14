import { beforeEach, describe, expect, it, vi } from "vitest";
import { answerToNoteContent } from "@/lib/answer-export";
import { validateNoteContent } from "@/lib/note-document";

const mocks = vi.hoisted(() => ({ session: vi.fn(), create: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getOrCreateAnonymousUser: async () => ({ id: "mine" }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findFirst: mocks.session },
    $transaction: mocks.transaction,
  },
}));
import { POST } from "./route";

const sessionId = "chat12345678901234567890";
const messageId = "msg12345678901234567890";
function post(body: unknown) {
  return new Request("https://studymate.example/api/pages/from-answer", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
}
type Block = { type: string; content?: { type: string; text?: string; href?: string }[]; children: Block[] };
const stripIds = (blocks: unknown) => JSON.parse(JSON.stringify(blocks), (key, value) => (key === "id" ? undefined : value));

describe("POST /api/pages/from-answer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ title: "Weekly sync" });
    mocks.create.mockImplementation(async ({ data }) => ({ id: "page1", ...data }));
    mocks.transaction.mockImplementation(async (run: (tx: unknown) => unknown) => run({ notePage: { create: mocks.create } }));
  });

  it("builds the note with the same conversion the browser uses and creates it for the owner", async () => {
    const markdown = "# Plan\n\n- one\n- two\n\nSee [docs](<https://x.test/a b>).";
    const response = await POST(post({ markdown, sessionId, messageId, savedOn: "2026-10-16" }));
    expect(response.status).toBe(201);
    const { page } = await response.json();
    expect(page.id).toBe("page1");
    expect(mocks.session).toHaveBeenCalledWith({ where: { id: sessionId, userId: "mine", noteId: null }, select: { title: true } });
    const data = mocks.create.mock.calls[0][0].data;
    expect(data.userId).toBe("mine");
    expect(data.cover).toBeNull();
    const expected = answerToNoteContent(markdown, {
      conversationTitle: "Weekly sync",
      conversationUrl: `https://studymate.example/?chat=${sessionId}&message=${messageId}`,
      savedAt: new Date(2026, 9, 16, 12),
    });
    expect(data.title).toBe("Plan");
    expect(stripIds(data.blocks)).toEqual(stripIds(expected.blocks));
    expect(() => validateNoteContent({ title: data.title, icon: null, cover: null, coverPosition: null, blocks: data.blocks })).not.toThrow();
    const sourceBlock = (data.blocks as Block[]).at(-1)!;
    expect(sourceBlock.content?.[1]).toMatchObject({ type: "link", href: `https://studymate.example/?chat=${sessionId}&message=${messageId}` });
    expect(sourceBlock.content?.[2].text).toBe("\" on 2026-10-16.");
  });

  it("links only to the chat for a message that is not stored yet", async () => {
    await POST(post({ markdown: "Hello", sessionId, messageId: "0f8c2c43-1111-2222-3333-444455556666" }));
    const sourceBlock = (mocks.create.mock.calls[0][0].data.blocks as Block[]).at(-1)!;
    expect(sourceBlock.content?.[1].href).toBe(`https://studymate.example/?chat=${sessionId}`);
  });

  it("does not save from a chat that belongs to someone else or to a note assistant", async () => {
    mocks.session.mockResolvedValue(null);
    const response = await POST(post({ markdown: "Hello", sessionId, messageId }));
    expect(response.status).toBe(404);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["not json"],
    [{}],
    [{ markdown: "  ", sessionId }],
    [{ markdown: 5, sessionId }],
    [{ markdown: "Hi", sessionId: "../x" }],
    [{ markdown: "Hi", sessionId, messageId: 5 }],
    [["Hi"]],
  ])("rejects %j", async (body) => {
    expect((await POST(post(body))).status).toBe(400);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects a body over 1 MiB with 413", async () => {
    const response = await POST(post({ markdown: "a".repeat(1024 * 1024 + 10), sessionId }));
    expect(response.status).toBe(413);
  });

  it("truncates a very long answer instead of failing", async () => {
    const markdown = Array.from({ length: 2600 }, (_, index) => `Line ${index}`).join("\n\n");
    expect((await POST(post({ markdown, sessionId }))).status).toBe(201);
    const blocks = mocks.create.mock.calls[0][0].data.blocks as Block[];
    expect(blocks.length).toBeLessThanOrEqual(2000);
  });

  it("returns 503 when the database fails", async () => {
    mocks.transaction.mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await POST(post({ markdown: "Hello", sessionId }))).status).toBe(503);
  });
});
