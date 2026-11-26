import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookHarness = vi.hoisted(() => {
  type Effect = { cleanup?: (() => void) | void };
  let effects: Effect[] = [];
  let refs: { current: unknown }[] = [];

  return {
    reset() {
      for (const effect of effects) {
        if (typeof effect.cleanup === "function") effect.cleanup();
      }
      effects = [];
      refs = [];
    },
    useRef<T>(initial: T) {
      const ref = { current: initial };
      refs.push(ref);
      return ref;
    },
    useEffect(fn: () => (() => void) | void) {
      const rec: Effect = {};
      rec.cleanup = fn();
      effects.push(rec);
    },
    unmountLast() {
      const last = effects.pop();
      if (typeof last?.cleanup === "function") last.cleanup();
    },
  };
});

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useRef: hookHarness.useRef,
  useEffect: hookHarness.useEffect,
}));

function setupFakeWindow() {
  const listeners = new Map<string, Set<EventListener>>();
  const stack: { state: unknown; url: string }[] = [{ state: null, url: "https://app.notefable.com/app?view=pages" }];
  let index = 0;

  const win = {
    history: {
      get state() { return stack[index]?.state ?? null; },
      pushState(state: unknown, _title: string, url?: string | URL | null) {
        stack.splice(index + 1);
        stack.push({ state, url: url ? new URL(String(url), stack[index].url).href : stack[index].url });
        index = stack.length - 1;
      },
      replaceState(state: unknown, _title: string, url?: string | URL | null) {
        stack[index] = { state, url: url ? new URL(String(url), stack[index].url).href : stack[index].url };
      },
      back() {
        if (index > 0) index -= 1;
      },
    },
    addEventListener(type: string, fn: EventListener) {
      let set = listeners.get(type);
      if (!set) { set = new Set(); listeners.set(type, set); }
      set.add(fn);
    },
    removeEventListener(type: string, fn: EventListener) {
      listeners.get(type)?.delete(fn);
    },
    dispatchPopState(isTrusted = true) {
      const event = { type: "popstate", isTrusted } as unknown as PopStateEvent;
      for (const fn of [...(listeners.get("popstate") ?? [])]) fn(event);
      return event;
    },
  };

  vi.stubGlobal("window", win);
  return win;
}

describe("useBackToClose and afterSheetHistory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    hookHarness.reset();
  });

  afterEach(() => {
    hookHarness.reset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps afterSheetHistory FIFO across the popstate -> pendingFlush window and marks cleanup popstate", async () => {
    const win = setupFakeWindow();
    const mod = await import("./use-back-to-close");
    const order: string[] = [];
    const seenCleanup: boolean[] = [];

    // Register a listener AFTER useBackToClose will register its own, and another BEFORE.
    win.addEventListener("popstate", (event) => { seenCleanup.push(mod.isSheetCleanupPopState(event)); });

    mod.useBackToClose(true, vi.fn());
    win.addEventListener("popstate", (event) => { seenCleanup.push(mod.isSheetCleanupPopState(event)); });
    expect((win.history.state as { notefableSheet?: boolean } | null)?.notefableSheet).toBe(true);

    // Close the sheet: schedules pendingBack, then fires history.back() (ownBack = true).
    hookHarness.unmountLast();
    vi.advanceTimersByTime(1);

    // First callback queued while ownBack is true (e.g. syncPageUrl writing ?page=id).
    mod.afterSheetHistory(() => order.push("write-url"));

    // Synthetic (untrusted) popstate events dispatched by app code must not be mistaken for sheet cleanup.
    win.dispatchPopState(false);
    expect(seenCleanup).toEqual([false, false]);
    seenCleanup.length = 0;

    // Browser delivers popstate for history.back(): ownBack flips to false, flush is scheduled via setTimeout.
    win.dispatchPopState(true);
    expect(seenCleanup).toEqual([true, true]);

    // Second callback arrives between popstate and setTimeout(flushAfterBack) (e.g. syncNotesList).
    // It MUST NOT jump ahead of "write-url".
    mod.afterSheetHistory(() => order.push("sync-list"));
    expect(order).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(order).toEqual(["write-url", "sync-list"]);
  });

  it("flushes queued afterSheetHistory callbacks if another sheet opens while pendingBack is cancelled", async () => {
    setupFakeWindow();
    const mod = await import("./use-back-to-close");
    const order: string[] = [];

    mod.useBackToClose(true, vi.fn());
    hookHarness.unmountLast();

    mod.afterSheetHistory(() => order.push("queued-during-pending-back"));
    expect(order).toEqual([]);

    // Another sheet opens before pendingBack fires, cancelling pendingBack.
    mod.useBackToClose(true, vi.fn());
    vi.advanceTimersByTime(1);
    expect(order).toEqual(["queued-during-pending-back"]);
  });
});
