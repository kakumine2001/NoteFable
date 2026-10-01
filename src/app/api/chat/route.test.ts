import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createMessage: vi.fn(),
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
    .map((line) => JSON.parse(line.slice(6))).join("");
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
      .map((line) => JSON.parse(line.slice(6))).join("");
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body.tools).toEqual([{ type: "web_search" }]);
    expect(body.tool_choice).toBe(choice);
    expect(text).toContain("[Example News](<https://example.com/news>)");
    expect(mocks.createMessage.mock.calls.at(-1)?.[0].data.content).toBe(text);
  });
});
