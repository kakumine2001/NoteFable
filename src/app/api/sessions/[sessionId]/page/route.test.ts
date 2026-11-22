import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), messages: vi.fn(), create: vi.fn(), transaction: vi.fn(),
  consume: vi.fn(), refund: vi.fn(), generate: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getOrCreateUser: async () => ({ id: "mine", googleSub: null }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: { session: { findFirst: mocks.session }, message: { findMany: mocks.messages }, $transaction: mocks.transaction },
}));
vi.mock("@/lib/usage-limits", () => ({
  clientNetworkKey: () => null,
  consumeUsage: mocks.consume,
  refundUsage: mocks.refund,
  usageLimitResponse: (result: { message: string }) => Response.json({ error: result.message, code: "usage_limit" }, { status: 429 }),
}));
vi.mock("@/lib/chat-page", async (importOriginal) => ({ ...(await importOriginal<object>()), generatePageMarkdown: mocks.generate }));
import { POST } from "./route";
import { MAX_TRANSCRIPT_MESSAGES } from "@/lib/chat-page";

const sessionId = "chat12345678901234567890";
const ticket = { buckets: [{ key: "user:mine", kind: "chat", day: "2026-11-15" }] };
function post(body: unknown = { model: "claude-haiku-5-5", savedOn: "2026-11-15" }, id = sessionId) {
  return POST(new Request(`https://notefable.example/api/sessions/${id}/page`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }),
    { params: Promise.resolve({ sessionId: id }) });
}

describe("POST /api/sessions/:id/page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ title: "Kanji study" });
    // 新しい順に返る。
    mocks.messages.mockResolvedValue([
      { role: "ASSISTANT", content: "They are characters.", attachments: [] },
      { role: "USER", content: "Explain 漢字", attachments: [] },
    ]);
    mocks.consume.mockResolvedValue({ ok: true, ticket });
    mocks.generate.mockResolvedValue({ markdown: "# Kanji basics\n\n- one\n- two", cutOff: false });
    mocks.create.mockImplementation(async ({ data }) => ({ id: "page1", ...data }));
    mocks.transaction.mockImplementation(async (run: (tx: unknown) => unknown) => run({ notePage: { create: mocks.create } }));
  });

  it("writes the page with the selected model's default effort and saves it for the owner", async () => {
    const response = await post();
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ page: { id: "page1" }, partial: false });
    expect(mocks.session).toHaveBeenCalledWith({ where: { id: sessionId, userId: "mine" }, select: { title: true } });
    expect(mocks.messages.mock.calls[0][0]).toMatchObject({ where: { sessionId, role: { in: ["USER", "ASSISTANT"] } }, take: MAX_TRANSCRIPT_MESSAGES + 1 });
    expect(mocks.messages.mock.calls[0][0].select).not.toHaveProperty("providerContext");
    const call = mocks.generate.mock.calls[0][0];
    expect(call).toMatchObject({ provider: "anthropic", effort: "medium", userId: "mine" });
    expect(call.transcript.indexOf("Explain 漢字")).toBeLessThan(call.transcript.indexOf("They are characters."));
    expect(call.maxOutputTokens).toBe(128_000);
    const data = mocks.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: "mine", title: "Kanji basics", cover: null });
    const last = data.blocks.at(-1);
    expect(last.content[1]).toMatchObject({ type: "link", href: `https://notefable.example/c/${sessionId}` });
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it("saves a page the model cut off, with a notice, and reports a chat too long to read in full", async () => {
    mocks.generate.mockResolvedValue({ markdown: "# Kanji basics\n\nPart one", cutOff: true });
    mocks.messages.mockResolvedValue(Array.from({ length: MAX_TRANSCRIPT_MESSAGES + 1 }, (_, index) => ({ role: index % 2 ? "USER" : "ASSISTANT", content: `m${index}`, attachments: [] })));
    const response = await post();
    expect(response.status).toBe(201);
    expect((await response.json()).partial).toBe(true);
    expect(mocks.generate.mock.calls[0][0].transcript).toContain("Earlier messages were left out");
    expect(mocks.generate.mock.calls[0][0].transcript).not.toContain(`m${MAX_TRANSCRIPT_MESSAGES}\n`);
    const last = mocks.create.mock.calls[0][0].data.blocks.at(-1);
    expect(last.content.at(-1).text).toContain("The page was too long to save in full");
  });

  it("rejects a request body over 1 MiB", async () => {
    expect((await post(JSON.stringify({ model: "x".repeat(1_100_000) }))).status).toBe(413);
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("falls back to the default model for an unknown model", async () => {
    await post({ model: "nope" });
    expect(mocks.generate.mock.calls[0][0].provider).toBe("openai");
  });

  it("returns 404 for someone else's chat without counting usage", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await post()).status).toBe(404);
    expect((await post(undefined, "../x")).status).toBe(404);
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it("rejects an empty chat and invalid JSON before counting usage", async () => {
    mocks.messages.mockResolvedValue([]);
    expect((await post()).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it("returns 429 at the daily limit without calling the model", async () => {
    mocks.consume.mockResolvedValue({ ok: false, tier: "guest", message: "limit" });
    const response = await post();
    expect(response.status).toBe(429);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("refunds the usage when the model fails or the page cannot be saved", async () => {
    mocks.generate.mockRejectedValueOnce(new Error("upstream down"));
    const failed = await post();
    expect(failed.status).toBe(502);
    expect((await failed.json()).error).toBe("Could not create a page from this chat. Try again.");
    expect(mocks.refund).toHaveBeenCalledWith(ticket);
    expect(mocks.create).not.toHaveBeenCalled();

    mocks.refund.mockClear();
    mocks.transaction.mockRejectedValueOnce(new Error("db down"));
    expect((await post()).status).toBe(503);
    expect(mocks.refund).toHaveBeenCalledWith(ticket);
  });
});
