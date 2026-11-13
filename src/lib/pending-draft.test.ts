import { afterEach, describe, expect, it, vi } from "vitest";
import { keepRejectedDraft, savePendingDraft, takePendingDraft } from "./pending-draft";

function stubStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("window", { sessionStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  } });
  return store;
}

describe("pending draft", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("hands the saved text back once per scope", () => {
    stubStorage();
    savePendingDraft("chat", "hello");
    savePendingDraft("note:1", "fix it");
    expect(takePendingDraft("chat")).toBe("hello");
    expect(takePendingDraft("chat")).toBe("");
    expect(takePendingDraft("note:1")).toBe("fix it");
  });

  it("clears the slot for blank text and survives unavailable storage", () => {
    const store = stubStorage();
    savePendingDraft("chat", "x");
    savePendingDraft("chat", "  ");
    expect(store.size).toBe(0);
    vi.stubGlobal("window", { get sessionStorage(): Storage { throw new Error("blocked"); } });
    expect(() => savePendingDraft("chat", "x")).not.toThrow();
    expect(takePendingDraft("chat")).toBe("");
  });
});

describe("keepRejectedDraft", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("puts the rejected text ahead of a draft saved earlier", () => {
    stubStorage();
    savePendingDraft("note:1", "typed later");
    keepRejectedDraft("note:1", "rejected ");
    expect(takePendingDraft("note:1")).toBe("rejected\n\ntyped later");
    keepRejectedDraft("chat", "only");
    expect(takePendingDraft("chat")).toBe("only");
  });
});
