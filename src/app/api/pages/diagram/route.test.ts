import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findPage: vi.fn(), findMessage: vi.fn(), consume: vi.fn(), refund: vi.fn(), generate: vi.fn(), create: vi.fn(), embed: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getOrCreateUser: async () => ({ id: "mine", googleSub: null }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { notePage: { findFirst: mocks.findPage }, message: { findFirst: mocks.findMessage } } }));
vi.mock("@/lib/usage-limits", () => ({
  clientNetworkKey: () => null,
  consumeUsage: mocks.consume,
  refundUsage: mocks.refund,
  usageLimitResponse: (result: { message: string }) => Response.json({ error: result.message, code: "usage_limit" }, { status: 429 }),
}));
vi.mock("@/lib/one-shot-model", async (importOriginal) => ({ ...(await importOriginal<object>()), generateOneShotText: mocks.generate }));
vi.mock("@/lib/note-create", () => ({ createCanvasPage: mocks.create }));
vi.mock("@/lib/note-embeddings", () => ({ scheduleNoteEmbeddingSync: mocks.embed }));
import { POST } from "./route";
import { aiRequestPageId } from "@/lib/page-ai/one-shot";
import { DIAGRAM_INSTRUCTIONS } from "@/lib/whiteboard/diagram";

const ticket = { buckets: [{ key: "user:mine", kind: "chat", day: "2026-11-25" }] };
const requestId = "req-0123456789";
const FLOW = "# 登录流程\n\n```mermaid\nflowchart TD\n  A[开始] --> B{已登录?}\n  B -->|是| C[工作区]\n```";

function post(body: unknown) {
  return POST(new Request("https://notefable.example/api/pages/diagram", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
}

const answerBody = { source: "answer", messageId: "cmsg123456789012345678901", model: "claude-haiku-5-5", clientRequestId: requestId };
const noteBody = { source: "note", pageId: "cnote12345678901234567890", clientRequestId: requestId };

describe("POST /api/pages/diagram", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 1 回目の findFirst は同じ要求で作ったページの確認（無い）、2 回目はノートの材料。
    mocks.findPage.mockImplementation(async ({ where }: { where: { id: string; kind?: string } }) =>
      where.kind === "note" ? { id: where.id, kind: "note", title: "光合作用", blocks: [{ id: "b1", type: "paragraph", props: {}, content: [{ type: "text", text: "光反应和暗反应", styles: {} }], children: [] }] } : null);
    mocks.findMessage.mockImplementation(async ({ where }: { where: { role: string } }) => where.role === "ASSISTANT"
      ? { id: "cmsg123456789012345678901", sessionId: "s1", content: "先登录，再进入工作区。", parentId: "cq", createdAt: new Date(), session: { title: "登录" } }
      : { content: "怎么登录？" });
    mocks.consume.mockResolvedValue({ ok: true, ticket });
    mocks.generate.mockResolvedValue({ text: FLOW, cutOff: false });
    mocks.create.mockImplementation(async (_user: string, _kind: string, input: { title: string }, options: { id: string; parentId: string | null }) => ({
      page: { id: options.id, kind: "whiteboard", title: input.title, parentId: options.parentId, position: 0, icon: null, version: 0, groupId: null, aiUpdatedAt: new Date(), blocks: [] },
      data: {},
    }));
  });

  it("draws an answer as a new whiteboard made from the reply and marks it as AI content", async () => {
    const response = await post(answerBody);
    expect(response.status).toBe(201);
    const { page } = await response.json();
    expect(page).toMatchObject({ id: aiRequestPageId("mine", "diagram", requestId), kind: "whiteboard", title: "登录流程", parentId: null });
    expect(page).not.toHaveProperty("blocks");
    // 表示中の枝の回答だけを、本人の会話から読む。
    expect(mocks.findMessage.mock.calls[0][0].where).toEqual({ id: "cmsg123456789012345678901", role: "ASSISTANT", active: true, session: { userId: "mine" } });
    expect(mocks.findMessage.mock.calls[1][0].where).toMatchObject({ id: "cq", role: "USER", active: true });
    const call = mocks.generate.mock.calls[0][0];
    expect(call).toMatchObject({ provider: "anthropic", effort: "medium", instructions: DIAGRAM_INSTRUCTIONS, userId: "mine" });
    expect(call.input[0].content).toContain("<question>\n怎么登录？\n</question>");
    expect(call.input[0].content).toContain("先登录，再进入工作区。");
    const [, kind, input, options] = mocks.create.mock.calls[0];
    expect(kind).toBe("whiteboard");
    expect(options).toMatchObject({ ai: true, parentId: null, id: aiRequestPageId("mine", "diagram", requestId) });
    expect((input.data.elements as { type: string }[]).filter((element) => element.type === "arrow")).toHaveLength(2);
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.embed).toHaveBeenCalledWith("mine", [page.id]);
  });

  it("draws a note as a sub-page of that note and keeps the note text delimited as private data", async () => {
    const response = await post(noteBody);
    expect(response.status).toBe(201);
    expect(mocks.findPage.mock.calls[1][0].where).toEqual({ id: noteBody.pageId, userId: "mine", deletedAt: null, kind: "note" });
    expect(mocks.create.mock.calls[0][3]).toMatchObject({ parentId: noteBody.pageId });
    const material = mocks.generate.mock.calls[0][0].input[0].content as string;
    expect(material).toMatch(/<<<page-content [0-9a-f]{12}>>>\n光反应和暗反应\n<<<end page-content/);
  });

  it("returns the page made for the same request without charging again", async () => {
    mocks.findPage.mockResolvedValueOnce({ id: "cexisting", kind: "whiteboard", title: "Old", deletedAt: null });
    const response = await post(answerBody);
    expect(response.status).toBe(200);
    expect((await response.json()).page).toMatchObject({ id: "cexisting" });
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("does not hand back a page from the same request that is now in the trash", async () => {
    mocks.findPage.mockResolvedValueOnce({ id: "cexisting", deletedAt: new Date() });
    expect((await post(answerBody)).status).toBe(404);
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it("asks the model once more with the error when the diagram cannot be converted, for one charge", async () => {
    mocks.generate.mockResolvedValueOnce({ text: "# Pets\n```mermaid\npie title Pets\n  \"Dogs\" : 3\n```", cutOff: false });
    const response = await post(answerBody);
    expect(response.status).toBe(201);
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    const retry = mocks.generate.mock.calls[1][0].input;
    expect(retry).toHaveLength(3);
    expect(retry[1]).toMatchObject({ role: "assistant" });
    expect(retry[2].content).toMatch(/could not be drawn/);
    expect(mocks.consume).toHaveBeenCalledTimes(1);
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it("refunds and shows the source when the retry fails too", async () => {
    mocks.generate.mockResolvedValue({ text: "```mermaid\nflowchart TD\n  A[ -->\n```", cutOff: false });
    const response = await post(answerBody);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "diagram_invalid", source: "flowchart TD\n  A[ -->" });
    expect(mocks.refund).toHaveBeenCalledWith(ticket);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([
    ["an upstream error", () => mocks.generate.mockRejectedValue(new Error("boom"))],
    ["a reply cut off by the output limit", () => mocks.generate.mockResolvedValue({ text: "```mermaid\nflowchart TD\n  A", cutOff: true })],
  ])("refunds after %s", async (_name, arrange) => {
    arrange();
    expect((await post(answerBody)).status).toBe(502);
    expect(mocks.refund).toHaveBeenCalledWith(ticket);
  });

  it("returns the page created by a request that arrived at the same time, and refunds this one", async () => {
    mocks.create.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    mocks.findPage.mockReset();
    mocks.findPage.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "cother", deletedAt: null });
    const response = await post(answerBody);
    expect(response.status).toBe(200);
    expect((await response.json()).page).toMatchObject({ id: "cother" });
    expect(mocks.refund).toHaveBeenCalledTimes(1);
  });

  it("stops at the usage limit before calling the model", async () => {
    mocks.consume.mockResolvedValue({ ok: false, tier: "guest", message: "limit" });
    expect((await post(answerBody)).status).toBe(429);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("rejects bad requests and missing or empty sources before charging", async () => {
    expect((await post({ ...answerBody, clientRequestId: "x" })).status).toBe(400);
    expect((await post({ source: "topic", text: "x", clientRequestId: requestId })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    mocks.findMessage.mockResolvedValueOnce(null);
    expect((await post(answerBody)).status).toBe(404);
    mocks.findMessage.mockResolvedValueOnce({ id: "m", sessionId: "s1", content: "  ", parentId: null, createdAt: new Date(), session: { title: "t" } }).mockResolvedValueOnce(null);
    expect((await post(answerBody)).status).toBe(400);
    expect(mocks.consume).not.toHaveBeenCalled();
  });
});
