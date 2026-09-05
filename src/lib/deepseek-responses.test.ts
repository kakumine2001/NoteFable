import { describe, expect, it } from "vitest";
import {
  buildDeepSeekResponsesRequest,
  parseDeepSeekResponsesDelta,
} from "./deepseek-responses";

describe("DeepSeek Responses API helpers", () => {
  it("builds a Responses request without Chat Completions fields", () => {
    const request = buildDeepSeekResponsesRequest({
      model: "deepseek-v4-flash",
      instructions: "Classify the request.",
      input: "USER: What is the latest news?",
      effort: "none",
      maxOutputTokens: 16,
      stream: false,
    });

    expect(request).toEqual({
      model: "deepseek-v4-flash",
      instructions: "Classify the request.",
      input: "USER: What is the latest news?",
      reasoning: { effort: "none" },
      max_output_tokens: 16,
      stream: false,
    });
    expect(request).not.toHaveProperty("messages");
    expect(request).not.toHaveProperty("choices");
    expect(request).not.toHaveProperty("previous_response_id");
    expect(request).not.toHaveProperty("safety_identifier");
    expect(request).not.toHaveProperty("store");
  });

  it("adds native web search with automatic tool selection", () => {
    const request = buildDeepSeekResponsesRequest({
      model: "deepseek-v4-flash",
      instructions: "Answer the user.",
      input: "What is the latest news?",
      tools: [{ type: "web_search" }],
      toolChoice: "auto",
      stream: true,
    });

    expect(request.tools).toEqual([{ type: "web_search" }]);
    expect(request.tool_choice).toBe("auto");
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
      model: "deepseek-v4-flash-vision-exp",
      instructions: "Describe the image.",
      input: imageInput,
      stream: true,
    });

    expect(request.input).toEqual(imageInput);
  });

  it("can require native web search", () => {
    const request = buildDeepSeekResponsesRequest({
      model: "deepseek-v4-pro",
      instructions: "Search before answering.",
      input: "Find the current price.",
      tools: [{ type: "web_search" }],
      toolChoice: "required",
      stream: true,
    });

    expect(request.tool_choice).toBe("required");
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
