import { afterEach, describe, expect, it, vi } from "vitest";
import { readModelPreference, resolveModelPreference, saveModelPreference } from "./model-preference";

const options = [
  { id: "a", reasoningEfforts: ["none", "medium"], defaultReasoning: "medium" },
  { id: "b", reasoningEfforts: ["low", "high"], defaultReasoning: "low" },
];

function stubStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    },
  });
  return data;
}

afterEach(() => vi.unstubAllGlobals());

describe("model preference", () => {
  it("round-trips the saved choice", () => {
    stubStorage();
    expect(readModelPreference()).toBeNull();
    saveModelPreference({ model: "b", reasoning: "high" });
    expect(readModelPreference()).toEqual({ model: "b", reasoning: "high" });
  });

  it("ignores malformed stored values and missing storage", () => {
    stubStorage({ "studymate:model-preference": "{not json" });
    expect(readModelPreference()).toBeNull();
    stubStorage({ "studymate:model-preference": JSON.stringify({ model: 1 }) });
    expect(readModelPreference()).toBeNull();
    vi.stubGlobal("window", {});
    expect(readModelPreference()).toBeNull();
    expect(() => saveModelPreference({ model: "a", reasoning: "none" })).not.toThrow();
  });

  it("keeps a choice the server still offers", () => {
    expect(resolveModelPreference({ model: "b", reasoning: "high" }, options)).toEqual({ model: "b", reasoning: "high" });
  });

  it("drops a model that is no longer offered", () => {
    expect(resolveModelPreference({ model: "gone", reasoning: "high" }, options)).toBeNull();
    expect(resolveModelPreference(null, options)).toBeNull();
  });

  it("replaces a reasoning level the model does not support", () => {
    expect(resolveModelPreference({ model: "b", reasoning: "none" }, options)).toEqual({ model: "b", reasoning: "low" });
  });
});
