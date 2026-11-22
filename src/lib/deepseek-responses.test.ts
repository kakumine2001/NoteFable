import { describe, expect, it } from "vitest";
import {
  buildDeepSeekResponsesRequest,
  deepSeekWebSearchTool,
  parseDeepSeekResponsesDelta,
} from "./deepseek-responses";

describe("DeepSeek Responses API helpers", () => {
  it("selects the built-in web search tool for the resolved upstream DeepSeek model", () => {
    expect(deepSeekWebSearchTool("deepseek-flash")).toEqual({ type: "deepseek_web_search" });
    expect(deepSeekWebSearchTool("deepseek-v4-flash")).toEqual({ type: "deepseek_web_search" });
    expect(deepSeekWebSearchTool("DeepSeek-V4.1-Flash-1017")).toEqual({ type: "deepseek_web_search" });
    expect(deepSeekWebSearchTool("deepseek-v4-pro")).toEqual({ type: "web_search" });
    expect(deepSeekWebSearchTool("deepseek-v4-pro-2026")).toEqual({ type: "web_search" });
  });
  it("rejects incomplete replies and unhandled tool calls", () => {
    expect(() => parseDeepSeekResponsesDelta(JSON.stringify({ type: "response.incomplete" }))).toThrow("incomplete");
    expect(() => parseDeepSeekResponsesDelta(JSON.stringify({
      type: "response.output_item.added", item: { type: "function_call" },
    }))).toThrow("unavailable tool");
  });
  it("builds a Responses request without Chat Completions fields", () => {
    const request = buildDeepSeekResponsesRequest({
      model: "deepseek-flash",
      instructions: "Classify the request.",
      input: "USER: What is the latest news?",
      effort: "low",
      maxOutputTokens: 16,
      stream: false,
    });

    expect(request).toEqual({
      model: "deepseek-flash",
      instructions: "Classify the request.",
      input: "USER: What is the latest news?",
      reasoning: { effort: "low" },
      max_output_tokens: 16,
      stream: false,
    });
    expect(request).not.toHaveProperty("messages");
    expect(request).not.toHaveProperty("choices");
    expect(request).not.toHaveProperty("previous_response_id");
    expect(request).not.toHaveProperty("safety_identifier");
    expect(request).not.toHaveProperty("store");
    expect(request).not.toHaveProperty("tools");
    expect(request).not.toHaveProperty("tool_choice");
  });

  it("preserves image parts in vision input", () => {
    const imageInput = [
      {
        role: "user",
        content: [
          { type: "input_text", text: "What is in this image?" },
          { type: "input_image", image_url: "data:image/png;base64,abc" },
        ],
      },
    ];

    const request = buildDeepSeekResponsesRequest({
      model: "deepseek-flash",
      instructions: "Describe the image.",
      input: imageInput,
      stream: true,
    });

    expect(request.input).toEqual(imageInput);
  });

  it("forwards only output text deltas from the Responses stream", () => {
    expect(
      parseDeepSeekResponsesDelta(
        JSON.stringify({ type: "response.output_text.delta", delta: "Hello" }),
      ),
    ).toBe("Hello");
    expect(
      parseDeepSeekResponsesDelta(
        JSON.stringify({ type: "response.reasoning_text.delta", delta: "hidden" }),
      ),
    ).toBe("");
    expect(
      parseDeepSeekResponsesDelta(
        JSON.stringify({ type: "response.web_search_call.searching" }),
      ),
    ).toBe("");
    expect(parseDeepSeekResponsesDelta(JSON.stringify({ type: "response.completed" }))).toBe("");
  });

  it("raises a useful error for a failed Responses event", () => {
    expect(() =>
      parseDeepSeekResponsesDelta(
        JSON.stringify({
          type: "response.failed",
          response: { error: { message: "temporary outage" } },
        }),
      ),
    ).toThrow("temporary outage");
  });
});
