import { describe, expect, it, vi } from "vitest";
import {
  buildWebSearchDecisionContext,
  normalizeWebSearchMode,
  parseWebSearchDecision,
  requestDeepSeekWebSearchDecision,
  shouldUseWebSearch,
} from "./web-search";

describe("normalizeWebSearchMode", () => {
  it("keeps supported automatic and forced modes", () => {
    expect(normalizeWebSearchMode("auto", true)).toBe("auto");
    expect(normalizeWebSearchMode("force", true)).toBe("force");
    expect(normalizeWebSearchMode("true", true)).toBe("force");
  });

  it("turns search off for unsupported models and invalid values", () => {
    expect(normalizeWebSearchMode("auto", false)).toBe("off");
    expect(normalizeWebSearchMode("unexpected", true)).toBe("off");
  });
});

describe("shouldUseWebSearch", () => {
  it("always searches in force mode and never searches when off", () => {
    expect(shouldUseWebSearch("force", "Explain photosynthesis")).toBe(true);
    expect(shouldUseWebSearch("off", "What is the latest news?")).toBe(false);
  });

  it("detects time-sensitive search intent in multiple languages", () => {
    expect(shouldUseWebSearch("auto", "What is the latest OpenAI model?")).toBe(true);
    expect(shouldUseWebSearch("auto", "现在东京天气怎么样？")).toBe(true);
    expect(shouldUseWebSearch("auto", "今日のニュースを教えて")).toBe(true);
  });

  it("does not search stable study questions automatically", () => {
    expect(shouldUseWebSearch("auto", "Explain the Pythagorean theorem")).toBe(false);
    expect(shouldUseWebSearch("auto", "帮我解释一下牛顿第二定律")).toBe(false);
  });
});

describe("DeepSeek web search decision", () => {
  it("builds bounded recent conversation context for follow-up questions", () => {
    const input = Array.from({ length: 7 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: [{ type: "input_text", text: `message ${index}` }],
    }));

    const context = buildWebSearchDecisionContext(input);

    expect(context).not.toContain("message 0");
    expect(context).toContain("ASSISTANT: message 1");
    expect(context).toContain("USER: message 6");
  });

  it("truncates long messages and ignores non-text input parts", () => {
    const context = buildWebSearchDecisionContext([
      {
        role: "user",
        content: [
          { type: "input_text", text: "x".repeat(1_500) },
          { type: "input_image", image_url: "data:image/png;base64,secret" },
        ],
      },
    ]);

    expect(context).toBe(`USER: ${"x".repeat(1_200)}`);
    expect(context).not.toContain("base64");
  });

  it("parses only explicit search routing decisions", () => {
    expect(parseWebSearchDecision("SEARCH")).toBe(true);
    expect(parseWebSearchDecision("skip\n")).toBe(false);
    expect(parseWebSearchDecision("The answer is SEARCH")).toBeNull();
  });

  it("asks DeepSeek Flash for a semantic decision", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "SEARCH" } }] }),
        { status: 200 },
      ),
    );

    const decision = await requestDeepSeekWebSearchDecision({
      input: [{ role: "user", content: "Who is Japan's prime minister?" }],
      apiKey: "test-key",
      baseURL: "https://deepseek.example/v1/",
      model: "deepseek-v4-flash",
      fetcher,
    });

    expect(decision).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      "https://deepseek.example/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
    const request = fetcher.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body)) as {
      model: string;
      messages: { content: string }[];
      stream: boolean;
    };
    expect(body.model).toBe("deepseek-v4-flash");
    expect(body.stream).toBe(false);
    expect(body.messages[0].content).toContain("people holding changeable roles");
    expect(body.messages[1].content).toContain("Who is Japan's prime minister?");
  });

  it("returns false when the classifier chooses SKIP", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "SKIP" } }] }), {
        status: 200,
      }),
    );

    await expect(
      requestDeepSeekWebSearchDecision({
        input: [{ role: "user", content: "Explain the Pythagorean theorem" }],
        apiKey: "test-key",
        baseURL: "https://deepseek.example/v1",
        model: "deepseek-v4-flash",
        fetcher,
      }),
    ).resolves.toBe(false);
  });

  it("surfaces classifier HTTP errors so the caller can fall back", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "temporary outage" } }), {
        status: 503,
      }),
    );

    await expect(
      requestDeepSeekWebSearchDecision({
        input: [{ role: "user", content: "Question" }],
        apiKey: "test-key",
        baseURL: "https://deepseek.example/v1",
        model: "deepseek-v4-flash",
        fetcher,
      }),
    ).rejects.toThrow("temporary outage");
  });

  it("rejects invalid classifier output so the caller can fall back", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "MAYBE" } }] }), {
        status: 200,
      }),
    );

    await expect(
      requestDeepSeekWebSearchDecision({
        input: [{ role: "user", content: "Question" }],
        apiKey: "test-key",
        baseURL: "https://deepseek.example/v1",
        model: "deepseek-v4-flash",
        fetcher,
      }),
    ).rejects.toThrow("invalid web search decision");
  });
});
