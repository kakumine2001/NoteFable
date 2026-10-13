import { afterEach, describe, expect, it, vi } from "vitest";
import { restoreCompaction, serializeCompaction } from "./chat-compaction";
import { AnthropicStreamTurn, buildAnthropicRequest, createAnthropicStream, extractAnthropicText, toAnthropicMessages } from "./anthropic-messages";

const request = (webSearchMode: "off" | "auto" | "force" = "off") => buildAnthropicRequest({
  model: "claude-haiku-5-5", instructions: "shared prompt", input: [{ role: "user", content: "hello" }], effort: "medium", webSearchMode,
});
const sse = (events: object[]) => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
const ending = (stop_reason = "end_turn") => [{ type: "message_delta", delta: { stop_reason } }, { type: "message_stop" }];

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Claude Messages boundary", () => {
  it("preserves history roles, attachment text and base64 images", () => {
    expect(toAnthropicMessages([
      { role: "assistant", content: "previous reply" },
      { role: "user", content: [{ type: "input_text", text: "PDF text" }, { type: "input_image", image_url: "data:image/png;base64,YWJj" }] },
    ])).toEqual([
      { role: "assistant", content: [{ type: "text", text: "previous reply" }] },
      { role: "user", content: [{ type: "text", text: "PDF text" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "YWJj" } }] },
    ]);
    expect(() => toAnthropicMessages([{ role: "user", content: [{ type: "input_image", image_url: "https://example.com/private.png" }] }])).toThrow();
  });

  it("uses adaptive thinking and native search only when requested", () => {
    expect(request()).toMatchObject({ system: "shared prompt", thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "medium" }, max_tokens: 128000 });
    expect(request()).not.toHaveProperty("tools");
    expect(request()).not.toHaveProperty("temperature");
    expect(request("auto").tool_choice).toEqual({ type: "auto" });
    expect(request("auto").tools?.[0]).not.toHaveProperty("max_uses");
    expect(request("force").tool_choice).toEqual({ type: "tool", name: "web_search" });
  });

  it("enables automatic prompt caching only when asked", () => {
    expect(request()).not.toHaveProperty("cache_control");
    expect(buildAnthropicRequest({ model: "claude-haiku-5-5", instructions: "p", input: [{ role: "user", content: "hi" }], effort: "medium", cache: true }).cache_control).toEqual({ type: "ephemeral" });
  });

  it("extracts only visible text from non-stream responses", () => {
    expect(extractAnthropicText({ content: [{ type: "thinking", thinking: "private" }, { type: "text", text: "answer" }] })).toBe("answer");
  });

  it("keeps thinking and signature separate from answer text and relays citations", () => {
    const turn = new AnthropicStreamTurn();
    turn.push({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } });
    expect(turn.push({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "summary" } })).toEqual([{ type: "response.reasoning_summary_text.delta", item_id: "claude-thinking-0-0", delta: "summary" }]);
    expect(turn.push({ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "signature" } })).toEqual([]);
    turn.push({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } });
    expect(turn.push({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "答え" } })).toEqual([{ type: "response.output_text.delta", delta: "答え" }]);
    expect(turn.push({ type: "content_block_delta", index: 1, delta: { type: "citations_delta", citation: { type: "web_search_result_location", url: "https://example.com", title: "source" } } })).toEqual([{ type: "response.output_text.annotation.added", annotation: { type: "url_citation", url: "https://example.com", title: "source" } }]);
  });

  it("rejects truncation, refusals and premature EOF", () => {
    for (const reason of ["max_tokens", "refusal", "model_context_window_exceeded"]) {
      const turn = new AnthropicStreamTurn();
      turn.push({ type: "message_delta", delta: { stop_reason: reason } });
      expect(() => turn.push({ type: "message_stop" })).toThrow();
    }
    expect(() => new AnthropicStreamTurn().finish()).toThrow("before completion");
    expect(new AnthropicStreamTurn().push({ type: "content_block_start", content_block: { type: "web_search_tool_result", content: { error_code: "unavailable" } } })[0]).toMatchObject({ type: "response.reasoning_summary_text.delta" });
  });

  it("continues pause_turn with native blocks intact and no duplicated text", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-only");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sse([
        { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
        { type: "content_block_stop", index: 1 },
        { type: "content_block_start", index: 0, content_block: { type: "server_tool_use", id: "tool1", name: "web_search", input: {} } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"today"}' } },
        { type: "content_block_stop", index: 0 }, ...ending("pause_turn"),
      ]))
      .mockResolvedValueOnce(sse([{ type: "content_block_start", index: 0, content_block: { type: "text", text: "回答" } }, ...ending()]));
    vi.stubGlobal("fetch", fetchMock);
    const output = await new Response(await createAnthropicStream(request("force"))).text();
    expect(output).toContain('"delta":"回答"');
    expect(output.match(/response.completed/g)).toHaveLength(1);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondBody.tool_choice).toEqual({ type: "auto" });
    expect(secondBody.messages.at(-1)).toEqual({ role: "assistant", content: [{ type: "server_tool_use", id: "tool1", name: "web_search", input: { query: "today" } }] });
    expect(fetchMock.mock.calls[0][1].headers["x-api-key"]).toBe("test-only");
  });

  it("adds StudyMate tools beside native search in the provider's schema", () => {
    const body = buildAnthropicRequest({
      model: "claude-haiku-5-5", instructions: "p", input: [{ role: "user", content: "hi" }], effort: "medium",
      customTools: [{ name: "read_page", description: "Read", parameters: { type: "object" } }],
    });
    expect(body.tools).toEqual([{ name: "read_page", description: "Read", input_schema: { type: "object" } }]);
    expect(body.tool_choice).toEqual({ type: "auto" });
  });

  const toolTurn = (extra: object[] = []) => sse([
    ...extra,
    { type: "content_block_start", index: 1, content_block: { type: "thinking", thinking: "", signature: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "signature_delta", signature: "sig" } },
    { type: "content_block_start", index: 2, content_block: { type: "text", text: "Let me check." } },
    { type: "content_block_start", index: 3, content_block: { type: "tool_use", id: "call1", name: "read_page", input: {} } },
    { type: "content_block_delta", index: 3, delta: { type: "input_json_delta", partial_json: '{"pageId":"p1"}' } },
    { type: "content_block_stop", index: 3 }, ...ending("tool_use"),
  ]);

  it("runs client tools and continues with thinking, tool_use and tool_result paired", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-only");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(toolTurn())
      .mockResolvedValueOnce(sse([{ type: "content_block_start", index: 0, content_block: { type: "text", text: "It says hi." } }, ...ending()]));
    vi.stubGlobal("fetch", fetchMock);
    const runTool = vi.fn().mockResolvedValue({ content: "# Notes\n\nhi", label: "Read “Notes”" });
    const output = await new Response(await createAnthropicStream(request(), undefined, runTool)).text();
    expect(runTool).toHaveBeenCalledWith("read_page", { pageId: "p1" });
    expect(output).toContain('"type":"studymate.tool","id":"call1","name":"read_page","status":"running"');
    expect(output).toContain('"status":"done","label":"Read “Notes”"');
    expect(output).toContain('"delta":"\\n\\n"');
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second.messages.slice(-2)).toEqual([
      { role: "assistant", content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: "Let me check." },
        { type: "tool_use", id: "call1", name: "read_page", input: { pageId: "p1" } },
      ] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call1", content: "# Notes\n\nhi" }] },
    ]);
  });

  it("reports tool failures to the model instead of aborting", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-only");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(toolTurn())
      .mockResolvedValueOnce(sse([{ type: "content_block_start", index: 0, content_block: { type: "text", text: "Sorry." } }, ...ending()]));
    vi.stubGlobal("fetch", fetchMock);
    await new Response(await createAnthropicStream(request(), undefined, vi.fn().mockRejectedValue(new Error("db down")))).text();
    const result = JSON.parse(fetchMock.mock.calls[1][1].body).messages.at(-1).content[0];
    expect(result).toMatchObject({ type: "tool_result", tool_use_id: "call1", is_error: true });
    expect(result.content).not.toContain("db down");
  });

  it("fails when Claude asks for a tool that was not offered", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-only");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(toolTurn()));
    const output = await new Response(await createAnthropicStream(request())).text();
    expect(output).toContain("unavailable tool");
  });

  it("keeps tool_result after tool_use in a compaction checkpoint", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-only");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(toolTurn([{ type: "content_block_start", index: 0, content_block: { type: "compaction", content: "summary" } }]))
      .mockResolvedValueOnce(sse([{ type: "content_block_start", index: 0, content_block: { type: "text", text: "Done." } }, ...ending()])));
    const onContext = vi.fn();
    await new Response(await createAnthropicStream(request(), onContext, async () => ({ content: "page", label: "Read" }))).text();
    expect(onContext.mock.calls[0][0].map((message: { role: string; content: { type: string }[] }) => [message.role, message.content.map((block) => block.type)])).toEqual([
      ["assistant", ["compaction", "text", "tool_use"]],
      ["user", ["tool_result"]],
      ["assistant", ["text"]],
    ]);
  });

  it("replays a saved tool checkpoint as a valid follow-up request", () => {
    const items = [
      { role: "assistant", content: [{ type: "compaction", content: "summary" }, { type: "tool_use", id: "call1", name: "read_page", input: { pageId: "p1" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call1", content: "page" }] },
      { role: "assistant", content: [{ type: "text", text: "Done." }] },
    ];
    const saved = { id: "a1", providerContext: serializeCompaction("anthropic", "claude-haiku-5-5", items, ["u1"]) };
    const restored = restoreCompaction([saved, { id: "u1", providerContext: null }], "anthropic", "claude-haiku-5-5");
    expect(restored.history).toEqual([]);
    const messages = buildAnthropicRequest({ model: "claude-haiku-5-5", instructions: "p", input: [{ role: "user", content: "next" }], effort: "medium", nativeContext: restored.items }).messages;
    expect(messages.map((message) => message.role)).toEqual(["assistant", "user", "assistant", "user"]);
    expect(messages[1].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "call1" });
  });

  it("answers extra parallel calls with errors and stops on client disconnect", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-only");
    const calls = Array.from({ length: 6 }, (_, index) => [
      { type: "content_block_start", index, content_block: { type: "tool_use", id: `c${index}`, name: "read_page", input: {} } },
      { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: "{broken" } },
      { type: "content_block_stop", index },
    ]).flat();
    const fetchMock = vi.fn().mockResolvedValueOnce(sse([...calls, ...ending("tool_use")]));
    vi.stubGlobal("fetch", fetchMock);
    const abort = new AbortController();
    const runTool = vi.fn(async () => { abort.abort(); return { content: "x", label: "Read" }; });
    await new Response(await createAnthropicStream(request(), undefined, runTool, abort.signal)).text();
    // 壊れた引数 JSON は空オブジェクトとしてツールへ渡し、ツールの入力検証に任せる。
    expect(runTool).toHaveBeenCalledWith("read_page", {});
    expect(runTool).toHaveBeenCalledTimes(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("drops blank text blocks while preserving image-only messages", () => {
    expect(toAnthropicMessages([{ role: "user", content: [{ type: "input_text", text: " " }, { type: "input_image", image_url: "data:image/png;base64,YWJj" }] }])[0].content).toHaveLength(1);
    expect(() => toAnthropicMessages([{ role: "user", content: "" }])).toThrow("no text or image");
  });
});
