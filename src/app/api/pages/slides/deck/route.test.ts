import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findPage: vi.fn(), findPages: vi.fn(), consume: vi.fn(), refund: vi.fn(), generate: vi.fn(), create: vi.fn(), embed: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getOrCreateUser: async () => ({ id: "mine", googleSub: null }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { notePage: { findFirst: mocks.findPage, findMany: mocks.findPages } } }));
vi.mock("@/lib/usage-limits", () => ({
  clientNetworkKey: () => null,
  consumeUsage: mocks.consume,
  refundUsage: mocks.refund,
  usageLimitResponse: (result: { message: string }) => Response.json({ error: result.message, code: "usage_limit" }, { status: 429 }),
}));
vi.mock("@/lib/one-shot-model", async (importOriginal) => ({ ...(await importOriginal<object>()), generateOneShotText: mocks.generate }));
vi.mock("@/lib/note-create", () => ({ createCanvasPage: mocks.create }));
vi.mock("@/lib/note-embeddings", () => ({ scheduleNoteEmbeddingSync: mocks.embed }));
import { NoteValidationError } from "@/lib/note-document";
import { aiRequestPageId } from "@/lib/page-ai/one-shot";
import { deckInstructions } from "@/lib/slides/ai-prompt";
import { maxDuration, POST } from "./route";

const ticket = { buckets: [{ key: "user:mine", kind: "chat", day: "2026-11-26" }] };
const requestId = "req-0123456789";
const outline = { title: "光合作用", slides: [{ title: "光反应", points: ["类囊体"] }, { title: "暗反应", points: ["基质"] }] };
const REPLY = "@@@SLIDE 光反应\n@@@BODY\n- 类囊体\n- $ATP$\n@@@NOTES\n先讲光反应。\n@@@SLIDE 暗反应\n@@@BODY\n- 基质\n@@@NOTES\n\n@@@END";
const topicBody = { source: { type: "topic", topic: "光合作用" }, outline, options: { theme: { id: "tech", mode: "dark" } }, model: "claude-haiku-5-5", clientRequestId: requestId };
const noteBody = { source: { type: "notes", pageIds: ["cnote1"] }, outline, clientRequestId: requestId };

function post(body: unknown) {
  return POST(new Request("https://notefable.example/api/pages/slides/deck", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
}

describe("POST /api/pages/slides/deck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findPage.mockReset().mockResolvedValue(null);
    mocks.findPages.mockResolvedValue([{ id: "cnote1", kind: "note", title: "光合作用笔记", blocks: [{ id: "b1", type: "paragraph", props: {}, content: [{ type: "text", text: "光反应和暗反应", styles: {} }], children: [] }] }]);
    mocks.consume.mockResolvedValue({ ok: true, ticket });
    mocks.generate.mockResolvedValue({ text: REPLY, cutOff: false });
    mocks.create.mockReset().mockImplementation(async (_user: string, _kind: string, input: { title: string }, options: { id: string; parentId: string | null }) => ({
      page: { id: options.id, kind: "slides", title: input.title, parentId: options.parentId, position: 0, icon: null, version: 0, groupId: null, aiUpdatedAt: new Date(), blocks: [] },
      data: {},
    }));
  });

  it("writes the confirmed outline into one new slides page marked as AI content", async () => {
    expect(maxDuration).toBe(300);
    const response = await post(topicBody);
    expect(response.status).toBe(201);
    const body = await response.json();
    const id = aiRequestPageId("mine", "slides", requestId);
    expect(body.page).toMatchObject({ id, kind: "slides", title: "光合作用", parentId: null });
    expect(body.page).not.toHaveProperty("blocks");
    expect(body).not.toHaveProperty("partial");
    expect(mocks.consume).toHaveBeenCalledWith({ id: "mine", googleSub: null }, "chat", null);
    const call = mocks.generate.mock.calls[0][0];
    expect(call).toMatchObject({ provider: "anthropic", instructions: deckInstructions("topic"), maxOutputTokens: 32_000 });
    expect(call.input).toContain("<outline>\n# 光合作用\n## 光反应\n- 类囊体\n## 暗反应\n- 基质\n</outline>");
    const [userId, kind, input, options] = mocks.create.mock.calls[0];
    expect([userId, kind]).toEqual(["mine", "slides"]);
    expect(options).toEqual({ ai: true, id, parentId: null, groupId: null });
    expect(input.data.theme).toEqual({ id: "tech", mode: "dark" });
    expect(input.data.slides).toHaveLength(3);
    expect(input.data.slides[1].notes).toBe("先讲光反应。");
    expect(mocks.embed).toHaveBeenCalledWith("mine", [id]);
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it("places slides from one note under that note, and otherwise where the request says", async () => {
    expect((await post(noteBody)).status).toBe(201);
    expect(mocks.create.mock.calls[0][3]).toMatchObject({ parentId: "cnote1", groupId: null });
    expect(mocks.generate.mock.calls[0][0].input).toMatch(/<<<page-content [0-9a-f]{12}>>>\n光反应和暗反应\n<<<end page-content/);
    await post({ ...noteBody, parentId: "cother", clientRequestId: "req-aaaaaaaaaa" });
    expect(mocks.create.mock.calls[1][3]).toMatchObject({ parentId: "cother" });
    await post({ ...topicBody, groupId: "cgroup1", clientRequestId: "req-bbbbbbbbbb" });
    expect(mocks.create.mock.calls[2][3]).toMatchObject({ parentId: null, groupId: "cgroup1" });
  });

  it("returns the page made for the same request without generating or counting again", async () => {
    mocks.findPage.mockResolvedValueOnce({ id: "cexisting", kind: "slides", title: "Old", deletedAt: null });
    const response = await post(noteBody);
    expect(response.status).toBe(200);
    expect((await response.json()).page).toMatchObject({ id: "cexisting" });
    expect(mocks.findPage.mock.calls[0][0].where).toEqual({ id: aiRequestPageId("mine", "slides", requestId), userId: "mine" });
    // 材料は読む前に返す。
    expect(mocks.findPages).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("does not hand back slides from the same request that are now in the trash", async () => {
    mocks.findPage.mockResolvedValueOnce({ id: "cexisting", deletedAt: new Date() });
    const response = await post(topicBody);
    expect([response.status, (await response.json()).error]).toEqual([404, "These slides were moved to the trash."]);
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it("returns the page created by a request that arrived at the same time, and refunds this one", async () => {
    mocks.create.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    mocks.findPage.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "cother", deletedAt: null });
    const response = await post(topicBody);
    expect(response.status).toBe(200);
    expect((await response.json()).page).toMatchObject({ id: "cother" });
    expect(mocks.refund).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an upstream error", () => mocks.generate.mockRejectedValue(new Error("boom"))],
    ["a reply cut off by the output limit", () => mocks.generate.mockResolvedValue({ text: REPLY, cutOff: true })],
    ["a reply without the end marker", () => mocks.generate.mockResolvedValue({ text: REPLY.replace("@@@END", ""), cutOff: false })],
    ["a reply with a slide missing", () => mocks.generate.mockResolvedValue({ text: "@@@SLIDE 光反应\n@@@BODY\nx\n@@@END", cutOff: false })],
  ])("refunds after %s", async (_name, arrange) => {
    arrange();
    const response = await post(topicBody);
    expect([response.status, (await response.json()).error]).toEqual([502, "Could not generate slides. Try again."]);
    expect(mocks.refund).toHaveBeenCalledWith(ticket);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("refunds when the page cannot be saved, keeping the reason for a missing parent or project", async () => {
    mocks.create.mockRejectedValueOnce(new Error("down"));
    expect((await post(topicBody)).status).toBe(503);
    expect(mocks.refund).toHaveBeenLastCalledWith(ticket);
    mocks.create.mockRejectedValueOnce(new NoteValidationError("Project not found.", 404));
    const response = await post({ ...topicBody, groupId: "cgone" });
    expect([response.status, (await response.json()).error]).toEqual([404, "Project not found."]);
    expect(mocks.refund).toHaveBeenCalledTimes(2);
    expect(mocks.embed).not.toHaveBeenCalled();
  });

  it("stops at the usage limit before calling the model", async () => {
    mocks.consume.mockResolvedValue({ ok: false, tier: "guest", message: "limit" });
    expect((await post(topicBody)).status).toBe(429);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("rejects bad requests and missing sources before counting", async () => {
    for (const body of [
      "not json", { ...topicBody, outline: undefined }, { ...topicBody, outline: { title: "t", slides: [] } }, { ...topicBody, clientRequestId: "x" },
      { ...topicBody, parentId: "../x" }, { ...topicBody, groupId: 3 },
    ]) expect((await post(body)).status).toBe(400);
    mocks.findPages.mockResolvedValueOnce([]);
    expect((await post(noteBody)).status).toBe(404);
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it("refuses a body over 1 MiB", async () => {
    expect((await post({ ...topicBody, padding: "x".repeat(1_100_000) })).status).toBe(413);
    expect(mocks.consume).not.toHaveBeenCalled();
  });
});
