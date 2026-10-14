import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-dom", () => ({ flushSync: (callback: () => void) => callback() }));
import { runTransition } from "./view-transition";

type Fake = { dataset: Record<string, string | undefined> };

function install({ transitions, reduced }: { transitions: boolean; reduced?: boolean }) {
  const root: Fake = { dataset: {} };
  const finished: { resolve: () => void } = { resolve: () => {} };
  const start = vi.fn((callback: () => void) => {
    // 実際のブラウザと同じく、コールバックは撮影のあとに呼ばれる。
    queueMicrotask(callback);
    return { ready: Promise.resolve(), finished: new Promise<void>((resolve) => { finished.resolve = resolve; }) };
  });
  vi.stubGlobal("document", { documentElement: root, ...(transitions ? { startViewTransition: start } : {}) });
  vi.stubGlobal("window", { matchMedia: () => ({ matches: Boolean(reduced) }) });
  return { root, start, finished };
}

describe("runTransition", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("runs the update right away when the browser has no view transitions", () => {
    install({ transitions: false });
    const update = vi.fn();
    runTransition(update, "forward");
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("skips the motion for people who asked for less of it", () => {
    const { start } = install({ transitions: true, reduced: true });
    const update = vi.fn();
    runTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  it("tags the page with the kind while the transition runs, then clears it", async () => {
    const { root, start, finished } = install({ transitions: true });
    const update = vi.fn();
    runTransition(update, "back");
    expect(start).toHaveBeenCalledTimes(1);
    expect(root.dataset.vtKind).toBe("back");
    await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(1);
    finished.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(root.dataset.vtKind).toBeUndefined();
  });

  it("still updates when starting the transition throws", () => {
    const { root } = install({ transitions: true });
    (document as unknown as { startViewTransition: () => never }).startViewTransition = () => { throw new Error("nope"); };
    const update = vi.fn();
    runTransition(update, "list");
    expect(update).toHaveBeenCalledTimes(1);
    expect(root.dataset.vtKind).toBeUndefined();
  });

  it("does not let an older transition clear a newer transition of the same kind", async () => {
    const { root, finished } = install({ transitions: true });
    runTransition(() => {}, "list");
    const finishOld = finished.resolve;
    runTransition(() => {}, "list");
    finishOld();
    await Promise.resolve();
    expect(root.dataset.vtKind).toBe("list");
    finished.resolve();
    await Promise.resolve();
    expect(root.dataset.vtKind).toBeUndefined();
  });

  it("invalidates a pending note-open callback when Back restores the list immediately", async () => {
    install({ transitions: true });
    let screen = "list";
    runTransition(() => { screen = "note"; }, "forward");
    runTransition(() => { screen = "list"; }, "back", false);
    await Promise.resolve();
    expect(screen).toBe("list");
  });

  it("serializes list updates and navigation without losing the deletion update", async () => {
    const { start, finished } = install({ transitions: true });
    const updates: string[] = [];
    runTransition(() => updates.push("delete"), "list");
    const finishFirst = finished.resolve;
    runTransition(() => updates.push("back"), "back");
    expect(start).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(updates).toEqual(["delete"]);
    finishFirst();
    await Promise.resolve();
    await Promise.resolve();
    expect(start).toHaveBeenCalledTimes(2);
    expect(updates).toEqual(["delete", "back"]);
  });

  it("keeps every queued list update even when a newer navigation supersedes an older one", async () => {
    const { finished } = install({ transitions: true });
    const updates: string[] = [];
    runTransition(() => updates.push("obsolete"), "forward");
    const finishFirst = finished.resolve;
    runTransition(() => updates.push("move"), "list");
    runTransition(() => updates.push("list"), "back");
    await Promise.resolve();
    expect(updates).toEqual([]);
    finishFirst();
    await Promise.resolve();
    await Promise.resolve();
    expect(updates).toEqual(["move"]);
    finished.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(updates).toEqual(["move", "list"]);
  });
});
