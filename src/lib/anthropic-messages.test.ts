import { afterEach, describe, expect, it, vi } from "vitest";
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
    for (const reason of ["max_tokens", "refusal", "tool_use", "model_context_window_exceeded"]) {
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

  it("drops blank text blocks while preserving image-only messages", () => {
    expect(toAnthropicMessages([{ role: "user", content: [{ type: "input_text", text: " " }, { type: "input_image", image_url: "data:image/png;base64,YWJj" }] }])[0].content).toHaveLength(1);
    expect(() => toAnthropicMessages([{ role: "user", content: "" }])).toThrow("no text or image");
  });
});
