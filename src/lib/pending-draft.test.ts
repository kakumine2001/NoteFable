import { afterEach, describe, expect, it, vi } from "vitest";
import { keepRejectedDraft, savePendingDraft, takePendingDraft } from "./pending-draft";

function stubStorage() {
  const session = new Map<string, string>();
  const local = new Map<string, string>();
  const make = (store: Map<string, string>) => ({
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  vi.stubGlobal("window", { sessionStorage: make(session), localStorage: make(local) });
  return { session, local };
}

describe("pending draft", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("hands the saved text back once per scope", () => {
    stubStorage();
    savePendingDraft("chat", "hello");
    savePendingDraft("note:1", "fix it");
    expect(takePendingDraft("chat")).toBe("hello");
    expect(takePendingDraft("chat")).toBe("");
    expect(takePendingDraft("note:1")).toBe("fix it");
  });

  it("clears the slot for blank text and survives unavailable storage", () => {
    const { session, local } = stubStorage();
    savePendingDraft("chat", "x");
    savePendingDraft("chat", "  ");
    expect(session.size).toBe(0);
    savePendingDraft("note:1", "y", { persistent: true });
    expect(local.size).toBe(1);
    savePendingDraft("note:1", "  ", { persistent: true });
    expect(local.size).toBe(0);
    vi.stubGlobal("window", { get sessionStorage(): Storage { throw new Error("blocked"); }, get localStorage(): Storage { throw new Error("blocked"); } });
    expect(() => savePendingDraft("chat", "x")).not.toThrow();
    expect(() => savePendingDraft("chat", "x", { persistent: true })).not.toThrow();
    expect(takePendingDraft("chat")).toBe("");
  });

  it("persists rejected native WebView drafts in localStorage across sessionStorage resets and expires stale entries", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-24T12:00:00Z"));
    const { session, local } = stubStorage();
    savePendingDraft("note:p1", "keep me across sign-in", { persistent: true });
    expect(session.size).toBe(0);
    expect(local.size).toBe(1);
    // Simulate WebView destruction/recreation: sessionStorage is wiped, localStorage survives.
    session.clear();
    expect(takePendingDraft("note:p1")).toBe("keep me across sign-in");
    expect(takePendingDraft("note:p1")).toBe("");

    savePendingDraft("slides-image:p1", "expired prompt", { persistent: true });
    vi.advanceTimersByTime(3 * 60 * 60 * 1000);
    expect(takePendingDraft("slides-image:p1")).toBe("");
  });
});

describe("keepRejectedDraft", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("puts the rejected text ahead of a draft saved earlier (including persistent storage)", () => {
    stubStorage();
    savePendingDraft("note:1", "typed later");
    keepRejectedDraft("note:1", "rejected ");
    expect(takePendingDraft("note:1")).toBe("rejected\n\ntyped later");
    keepRejectedDraft("chat", "only");
    expect(takePendingDraft("chat")).toBe("only");

    savePendingDraft("note:2", "later", { persistent: true });
    keepRejectedDraft("note:2", "first", { persistent: true });
    expect(takePendingDraft("note:2")).toBe("first\n\nlater");
  });
});
