import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createMessage: vi.fn(),
  updateManySession: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getOrCreateAnonymousUser: async () => ({ id: "user" }) }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => ({ limited: false }),
  rateLimitHeaders: () => ({}),
}));
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
vi.mock("@/lib/prisma", () => ({ prisma: {
  session: {
    create: async () => ({ id: "session", title: "Test" }),
    update: async () => ({}),
    updateMany: mocks.updateManySession,
    findFirst: async () => ({ id: "session", title: "Existing chat" }),
  },
  message: { create: mocks.createMessage, findMany: async () => [] },
} }));

import { POST } from "./route";

async function send(events: unknown[]) {
  mocks.fetch.mockResolvedValue(new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")));
  const form = new FormData();
  form.set("message", "Apple Watchで中国語を入力するには？");
  form.set("model", "deepseek-flash");
  form.set("webSearch", "force");
  const response = await POST(new Request("http://localhost/api/chat", { method: "POST", body: form }));
  const text = (await response.text()).split("\n").filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6))).filter((data) => typeof data === "string").join("");
  const saved = mocks.createMessage.mock.calls.map(([arg]) => arg.data)
    .filter((data) => data.role === "ASSISTANT");
  expect(saved).toHaveLength(1);
  expect(saved[0].content).toBe(text);
  return text;
}

describe("DeepSeek chat response boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createMessage.mockResolvedValue({ id: "message" });
  });

  it("normalizes old search requests and persists an ordinary answer", async () => {
    expect(await send([
      { type: "response.output_text.delta", delta: "通常の回答" },
      { type: "response.completed" },
    ])).toBe("通常の回答");
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body.instructions).toContain("Web search is unavailable");
  });

  it("never forwards or persists leaked tool text split across deltas", async () => {
    const text = await send([
      { type: "response.output_text.delta", delta: "<｜" },
      { type: "response.output_text.delta", delta: "｜DSML｜｜ calls>" },
      { type: "response.completed" },
    ]);
    expect(text).toContain("Request failed:");
    expect(text).not.toContain("DSML");
    expect(text).not.toContain("<｜");
  });

  it.each([
    [{ type: "response.completed" }],
    [{ type: "response.output_text.delta", delta: "途中" }],
    [{ type: "response.output_text.delta", delta: "途中" }, { type: "response.incomplete" }],
    [{ type: "response.output_item.added", item: { type: "function_call" } }],
  ])("reports an unsuccessful stream without a successful empty message: %j", async (...events) => {
    expect(await send(events)).toContain("Request failed:");
  });
});

describe("OpenAI web search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createMessage.mockResolvedValue({ id: "message" });
  });

  it.each([
    ["auto", "auto"],
    ["force", "required"],
  ])("passes %s search through and preserves cited links", async (mode, choice) => {
    mocks.fetch.mockResolvedValue(new Response([
      { type: "response.output_text.delta", delta: "検索結果。" },
      { type: "response.output_text.annotation.added", annotation: {
        type: "url_citation", url: "https://example.com/news", title: "Example News",
      } },
      { type: "response.completed" },
    ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")));

    const form = new FormData();
    form.set("message", "最新ニュースは？");
    form.set("model", "gpt-6-luna");
    form.set("webSearch", mode);
    const response = await POST(new Request("http://localhost/api/chat", { method: "POST", body: form }));
    const text = (await response.text()).split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6))).filter((data) => typeof data === "string").join("");
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body.tools).toEqual([{ type: "web_search" }]);
    expect(body.tool_choice).toBe(choice);
    expect(text).toContain("[Example News](<https://example.com/news>)");
    expect(mocks.createMessage.mock.calls.at(-1)?.[0].data.content).toBe(text);
  });

  it("requests reasoning summaries and search sources, and streams them as activity only", async () => {
    mocks.fetch.mockResolvedValue(new Response([
      { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 0, delta: "**Checking**" },
      { type: "response.output_item.added", item: { id: "ws_1", type: "web_search_call", status: "in_progress" } },
      { type: "response.output_item.done", item: { id: "ws_1", type: "web_search_call", status: "completed",
        action: { type: "search", query: "next 16", queries: ["next 16"], sources: [{ type: "url", url: "https://nextjs.org/blog/next-16" }] } } },
      { type: "response.output_text.delta", delta: "回答" },
      { type: "response.completed" },
    ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")));

    const form = new FormData();
    form.set("message", "Next.js 16 の変更点は？");
    form.set("model", "gpt-6-luna");
    form.set("reasoning", "high");
    form.set("webSearch", "auto");
    const response = await POST(new Request("http://localhost/api/chat", { method: "POST", body: form }));
    const events = (await response.text()).split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)));
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);

    expect(body.reasoning).toEqual({ effort: "high", summary: "auto" });
    expect(body.include).toEqual(["web_search_call.action.sources"]);
    expect(events.filter((event) => typeof event !== "string").map((event) => event.activity)).toEqual([
      { type: "thought", id: "rs_1:0", delta: "**Checking**" },
      { type: "web", id: "ws_1", status: "running" },
      { type: "web", id: "ws_1", status: "done",
        action: { kind: "search", queries: ["next 16"], sources: ["https://nextjs.org/blog/next-16"] } },
    ]);
    expect(mocks.createMessage.mock.calls.at(-1)?.[0].data.content).toBe("回答");
  });
});

describe("AI chat title", () => {
  const sse = (events: unknown[]) =>
    new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
  const titleResponse = (text: string) =>
    new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text }] }] }));

  async function sendFirst(fields: Record<string, string>) {
    const form = new FormData();
    form.set("message", "Prismのmigrateで失敗した原因を教えて");
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    const response = await POST(new Request("http://localhost/api/chat", { method: "POST", body: form }));
    await response.text();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createMessage.mockResolvedValue({ id: "message" });
  });

  it("replaces the placeholder with an AI title built from the first message only", async () => {
    mocks.fetch
      .mockResolvedValueOnce(sse([{ type: "response.output_text.delta", delta: "回答" }, { type: "response.completed" }]))
      .mockResolvedValueOnce(titleResponse("「Prisma migrate の失敗原因」"));
    await sendFirst({ model: "gpt-6-luna" });

    const titleBody = JSON.parse(mocks.fetch.mock.calls[1][1].body);
    expect(titleBody.input).toBe("Prismのmigrateで失敗した原因を教えて");
    expect(titleBody.reasoning).toEqual({ effort: "none" });
    expect(titleBody.stream).toBe(false);
    expect(titleBody).not.toHaveProperty("tools");
    expect(mocks.updateManySession).toHaveBeenCalledWith({
      where: { id: "session", userId: "user", title: "Prismのmigrateで失敗した原因を教えて" },
      data: { title: "Prisma migrate の失敗原因" },
    });
  });

  it("keeps the placeholder when the title request fails", async () => {
    mocks.fetch
      .mockResolvedValueOnce(sse([{ type: "response.output_text.delta", delta: "回答" }, { type: "response.completed" }]))
      .mockResolvedValueOnce(new Response("{}", { status: 500 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await sendFirst({ model: "gpt-6-luna" });
    expect(mocks.updateManySession).not.toHaveBeenCalled();
  });

  it("does not generate a title for later messages in an existing chat", async () => {
    mocks.fetch.mockResolvedValueOnce(
      sse([{ type: "response.output_text.delta", delta: "回答" }, { type: "response.completed" }]),
    );
    await sendFirst({ model: "gpt-6-luna", sessionId: "session" });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.updateManySession).not.toHaveBeenCalled();
  });
});

describe("AI chat title with DeepSeek", () => {
  it("sends the title request to DeepSeek with a budget large enough for its reasoning", async () => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createMessage.mockResolvedValue({ id: "message" });
    const sse = [{ type: "response.output_text.delta", delta: "回答" }, { type: "response.completed" }]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
    mocks.fetch
      .mockResolvedValueOnce(new Response(sse))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output: [{ type: "reasoning" }, { type: "message", content: [{ type: "output_text", text: "typeとinterfaceの使い分け" }] }],
      })));
    const form = new FormData();
    form.set("message", "TypeScriptのtypeとinterfaceの違いを教えて");
    form.set("model", "deepseek-flash");
    await (await POST(new Request("http://localhost/api/chat", { method: "POST", body: form }))).text();

    const titleBody = JSON.parse(mocks.fetch.mock.calls[1][1].body);
    expect(titleBody.reasoning).toEqual({ effort: "low" });
    expect(titleBody.max_output_tokens).toBeGreaterThanOrEqual(1024);
    expect(titleBody.stream).toBe(false);
    expect(mocks.updateManySession).toHaveBeenCalledWith(expect.objectContaining({
      data: { title: "typeとinterfaceの使い分け" },
    }));
  });
});
