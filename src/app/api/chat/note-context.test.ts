import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  findSession: vi.fn(),
  findNote: vi.fn(),
  createMessage: vi.fn(),
  fetch: vi.fn(),
  loadProjectContext: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getOrCreateUser: async () => ({ id: "user" }), isAccountUser: () => false }));
vi.mock("@/lib/usage-limits", async (importOriginal) => ({ ...await importOriginal<object>(), consumeUsage: async () => ({ ok: true, ticket: { buckets: [] } }), refundUsage: async () => {}, clientNetworkKey: () => null }));
vi.mock("@/lib/env", () => ({ optionalEnv: () => undefined, requireEnv: () => "test-key" }));
vi.mock("@/lib/files", () => ({
  AttachmentValidationError: class extends Error {},
  buildAttachmentPrompt: () => "",
  isImageFile: () => false,
  prepareAttachments: async () => [],
  validateAttachmentFiles: () => {},
  validateMultipartRequestSize: () => {},
}));
vi.mock("@/lib/chat-history", () => ({ buildHistoryInput: async () => [] }));
vi.mock("@/lib/chat-project-context", async (importOriginal) => ({ ...await importOriginal<object>(), loadProjectContext: mocks.loadProjectContext }));
vi.mock("@/lib/prisma", () => {
  const prisma: Record<string, unknown> = {
    session: { create: mocks.createSession, update: async () => ({}), updateMany: async () => ({ count: 0 }), findFirst: mocks.findSession, findUnique: async () => ({ stopRequestedAt: null }) },
    notePage: { findFirst: mocks.findNote },
    // findFirst は表示中の枝の末尾（次の発言の親）、findUnique は回答を保存するときの「答えた発言が表示中か」。
    message: { create: mocks.createMessage, findMany: async () => [], findFirst: async () => null, findUnique: async () => ({ active: true }) },
    noteProposal: { updateMany: async () => ({ count: 0 }) },
  };
  prisma.$transaction = async (fn: (tx: unknown) => unknown) => fn(prisma);
  // 会話の行を押さえる問い合わせ（FOR UPDATE）。
  prisma.$queryRaw = async () => [{ id: "session" }];
  return { prisma, databaseSchema: "notefable" };
});

import { POST } from "./route";

async function send(fields: Record<string, string>) {
  mocks.fetch.mockResolvedValue(new Response(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "ok" })}\n\ndata: ${JSON.stringify({ type: "response.completed" })}\n\n`));
  const form = new FormData();
  form.set("message", "Fix the typos");
  form.set("model", "deepseek-flash");
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const response = await POST(new Request("http://localhost/api/chat", { method: "POST", body: form }));
  await response.text();
  return response;
}

describe("chat requests made from inside a note", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createMessage.mockResolvedValue({ id: "message" });
    mocks.createSession.mockImplementation(async ({ data }: { data: { noteId?: string } }) => ({ id: "session", title: "Test", noteId: data.noteId ?? null }));
    mocks.findSession.mockResolvedValue({ id: "session", title: "Existing chat" });
    mocks.findNote.mockResolvedValue({ id: "note1", title: "Study \"plan\"\nline two" });
  });

  it("ties a new conversation to the note and tells the model which note it is", async () => {
    const response = await send({ noteId: "note1" });
    expect(response.status).toBe(200);
    // 自分のノートかを、自分のユーザー ID で確かめる。ゴミ箱のノートは開けない。
    expect(mocks.findNote.mock.calls[0][0].where).toEqual({ id: "note1", userId: "user", deletedAt: null });
    expect(mocks.createSession.mock.calls[0][0].data).toMatchObject({ userId: "user", noteId: "note1" });
    const { instructions } = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(instructions).toContain("noteId: note1");
    expect(instructions).toContain("call read_note with this noteId first");
    // タイトルは JSON 文字列として入るので、引用符や改行で指示文を壊せない。
    expect(instructions).toContain(JSON.stringify("Study \"plan\"\nline two"));
  });

  it("rejects a note in the trash like a missing one", async () => {
    // 条件に deletedAt: null があるので、ゴミ箱のノートは見つからない。
    mocks.findNote.mockImplementation(async ({ where }: { where: { deletedAt?: null } }) => (where.deletedAt === null ? null : { id: "note1", title: "Trashed" }));
    expect((await send({ noteId: "note1" })).status).toBe(404);
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("never adds a project's context to a note's assistant", async () => {
    mocks.findSession.mockResolvedValue({ id: "session", title: "Existing chat", projectId: "p1" });
    await send({ noteId: "note1", sessionId: "session" });
    expect(mocks.loadProjectContext).not.toHaveBeenCalled();
  });

  it("rejects a note that is not the user's and creates nothing", async () => {
    mocks.findNote.mockResolvedValue(null);
    const response = await send({ noteId: "someone-elses" });
    expect(response.status).toBe(404);
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("only continues a conversation that belongs to the same note, and keeps plain chats separate", async () => {
    await send({ noteId: "note1", sessionId: "session" });
    expect(mocks.findSession.mock.calls[0][0].where).toEqual({ id: "session", userId: "user", noteId: "note1" });
    await send({ sessionId: "session" });
    expect(mocks.findSession.mock.calls[1][0].where).toEqual({ id: "session", userId: "user", noteId: null });
    // 通常のチャットにはノートの指示を足さない。
    const { instructions } = JSON.parse(mocks.fetch.mock.calls[1][1].body);
    expect(instructions).not.toContain("noteId:");
    expect(mocks.findNote).toHaveBeenCalledTimes(1);
  });

  it("keeps web search off for note requests whatever the client asks for", async () => {
    const tools = async (fields: Record<string, string>) => {
      mocks.fetch.mockClear();
      await send({ model: "gpt-6-luna", webSearch: "force", ...fields });
      return (JSON.parse(mocks.fetch.mock.calls[0][1].body).tools ?? []).map((tool: { type: string; name?: string }) => tool.name ?? tool.type);
    };
    expect(await tools({})).toContain("web_search");
    expect(await tools({ noteId: "note1" })).not.toContain("web_search");
  });

  it("returns 404 when the conversation does not match the note", async () => {
    mocks.findSession.mockResolvedValue(null);
    expect((await send({ noteId: "note1", sessionId: "plain-chat" })).status).toBe(404);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("focuses edits on the selected excerpt only when noteSelection=1 is sent with a noteId", async () => {
    await send({ noteId: "note1", noteSelection: "1" });
    const withNote = JSON.parse(mocks.fetch.mock.calls[0][1].body).instructions as string;
    expect(withNote).toContain("selected a specific excerpt");

    mocks.fetch.mockClear();
    await send({ noteSelection: "1" });
    const withoutNote = JSON.parse(mocks.fetch.mock.calls[0][1].body).instructions as string;
    expect(withoutNote).not.toContain("selected a specific excerpt");
  });
});
