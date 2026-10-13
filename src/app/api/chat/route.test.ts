import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createMessage: vi.fn(),
  updateManySession: vi.fn(),
  fetch: vi.fn(),
  findMessages: vi.fn<(args: object) => Promise<never[]>>().mockResolvedValue([]),
  runPageTool: vi.fn(),
  attachProposals: vi.fn().mockResolvedValue({ count: 0 }),
}));

vi.mock("@/lib/page-tools", async (importOriginal) => ({ ...await importOriginal<object>(), runPageTool: mocks.runPageTool }));

vi.mock("@/lib/auth", () => ({ getOrCreateAnonymousUser: async () => ({ id: "user" }) }));
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
vi.mock("@/lib/prisma", () => { const prisma: Record<string, unknown> = {
  session: {
    create: async () => ({ id: "session", title: "Test" }),
    update: async () => ({}),
    updateMany: mocks.updateManySession,
    findFirst: async () => ({ id: "session", title: "Existing chat" }),
  },
  message: { create: mocks.createMessage, findMany: mocks.findMessages },
  noteProposal: { updateMany: mocks.attachProposals },
};
prisma.$transaction = async (fn: (tx: unknown) => unknown) => fn(prisma);
return { prisma }; });

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
    // DeepSeek には検索を送らず、Pages の function ツールだけを送る。
    expect(body.tools.map((tool: { type: string; name?: string }) => tool.name ?? tool.type)).toEqual(["search_notes", "read_note", "propose_note_edit", "propose_note_create"]);
    expect(body.tool_choice).toBe("auto");
    expect(body.instructions).toContain("Web search is unavailable");
    expect(mocks.findMessages.mock.calls[0][0]).not.toHaveProperty("take");
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
    ["force", { type: "allowed_tools", mode: "required", tools: [{ type: "web_search" }] }],
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
    expect(body.tools.map((tool: { type: string; name?: string }) => tool.name ?? tool.type)).toEqual(["web_search", "search_notes", "read_note", "propose_note_edit", "propose_note_create"]);
    expect(body.tool_choice).toEqual(choice);
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
    expect(body.include).toEqual(["reasoning.encrypted_content", "web_search_call.action.sources"]);
    expect(events.filter((event) => typeof event !== "string").map((event) => event.activity)).toEqual([
      { type: "thought", id: "rs_1:0", delta: "**Checking**" },
      { type: "web", id: "ws_1", status: "running" },
      { type: "web", id: "ws_1", status: "done",
        action: { kind: "search", queries: ["next 16"], sources: ["https://nextjs.org/blog/next-16"] } },
    ]);
    expect(mocks.createMessage.mock.calls.at(-1)?.[0].data.content).toBe("回答");
  });
});

describe("Pages tools across providers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createMessage.mockResolvedValue({ id: "message" });
    mocks.runPageTool.mockResolvedValue({ content: "# Notes", label: "Read “Notes”" });
  });

  const sse = (events: unknown[]) => new Response(events.map((event) => `data: ${JSON.stringify(event)}

`).join(""));
  const functionCall = { type: "function_call", id: "fc_1", call_id: "c1", name: "read_note", arguments: '{"noteId":"p1","userId":"other"}' };
  const responsesRounds = () => [
    sse([{ type: "response.output_item.done", item: functionCall }, { type: "response.completed", response: { output: [functionCall] } }]),
    sse([{ type: "response.output_text.delta", delta: "It says hi." }, { type: "response.completed", response: { output: [] } }]),
  ];
  const claudeRounds = () => [
    sse([
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "read_note", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"noteId":"p1","userId":"other"}' } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" } }, { type: "message_stop" },
    ]),
    sse([
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "It says hi." } },
      { type: "message_delta", delta: { stop_reason: "end_turn" } }, { type: "message_stop" },
    ]),
  ];

  it.each([
    ["gpt-6-luna", responsesRounds],
    ["deepseek-flash", responsesRounds],
    ["claude-haiku-5-5", claudeRounds],
  ])("%s runs page tools as the session owner and saves only the answer", async (model, rounds) => {
    for (const response of rounds()) mocks.fetch.mockResolvedValueOnce(response);
    const form = new FormData();
    form.set("message", "我那页笔记写了什么？");
    form.set("model", model);
    form.set("sessionId", "existing");
    form.set("webSearch", "off");
    const raw = await (await POST(new Request("http://localhost/api/chat", { method: "POST", body: form }))).text();
    expect(mocks.runPageTool).toHaveBeenCalledWith("read_note", { noteId: "p1", userId: "other" }, "user", "session");
    expect(raw).toContain('"activity":{"type":"tool","id"');
    expect(mocks.createMessage.mock.calls.at(-1)?.[0].data.content).toBe("It says hi.");
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).instructions ?? JSON.parse(mocks.fetch.mock.calls[0][1].body).system).toContain("search_notes");
  });
});

describe("Pages tool proposals are stored with the answer", () => {
  it("attaches the proposals made during a turn to the saved assistant message", async () => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createMessage.mockResolvedValue({ id: "message" });
    const functionCall = { type: "function_call", id: "fc_1", call_id: "c1", name: "propose_note_edit", arguments: "{}" };
    mocks.fetch
      .mockResolvedValueOnce(new Response([{ type: "response.output_item.done", item: functionCall }, { type: "response.completed", response: { output: [functionCall] } }].map((e) => `data: ${JSON.stringify(e)}

`).join("")))
      .mockResolvedValueOnce(new Response([{ type: "response.output_text.delta", delta: "Proposed." }, { type: "response.completed", response: { output: [] } }].map((e) => `data: ${JSON.stringify(e)}

`).join("")));
    mocks.runPageTool.mockResolvedValue({ content: "proposed", label: "Proposed", events: [{ type: "studymate.proposal", id: "prop1" }, { type: "studymate.create_proposal", id: "prop2" }] });
    const form = new FormData();
    form.set("message", "edit my note");
    form.set("model", "gpt-6-luna");
    form.set("sessionId", "existing");
    form.set("webSearch", "off");
    await (await POST(new Request("http://localhost/api/chat", { method: "POST", body: form }))).text();
    expect(mocks.attachProposals).toHaveBeenCalledWith({ where: { id: { in: ["prop1", "prop2"] }, userId: "user" }, data: { messageId: "message" } });
  });
});

describe("Claude chat response boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.createMessage.mockResolvedValue({ id: "message" });
  });

  it("routes to Messages and saves visible text plus real-shaped search citations", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response([
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Checking" } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "hidden-signature" } },
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Claude回答" } },
      { type: "content_block_delta", index: 1, delta: { type: "citations_delta", citation: { type: "web_search_result_location", url: "https://example.com/news", title: "News", encrypted_index: "hidden-index" } } },
      { type: "message_delta", delta: { stop_reason: "end_turn" } }, { type: "message_stop" },
    ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")));
    const form = new FormData();
    form.set("message", "最新ニュースは？");
    form.set("model", "claude-haiku-5-5");
    form.set("sessionId", "existing");
    const response = await POST(new Request("http://localhost/api/chat", { method: "POST", body: form }));
    const raw = await response.text();
    expect(mocks.fetch.mock.calls[0][0]).toBe("https://api.anthropic.com/v1/messages");
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({ max_tokens: 128000, output_config: { effort: "medium" }, tool_choice: { type: "auto" }, cache_control: { type: "ephemeral" } });
    expect(mocks.findMessages.mock.calls[0][0]).not.toHaveProperty("take");
    expect(raw).not.toContain("hidden-signature");
    expect(raw).not.toContain("hidden-index");
    const saved = mocks.createMessage.mock.calls.at(-1)?.[0].data;
    expect(saved.content).toBe("Claude回答\n\nSources:\n- [News](<https://example.com/news>)");
    expect(saved.model).toBe("claude-haiku-5-5");
    expect(saved.reasoningEffort).toBe("MEDIUM");
  });

  it("uses Anthropic low effort for title generation without search", async () => {
    mocks.fetch
      .mockResolvedValueOnce(new Response([
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "回答" } },
        { type: "message_delta", delta: { stop_reason: "end_turn" } }, { type: "message_stop" },
      ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")))
      .mockResolvedValueOnce(Response.json({ content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: "「Claude確認」" }], stop_reason: "end_turn" }));
    const form = new FormData();
    form.set("message", "Claudeの確認");
    form.set("model", "claude-haiku-5-5");
    const response = await POST(new Request("http://localhost/api/chat", { method: "POST", body: form }));
    await response.text();
    const titleBody = JSON.parse(mocks.fetch.mock.calls[1][1].body);
    expect(titleBody).toMatchObject({ output_config: { effort: "low" }, stream: false });
    expect(titleBody).not.toHaveProperty("tools");
    expect(titleBody).not.toHaveProperty("cache_control");
    expect(mocks.updateManySession).toHaveBeenCalledWith({ where: { id: "session", userId: "user", title: "Claudeの確認" }, data: { title: "Claude確認" } });
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
