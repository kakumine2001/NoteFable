import { afterEach, describe, expect, it, vi } from "vitest";
import { MODEL_OPTIONS } from "@/lib/models";
import { getModelRegistry, parseModelRegistry, publicModels } from "./model-registry";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("model registry", () => {
  it("uses the built-in list when nothing is configured", () => {
    expect(parseModelRegistry(undefined).options).toBe(MODEL_OPTIONS);
    expect(parseModelRegistry("  ").defaultModel).toBe("gpt-6-luna");
  });

  it("lists only the models named in the variable, in that order, and the first is the default", () => {
    const registry = parseModelRegistry('[{"id":"claude-haiku-5-5"},{"id":"gpt-6-luna"}]');
    expect(registry.options.map((m) => m.id)).toEqual(["claude-haiku-5-5", "gpt-6-luna"]);
    expect(registry.defaultModel).toBe("claude-haiku-5-5");
    // 組み込みの能力はそのまま引き継ぐ
    expect(registry.options[0].provider).toBe("anthropic");
  });

  it("overrides only the fields that are written, and can switch a model off", () => {
    const registry = parseModelRegistry(
      '[{"id":"gpt-6-luna","label":"GPT-6","upstreamModel":"gpt-6-2026-11"},{"id":"deepseek-flash","enabled":false}]',
    );
    expect(registry.options).toHaveLength(1);
    expect(registry.options[0]).toMatchObject({ id: "gpt-6-luna", label: "GPT-6", upstreamModel: "gpt-6-2026-11", supportsWebSearch: true });
  });

  it("accepts a brand-new model when every field is given", () => {
    const registry = parseModelRegistry(JSON.stringify([
      { id: "gpt-7", label: "GPT-7", provider: "openai", supportsImageInput: true, supportsWebSearch: true, supportsCompaction: true, supportsPageTools: true, reasoningEfforts: ["low", "high"], defaultReasoning: "high" },
    ]));
    expect(registry.options[0]).toMatchObject({ id: "gpt-7", provider: "openai", defaultReasoning: "high" });
  });

  it("keeps valid token limits so the Anthropic request can use the model's output cap", () => {
    const registry = parseModelRegistry(JSON.stringify([{ id: "claude-haiku-5-5", tokenLimits: { contextWindow: 200000, maxOutputTokens: 8192 } }]));
    expect(registry.options[0].tokenLimits).toEqual({ contextWindow: 200000, maxOutputTokens: 8192 });
  });

  it.each([
    ["not JSON", "{oops"],
    ["not an array", '{"id":"gpt-6-luna"}'],
    ["a new model with missing fields", '[{"id":"gpt-7","label":"GPT-7"}]'],
    ["an unknown provider", '[{"id":"x","label":"X","provider":"acme"}]'],
    ["a default reasoning outside the supported list", '[{"id":"gpt-6-luna","reasoningEfforts":["low"],"defaultReasoning":"high"}]'],
    ["a reasoning level that cannot be stored", '[{"id":"gpt-6-luna","reasoningEfforts":["minimal"],"defaultReasoning":"minimal"}]'],
    ["a reasoning level the provider rejects", '[{"id":"claude-haiku-5-5","reasoningEfforts":["none","low"],"defaultReasoning":"low"}]'],
    ["token limits that are not an object", '[{"id":"claude-haiku-5-5","tokenLimits":null}]'],
    ["token limits that are not positive integers", '[{"id":"claude-haiku-5-5","tokenLimits":{"contextWindow":-1,"maxOutputTokens":"many"}}]'],
    ["every model switched off", '[{"id":"gpt-6-luna","enabled":false}]'],
  ])("falls back to the built-in list for %s, without throwing", (_name, raw) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parseModelRegistry(raw).options).toBe(MODEL_OPTIONS);
    expect(error).toHaveBeenCalled();
  });

  it("re-reads the variable when it changes and never exposes server-only fields", () => {
    vi.stubEnv("STUDYMATE_MODELS", '[{"id":"gpt-6-luna","upstreamModel":"secret-upstream"}]');
    expect(getModelRegistry().options).toHaveLength(1);
    expect(JSON.stringify(publicModels())).not.toContain("secret-upstream");
    expect(JSON.stringify(publicModels())).not.toContain("tokenLimits");
    vi.stubEnv("STUDYMATE_MODELS", "");
    expect(getModelRegistry().options).toHaveLength(3);
  });
});
