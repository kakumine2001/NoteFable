import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotePage, NotePageSummary } from "@/types/notes";

// Lightweight synchronous React hook harness so we can exercise the real useNotePages hook in Node.
const hookRuntime = vi.hoisted(() => {
  type EffectRecord = { deps?: unknown[]; cleanup?: (() => void) | void; fn: () => (() => void) | void };
  type CallbackRecord = { deps?: unknown[]; fn: unknown };
  let states: unknown[] = [];
  let refs: { current: unknown }[] = [];
  let callbacks: CallbackRecord[] = [];
  let effects: EffectRecord[] = [];
  let pendingEffects: number[] = [];
  let stateIdx = 0;
  let refIdx = 0;
  let cbIdx = 0;
  let effectIdx = 0;
  let renderFn: (() => unknown) | null = null;
  let currentResult: unknown;
  let rerenderScheduled = false;
  let generation = 0;

  const depsChanged = (prev?: unknown[], next?: unknown[]) =>
    !prev || !next || prev.length !== next.length || prev.some((v, i) => !Object.is(v, next[i]));

  function flushEffects() {
    while (pendingEffects.length) {
      const idx = pendingEffects.shift()!;
      const rec = effects[idx];
      if (!rec) continue;
      if (typeof rec.cleanup === "function") rec.cleanup();
      rec.cleanup = rec.fn();
    }
  }

  function render() {
    if (!renderFn) return;
    stateIdx = 0;
    refIdx = 0;
    cbIdx = 0;
    effectIdx = 0;
    currentResult = renderFn();
    flushEffects();
  }

  function scheduleRender() {
    if (rerenderScheduled) return;
    rerenderScheduled = true;
    queueMicrotask(() => {
      rerenderScheduled = false;
      render();
    });
  }

  return {
    reset() {
      generation += 1;
      for (const rec of effects) {
        if (typeof rec.cleanup === "function") rec.cleanup();
      }
      states = [];
      refs = [];
      callbacks = [];
      effects = [];
      pendingEffects = [];
      renderFn = null;
      currentResult = undefined;
      rerenderScheduled = false;
    },
    mount<T>(fn: () => T) {
      renderFn = fn;
      render();
      return {
        get current(): T { return currentResult as T; },
        rerender() { render(); },
      };
    },
    useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
      const idx = stateIdx++;
      const owner = generation;
      if (!(idx in states)) states[idx] = typeof initial === "function" ? (initial as () => T)() : initial;
      const setState = (next: T | ((prev: T) => T)) => {
        if (owner !== generation) return;
        const value = typeof next === "function" ? (next as (prev: T) => T)(states[idx] as T) : next;
        if (!Object.is(states[idx], value)) {
          states[idx] = value;
          scheduleRender();
        }
      };
      return [states[idx] as T, setState];
    },
    useRef<T>(initial: T) {
      const idx = refIdx++;
      if (!(idx in refs)) refs[idx] = { current: initial };
      return refs[idx] as { current: T };
    },
    useCallback<T extends (...args: never[]) => unknown>(fn: T, deps?: unknown[]) {
      const idx = cbIdx++;
      const prev = callbacks[idx];
      if (!prev || depsChanged(prev.deps, deps)) {
        callbacks[idx] = { deps, fn };
      }
      return callbacks[idx].fn as T;
    },
    useEffect(fn: () => (() => void) | void, deps?: unknown[]) {
      const idx = effectIdx++;
      const prev = effects[idx];
      if (!prev || depsChanged(prev.deps, deps)) {
        effects[idx] = { deps, cleanup: prev?.cleanup, fn };
        pendingEffects.push(idx);
      }
    },
  };
});

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: hookRuntime.useState,
  useRef: hookRuntime.useRef,
  useCallback: hookRuntime.useCallback,
  useEffect: hookRuntime.useEffect,
}));

vi.mock("@/lib/view-transition", () => ({
  runTransition: (update: () => void) => update(),
}));

vi.mock("@/lib/use-back-to-close", () => ({
  restoreSheetMarker: vi.fn(),
}));

const preloadPageEditor = vi.hoisted(() => vi.fn());
vi.mock("@/lib/preload-editor", () => ({
  preloadPageEditor,
}));

import { PAGES_TRASHED_EVENT } from "@/lib/proposal-sync";
import { useNotePages } from "./use-note-pages";

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makePage(id: string, title: string, version = 1): NotePage {
  return {
    id,
    kind: "note",
    title,
    icon: null,
    cover: null,
    coverPosition: null,
    blocks: [],
    version,
    groupId: null,
    parentId: null,
    position: 0,
    favoritedAt: null,
    fullWidth: false,
    smallText: false,
    font: "default",
    locked: false,
    updatedAt: "2026-11-23T00:00:00.000Z",
    createdAt: "2026-11-23T00:00:00.000Z",
  };
}

function makeSummary(page: NotePage): NotePageSummary {
  return {
    id: page.id,
    kind: page.kind,
    title: page.title,
    icon: page.icon,
    version: page.version,
    groupId: page.groupId,
    parentId: page.parentId,
    position: page.position,
    favoritedAt: page.favoritedAt,
    fullWidth: page.fullWidth,
    smallText: page.smallText,
    font: page.font,
    locked: page.locked,
    updatedAt: page.updatedAt,
    createdAt: page.createdAt,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

async function flushMicrotasks(turns = 12) {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

function createFakeBrowser(initialHref = "https://app.notefable.com/app?view=pages") {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const docListeners = new Map<string, Set<(event: Event) => void>>();
  const storage = new Map<string, string>();
  const historyStack: { state: unknown; href: string }[] = [{ state: null, href: initialHref }];
  let historyIndex = 0;

  const location = {
    get href() { return historyStack[historyIndex].href; },
    set href(v: string) { historyStack[historyIndex].href = v; },
  };

  const history = {
    get state() { return historyStack[historyIndex].state; },
    pushState: vi.fn((state: unknown, _title: string, url?: string | URL | null) => {
      const href = url ? new URL(String(url), location.href).href : location.href;
      historyStack.splice(historyIndex + 1);
      historyStack.push({ state, href });
      historyIndex = historyStack.length - 1;
    }),
    replaceState: vi.fn((state: unknown, _title: string, url?: string | URL | null) => {
      const href = url ? new URL(String(url), location.href).href : location.href;
      historyStack[historyIndex] = { state, href };
    }),
  };

  const fakeWindow = {
    location,
    history,
    addEventListener: (type: string, cb: (event: Event) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(cb);
    },
    removeEventListener: (type: string, cb: (event: Event) => void) => {
      listeners.get(type)?.delete(cb);
    },
    dispatchEvent: vi.fn((event: Event) => {
      for (const cb of listeners.get(event.type) ?? []) cb(event);
      return true;
    }),
  };

  const fakeDocument = {
    visibilityState: "visible",
    addEventListener: (type: string, cb: (event: Event) => void) => {
      if (!docListeners.has(type)) docListeners.set(type, new Set());
      docListeners.get(type)!.add(cb);
    },
    removeEventListener: (type: string, cb: (event: Event) => void) => {
      docListeners.get(type)?.delete(cb);
    },
  };

  const fakeStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  };

  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("localStorage", fakeStorage);
  return { fakeWindow, history, storage };
}

describe("useNotePages instant switching & prefetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    preloadPageEditor.mockClear();
    hookRuntime.reset();
  });

  afterEach(() => {
    hookRuntime.reset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("switches to a previously visited page immediately from cache without loading flash, then revalidates in background", async () => {
    const { history } = createFakeBrowser();
    const pageA = makePage("a", "Alpha", 1);
    const pageB = makePage("b", "Beta", 1);
    const revalA = deferred<Response>();
    let aFetchCount = 0;

    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/pages") return Promise.resolve(jsonResponse({ pages: [makeSummary(pageA), makeSummary(pageB)], groups: [] }));
      if (url === "/api/pages/a") {
        aFetchCount += 1;
        if (aFetchCount === 1) return Promise.resolve(jsonResponse({ page: pageA }));
        return revalA.promise;
      }
      if (url === "/api/pages/b") return Promise.resolve(jsonResponse({ page: pageB }));
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const hook = hookRuntime.mount(() => useNotePages(true));
    await flushMicrotasks();
    expect(hook.current.pages).toHaveLength(2);

    // Open A then B so both are cached.
    await hook.current.select("a", "push");
    await flushMicrotasks();
    expect(hook.current.activeId).toBe("a");
    await hook.current.select("b", "push");
    await flushMicrotasks();
    expect(hook.current.activeId).toBe("b");

    // Switch back to A: should resolve immediately from cache BEFORE revalA settles.
    const opened = await hook.current.select("a", "push");
    await flushMicrotasks();
    expect(opened).toBe(true);
    expect(hook.current.activeId).toBe("a");
    expect(hook.current.active?.content.title).toBe("Alpha");
    expect(hook.current.loading).toBe(false);
    expect(hook.current.openingId).toBeNull();
    expect(history.pushState).toHaveBeenLastCalledWith(null, "", expect.objectContaining({ search: "?view=pages&page=a" }));
    const epochBefore = hook.current.editorEpoch;

    // Background revalidation returns newer version 2 -> updates silently and bumps editorEpoch.
    revalA.resolve(jsonResponse({ page: makePage("a", "Alpha v2", 2) }));
    await flushMicrotasks();
    expect(hook.current.active?.content.title).toBe("Alpha v2");
    expect(hook.current.active?.version).toBe(2);
    expect(hook.current.editorEpoch).toBe(epochBefore + 1);
  });

  it("ignores stale background revalidation responses older than the local version", async () => {
    createFakeBrowser();
    const pageA = makePage("a", "Alpha v3", 3);
    const pageB = makePage("b", "Beta", 1);
    const staleRevalA = deferred<Response>();
    let aFetchCount = 0;

    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url === "/api/pages") return Promise.resolve(jsonResponse({ pages: [makeSummary(pageA), makeSummary(pageB)], groups: [] }));
      if (url === "/api/pages/a") {
        aFetchCount += 1;
        return aFetchCount === 1 ? Promise.resolve(jsonResponse({ page: pageA })) : staleRevalA.promise;
      }
      if (url === "/api/pages/b") return Promise.resolve(jsonResponse({ page: pageB }));
      return Promise.reject(new Error(`unexpected ${url}`));
    }));

    const hook = hookRuntime.mount(() => useNotePages(true));
    await flushMicrotasks();
    await hook.current.select("a", "push");
    await flushMicrotasks();
    await hook.current.select("b", "push");
    await flushMicrotasks();
    await hook.current.select("a", "push");
    await flushMicrotasks();
    const epochBefore = hook.current.editorEpoch;

    // Stale version 2 arrives late -> must NOT overwrite local version 3.
    staleRevalA.resolve(jsonResponse({ page: makePage("a", "Stale v2", 2) }));
    await flushMicrotasks();
    expect(hook.current.active?.content.title).toBe("Alpha v3");
    expect(hook.current.active?.version).toBe(3);
    expect(hook.current.editorEpoch).toBe(epochBefore);
  });

  it("marks conflict without discarding unsaved edits when background revalidation sees a newer version", async () => {
    createFakeBrowser();
    const pageA = makePage("a", "Alpha", 1);
    const pageB = makePage("b", "Beta", 1);
    const revalA = deferred<Response>();
    let aFetchCount = 0;

    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url === "/api/pages") return Promise.resolve(jsonResponse({ pages: [makeSummary(pageA), makeSummary(pageB)], groups: [] }));
      if (url === "/api/pages/a") {
        aFetchCount += 1;
        return aFetchCount === 1 ? Promise.resolve(jsonResponse({ page: pageA })) : revalA.promise;
      }
      if (url === "/api/pages/b") return Promise.resolve(jsonResponse({ page: pageB }));
      return Promise.reject(new Error(`unexpected ${url}`));
    }));

    const hook = hookRuntime.mount(() => useNotePages(true));
    await flushMicrotasks();
    await hook.current.select("a", "push");
    await flushMicrotasks();
    hook.current.active!.edit({ ...hook.current.active!.content, title: "Unsaved local edit" });
    await flushMicrotasks();
    await hook.current.select("b", "push");
    await flushMicrotasks();
    await hook.current.select("a", "push");
    await flushMicrotasks();

    revalA.resolve(jsonResponse({ page: makePage("a", "Other tab edit", 2) }));
    await flushMicrotasks();
    expect(hook.current.active?.status).toBe("conflict");
    expect(hook.current.active?.content.title).toBe("Unsaved local edit");
  });

  it("keeps cached page visible on transient offline error, and handles 404 safely for clean vs dirty pages", async () => {
    const { fakeWindow } = createFakeBrowser();
    const pageA = makePage("a", "Alpha", 1);
    const pageB = makePage("b", "Beta", 1);
    let aFetchCount = 0;
    let bFetchCount = 0;

    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url === "/api/pages") return Promise.resolve(jsonResponse({ pages: [makeSummary(pageA), makeSummary(pageB)], groups: [] }));
      if (url === "/api/pages/a") {
        aFetchCount += 1;
        if (aFetchCount === 1) return Promise.resolve(jsonResponse({ page: pageA }));
        if (aFetchCount === 2) return Promise.reject(new Error("Network down"));
        return Promise.resolve(jsonResponse({ error: "Not found" }, 404));
      }
      if (url === "/api/pages/b") {
        bFetchCount += 1;
        if (bFetchCount === 1) return Promise.resolve(jsonResponse({ page: pageB }));
        return Promise.resolve(jsonResponse({ error: "Not found" }, 404));
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    }));

    const hook = hookRuntime.mount(() => useNotePages(true));
    await flushMicrotasks();
    await hook.current.select("a", "push");
    await flushMicrotasks();
    await hook.current.select("b", "push");
    await flushMicrotasks();
    // Make B dirty while open so its next background revalidation 404 preserves the draft.
    hook.current.active!.edit({ ...hook.current.active!.content, title: "My unsaved B" });
    await flushMicrotasks();

    // 1. Offline error during background revalidation of A -> keeps A visible with no error banner.
    await hook.current.select("a", "push");
    await flushMicrotasks();
    expect(hook.current.activeId).toBe("a");
    expect(hook.current.error).toBe("");

    // 2. Dirty page B gets 404 during background revalidation -> preserves draft and marks gone/error.
    await hook.current.select("b", "push");
    await flushMicrotasks();
    expect(hook.current.activeId).toBe("b");
    expect(hook.current.active?.content.title).toBe("My unsaved B");
    expect(hook.current.active?.gone).toBe(true);
    expect(hook.current.active?.status).toBe("error");

    // 3. Clean page A gets 404 on third fetch -> removed from list & URL stripped.
    await hook.current.select("a", "push");
    await flushMicrotasks();
    expect(hook.current.pages.map((p) => p.id)).toEqual(["b"]);
    expect(hook.current.activeId).toBeNull();
    expect(fakeWindow.location.href).toBe("https://app.notefable.com/app?view=pages");
    expect(fakeWindow.dispatchEvent).toHaveBeenCalled();
  });

  it("keeps current page rendered while opening an uncached page (keepCurrent: true) and clears when keepCurrent: false", async () => {
    createFakeBrowser();
    const pageA = makePage("a", "Alpha", 1);
    const pageB = makePage("b", "Beta", 1);
    const pageC = makePage("c", "Gamma", 1);
    const fetchB = deferred<Response>();
    const fetchC = deferred<Response>();

    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url === "/api/pages") return Promise.resolve(jsonResponse({ pages: [makeSummary(pageA), makeSummary(pageB), makeSummary(pageC)], groups: [] }));
      if (url === "/api/pages/a") return Promise.resolve(jsonResponse({ page: pageA }));
      if (url === "/api/pages/b") return fetchB.promise;
      if (url === "/api/pages/c") return fetchC.promise;
      return Promise.reject(new Error(`unexpected ${url}`));
    }));

    const hook = hookRuntime.mount(() => useNotePages(true));
    await flushMicrotasks();
    await hook.current.select("a", "push");
    await flushMicrotasks();

    // Desktop switch to uncached B keeps A visible and does not set blocking loading.
    const openB = hook.current.select("b", "push");
    await flushMicrotasks();
    expect(hook.current.activeId).toBe("a");
    expect(hook.current.openingId).toBe("b");
    expect(hook.current.loading).toBe(false);

    fetchB.resolve(jsonResponse({ page: pageB }));
    await openB;
    await flushMicrotasks();
    expect(hook.current.activeId).toBe("b");
    expect(hook.current.openingId).toBeNull();

    // Mobile Home -> uncached C with keepCurrent: false clears stale B and shows loading.
    const openC = hook.current.select("c", "none", { keepCurrent: false });
    await flushMicrotasks();
    expect(hook.current.activeId).toBeNull();
    expect(hook.current.openingId).toBe("c");
    expect(hook.current.loading).toBe(true);

    fetchC.resolve(jsonResponse({ page: pageC }));
    await openC;
    await flushMicrotasks();
    expect(hook.current.activeId).toBe("c");
    expect(hook.current.loading).toBe(false);
  });

  it("prefetches on hover after delay, deduplicates in-flight fetches, and opens prefetched pages in 0ms", async () => {
    createFakeBrowser();
    const pageA = makePage("a", "Alpha", 1);
    const pageB = makePage("b", "Beta", 1);
    const fetchB = deferred<Response>();

    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/pages") return Promise.resolve(jsonResponse({ pages: [makeSummary(pageA), makeSummary(pageB)], groups: [] }));
      if (url === "/api/pages/a") return Promise.resolve(jsonResponse({ page: pageA }));
      if (url === "/api/pages/b") return fetchB.promise;
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const hook = hookRuntime.mount(() => useNotePages(true));
    await flushMicrotasks();

    // Hover and cancel before 65ms -> no fetch.
    hook.current.prefetch("a", false);
    vi.advanceTimersByTime(30);
    hook.current.cancelPrefetch("a");
    vi.advanceTimersByTime(100);
    expect(fetchMock).not.toHaveBeenCalledWith("/api/pages/a", expect.anything());

    // Hover for >= 65ms -> prefetches A.
    hook.current.prefetch("a", false);
    vi.advanceTimersByTime(70);
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledWith("/api/pages/a", expect.anything());
    expect(hook.current.hasCached("a")).toBe(true);

    // Selecting freshly prefetched A opens synchronously without firing a second GET.
    const callsBefore = fetchMock.mock.calls.filter(([u]) => u === "/api/pages/a").length;
    await hook.current.select("a", "push");
    await flushMicrotasks();
    expect(hook.current.activeId).toBe("a");
    expect(fetchMock.mock.calls.filter(([u]) => u === "/api/pages/a").length).toBe(callsBefore);

    // Immediate prefetch on B followed by clicking B while still in flight -> reuses single fetch!
    hook.current.prefetch("b", true);
    const selectB = hook.current.select("b", "push");
    await flushMicrotasks();
    expect(fetchMock.mock.calls.filter(([u]) => u === "/api/pages/b").length).toBe(1);
    fetchB.resolve(jsonResponse({ page: pageB }));
    await selectB;
    await flushMicrotasks();
    expect(hook.current.activeId).toBe("b");
  });

  it("invalidates prefetched cache on notefable:page-updated and handles rapid clicks / cancelPending", async () => {
    const { fakeWindow, history } = createFakeBrowser();
    const pageA = makePage("a", "Alpha", 1);
    const pageB = makePage("b", "Beta", 1);
    const fetchA = deferred<Response>();
    const fetchB = deferred<Response>();
    let aCalls = 0;

    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/pages") return Promise.resolve(jsonResponse({ pages: [makeSummary(pageA), makeSummary(pageB)], groups: [] }));
      if (url === "/api/pages/a") {
        aCalls += 1;
        return aCalls === 1 ? Promise.resolve(jsonResponse({ page: pageA })) : fetchA.promise;
      }
      if (url === "/api/pages/b") return fetchB.promise;
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const hook = hookRuntime.mount(() => useNotePages(true));
    await flushMicrotasks();

    // Prefetch A, then invalidate via page-updated event.
    hook.current.prefetch("a", true);
    await flushMicrotasks();
    expect(hook.current.hasCached("a")).toBe(true);
    fakeWindow.dispatchEvent(new CustomEvent("notefable:page-updated", { detail: makePage("a", "Alpha v2", 2) }));
    expect(hook.current.hasCached("a")).toBe(false);

    // Start opening A (now uncached), then cancelPending -> resolving A must NOT switch activeId or URL,
    // but caches A so clicking it next is instant!
    const openA = hook.current.select("a", "push");
    await flushMicrotasks();
    expect(hook.current.openingId).toBe("a");
    hook.current.cancelPending();
    await flushMicrotasks();
    expect(hook.current.openingId).toBeNull();

    fetchA.resolve(jsonResponse({ page: makePage("a", "Alpha v2", 2) }));
    await openA;
    await flushMicrotasks();
    expect(hook.current.activeId).toBeNull();
    expect(history.pushState).not.toHaveBeenCalled();
    expect(hook.current.hasCached("a")).toBe(true);

    // Returning from Home to previously active A pushes ?page=a back onto URL.
    await hook.current.select("a", "push");
    await flushMicrotasks();
    expect(hook.current.activeId).toBe("a");
    fakeWindow.location.href = "https://app.notefable.com/app?view=pages";
    history.pushState.mockClear();

    await hook.current.select("a", "push");
    await flushMicrotasks();
    expect(history.pushState).toHaveBeenCalledWith(null, "", expect.objectContaining({ search: "?view=pages&page=a" }));
  });

  it("preloads editor chunks and switches whiteboard and slide pages instantaneously, and clears cache on AI trash undo", async () => {
    const { fakeWindow } = createFakeBrowser();
    const slidePage: NotePage = { ...makePage("s1", "Deck 1", 1), kind: "slides", data: { format: 1, theme: { id: "light", mode: "light" }, slides: [] } };
    const wbPage: NotePage = { ...makePage("w1", "Board 1", 1), kind: "whiteboard", data: { elements: [] } };
    const revalWb = deferred<Response>();
    let wbCalls = 0;

    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url === "/api/pages") return Promise.resolve(jsonResponse({ pages: [makeSummary(slidePage), makeSummary(wbPage)], groups: [] }));
      if (url === "/api/pages/s1") return Promise.resolve(jsonResponse({ page: slidePage }));
      if (url === "/api/pages/w1") {
        wbCalls += 1;
        return wbCalls === 1 ? Promise.resolve(jsonResponse({ page: wbPage })) : revalWb.promise;
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    }));

    const hook = hookRuntime.mount(() => useNotePages(true));
    await flushMicrotasks();

    // Prefetching a slide deck and whiteboard triggers kind-specific editor chunk preloads.
    hook.current.prefetch("s1", true);
    hook.current.prefetch("w1", true);
    await flushMicrotasks();
    expect(preloadPageEditor).toHaveBeenCalledWith("slides");
    expect(preloadPageEditor).toHaveBeenCalledWith("whiteboard");
    expect(hook.current.hasCached("s1")).toBe(true);
    expect(hook.current.hasCached("w1")).toBe(true);

    // Switching from whiteboard -> slides -> whiteboard is synchronous from cache with no loading flash.
    await hook.current.select("w1", "push");
    await flushMicrotasks();
    expect(hook.current.activeId).toBe("w1");
    await hook.current.select("s1", "push");
    await flushMicrotasks();
    expect(hook.current.activeId).toBe("s1");
    await hook.current.select("w1", "push");
    await flushMicrotasks();
    expect(hook.current.activeId).toBe("w1");
    expect(hook.current.loading).toBe(false);
    expect(hook.current.openingId).toBeNull();
    revalWb.resolve(jsonResponse({ page: wbPage }));
    await flushMicrotasks();

    // AI undo trashing a page invalidates cache and clears active page.
    fakeWindow.dispatchEvent(new CustomEvent(PAGES_TRASHED_EVENT, { detail: { ids: ["w1"] } }));
    await flushMicrotasks();
    expect(hook.current.hasCached("w1")).toBe(false);
    expect(hook.current.activeId).toBeNull();
  });
});
