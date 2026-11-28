import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useCallback: <T,>(fn: T) => fn,
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  };
});

function setupStorage() {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
  });
}

describe("useExpandedPages and revealAncestorsOnce", () => {
  beforeEach(() => {
    vi.resetModules();
    setupStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("expands ancestors once when opening a nested page, then lets the user collapse them without re-opening", async () => {
    const mod = await import("./use-expanded-pages");

    // Before the pages list finishes loading, do not lock in the reveal.
    mod.revealAncestorsOnce("p3", [], false);
    expect(mod.useExpandedPages()[0]).toEqual({});

    // Once loaded, ancestors of p3 (p1, p2) expand automatically.
    mod.revealAncestorsOnce("p3", ["p1", "p2"], true);
    expect(mod.useExpandedPages()[0]).toEqual({ p1: true, p2: true });

    // User manually collapses p1 while p3 is still active.
    const [, toggle] = mod.useExpandedPages();
    toggle("p1", false);
    expect(mod.useExpandedPages()[0]).toEqual({ p2: true });

    // Subsequent re-renders / autosave updates for the same active page must NOT re-open p1.
    mod.revealAncestorsOnce("p3", ["p1", "p2"], true);
    expect(mod.useExpandedPages()[0]).toEqual({ p2: true });

    // Navigating away and later returning to p3 reveals its ancestors again.
    mod.revealAncestorsOnce("other", [], true);
    mod.revealAncestorsOnce("p3", ["p1", "p2"], true);
    expect(mod.useExpandedPages()[0]).toEqual({ p1: true, p2: true });
  });

  it("still expands ancestors that arrive after the active page, and after the active page moves under another parent", async () => {
    const mod = await import("./use-expanded-pages");

    // The opened page's own fetch lands before the list: no ancestors known yet.
    mod.revealAncestorsOnce("child", [], true);
    expect(mod.useExpandedPages()[0]).toEqual({});
    // The list arrives with the parent.
    mod.revealAncestorsOnce("child", ["parent"], true);
    expect(mod.useExpandedPages()[0]).toEqual({ parent: true });

    // The active page is moved under a collapsed page.
    const [, toggle] = mod.useExpandedPages();
    toggle("parent", false);
    mod.revealAncestorsOnce("child", ["other"], true);
    expect(mod.useExpandedPages()[0]).toEqual({ other: true });
  });
});
