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

const sheetCleanupMock = vi.hoisted(() => ({ isCleanup: false }));
const sheetHistory = vi.hoisted(() => ({ restoreSheetMarker: (() => {}) as () => void }));
vi.mock("@/lib/use-back-to-close", async () => {
  const { vi: mocks } = await import("vitest");
  const restoreSheetMarker = mocks.fn();
  sheetHistory.restoreSheetMarker = restoreSheetMarker;
  return {
    restoreSheetMarker,
    afterSheetHistory: (cb: () => void) => cb(),
    isSheetCleanupPopState: () => sheetCleanupMock.isCleanup,
    // 本物と同じく null で置き換えてから目印を積み直してもらう（積み直し自体は use-back-to-close.test.ts で確かめる）。
    replaceSheetUrl: (update: (url: URL) => boolean, after?: () => void) => {
      const url = new URL(window.location.href);
      if (!update(url)) return;
      window.history.replaceState(null, "", url);
      restoreSheetMarker();
      after?.();
    },
  };
});

const preloadPageEditor = vi.hoisted(() => vi.fn());
vi.mock("@/lib/preload-editor", () => ({
  preloadPageEditor,
}));

import { registerCanvasFlusher } from "@/lib/canvas-flush";
import { PAGES_TRASHED_EVENT, saveBeforePageChange } from "@/lib/proposal-sync";
import { createSlide } from "@/lib/slides/layouts";
import { DECK_FORMAT, normalizeDeck } from "@/lib/slides/model";
import { trackSlideUpload } from "@/lib/slides/upload-tracker";
import { NoteSaveQueue } from "./note-save-queue";
import { applyCanvasEditorChange, useNotePages } from "./use-note-pages";

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
    sheetCleanupMock.isCleanup = false;
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

  it("ignores tablet drawer cleanup popstate while keeping real Back cancellation, and flushes pending whiteboard strokes before revalidation", async () => {
    const { fakeWindow } = createFakeBrowser();
    const wbV1: NotePage = { ...makePage("w1", "Board", 1), kind: "whiteboard", data: { elements: [] } };
    const wbV2: NotePage = { ...makePage("w1", "Board v2", 2), kind: "whiteboard", data: { elements: [{ id: "remote", type: "rectangle" }] } };
    const pageB = makePage("b", "Beta", 1);
    const fetchB = deferred<Response>();
    const revalWb = deferred<Response>();
    let wbCalls = 0;

    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url === "/api/pages") return Promise.resolve(jsonResponse({ pages: [makeSummary(wbV1), makeSummary(pageB)], groups: [] }));
      if (url === "/api/pages/w1") {
        wbCalls += 1;
        return wbCalls === 1 ? Promise.resolve(jsonResponse({ page: wbV1 })) : revalWb.promise;
      }
      if (url === "/api/pages/b") return fetchB.promise;
      return Promise.reject(new Error(`unexpected ${url}`));
    }));

    const hook = hookRuntime.mount(() => useNotePages(true));
    await flushMicrotasks();
    await hook.current.select("w1", "push");
    await flushMicrotasks();

    // Start opening uncached B, then simulate tablet drawer cleanup popstate -> must NOT cancel B!
    const openB = hook.current.select("b", "push");
    await flushMicrotasks();
    expect(hook.current.openingId).toBe("b");
    sheetCleanupMock.isCleanup = true;
    fakeWindow.dispatchEvent(new Event("popstate"));
    sheetCleanupMock.isCleanup = false;
    await flushMicrotasks();
    expect(hook.current.openingId).toBe("b");

    fetchB.resolve(jsonResponse({ page: pageB }));
    await openB;
    await flushMicrotasks();
    expect(hook.current.activeId).toBe("b");

    // Switch back to cached whiteboard w1; register a pending 400ms stroke via sync flusher.
    await hook.current.select("w1", "push");
    await flushMicrotasks();
    const off = registerCanvasFlusher(
      () => true,
      () => {
        hook.current.active!.edit({ ...hook.current.active!.content, data: { elements: [{ id: "local-stroke", type: "freedraw" }] } });
        return false;
      },
    );
    try {
      revalWb.resolve(jsonResponse({ page: wbV2 }));
      await flushMicrotasks();
      // Pending stroke was flushed synchronously before loadLatest -> conflict raised instead of silently discarding!
      expect(hook.current.active?.status).toBe("conflict");
      expect(hook.current.active?.content.data).toEqual({ elements: [{ id: "local-stroke", type: "freedraw" }] });
    } finally {
      off();
    }
  });

  it("preserves newer lock/favorite settings on cached open and refetches invalidated in-flight prefetches", async () => {
    const { fakeWindow, history } = createFakeBrowser();
    const pageA = makePage("a", "Alpha", 1);
    const pageB1 = makePage("b", "Beta v1", 1);
    const pageB2 = makePage("b", "Beta v2", 2);
    const prefetchB1 = deferred<Response>();
    let bCalls = 0;

    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/pages") return Promise.resolve(jsonResponse({ pages: [makeSummary(pageA), makeSummary(pageB1)], groups: [] }));
      if (url === "/api/pages/a") return Promise.resolve(jsonResponse({ page: pageA }));
      if (url === "/api/pages/a/settings" && init?.method === "PUT") {
        return Promise.resolve(jsonResponse({ page: { ...makeSummary(pageA), locked: true } }));
      }
      if (url === "/api/pages/b") {
        bCalls += 1;
        return bCalls === 1 ? prefetchB1.promise : Promise.resolve(jsonResponse({ page: pageB2 }));
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    }));

    const hook = hookRuntime.mount(() => useNotePages(true));
    await flushMicrotasks();

    // 1. Prefetch A (locked: false), then lock A from sidebar -> opening A must keep locked: true!
    hook.current.prefetch("a", true);
    await flushMicrotasks();
    await hook.current.updateSettings("a", { locked: true });
    await flushMicrotasks();
    expect(hook.current.pages.find((p) => p.id === "a")?.locked).toBe(true);
    await hook.current.select("a", "push");
    await flushMicrotasks();
    expect(hook.current.pages.find((p) => p.id === "a")?.locked).toBe(true);

    // 2. Click joins in-flight prefetch of B1; AI update arrives mid-flight -> select must refetch B2!
    hook.current.prefetch("b", true);
    const selectB = hook.current.select("b", "push");
    await flushMicrotasks();
    fakeWindow.dispatchEvent(new CustomEvent("notefable:page-updated", { detail: pageB2 }));
    prefetchB1.resolve(jsonResponse({ page: pageB1 }));
    await selectB;
    await flushMicrotasks();
    expect(bCalls).toBe(2);
    expect(hook.current.activeId).toBe("b");
    expect(hook.current.active?.content.title).toBe("Beta v2");
    expect(hook.current.active?.version).toBe(2);

    // 3. Reselecting displayed B when URL points elsewhere restores URL back to ?page=b.
    fakeWindow.location.href = "https://app.notefable.com/app?view=pages&page=other";
    history.pushState.mockClear();
    await hook.current.select("b", "push");
    await flushMicrotasks();
    expect(history.pushState).toHaveBeenCalledWith(null, "", expect.objectContaining({ search: "?view=pages&page=b" }));
  });

  it("supports deactivate() + instant reopen and caps clean embedded queues at 8 while keeping dirty queues", async () => {
    createFakeBrowser("https://app.notefable.com/note-embed?page=p1");
    const pages = Array.from({ length: 10 }, (_, i) => makePage(`p${i + 1}`, `Page ${i + 1}`, 1));
    const revalP1 = deferred<Response>();
    let p1Calls = 0;

    vi.stubGlobal("fetch", vi.fn((url: string) => {
      const match = /^\/api\/pages\/(p\d+)$/.exec(url);
      if (match) {
        const id = match[1];
        const page = pages.find((p) => p.id === id)!;
        if (id === "p1") {
          p1Calls += 1;
          return p1Calls === 1 ? Promise.resolve(jsonResponse({ page })) : revalP1.promise;
        }
        return Promise.resolve(jsonResponse({ page }));
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    }));

    const hook = hookRuntime.mount(() => useNotePages(false, { embedded: true }));
    await flushMicrotasks();

    // Open p1 and deactivate (native went back to Home): active clears, cache stays warm.
    await hook.current.select("p1", "none", { keepCurrent: false });
    await flushMicrotasks();
    expect(hook.current.activeId).toBe("p1");
    hook.current.deactivate();
    await flushMicrotasks();
    expect(hook.current.activeId).toBeNull();
    expect(hook.current.hasCached("p1")).toBe(true);

    // Reopen p1 immediately from cache BEFORE revalP1 resolves.
    await hook.current.select("p1", "none", { keepCurrent: false });
    await flushMicrotasks();
    expect(hook.current.activeId).toBe("p1");
    expect(hook.current.loading).toBe(false);
    revalP1.resolve(jsonResponse({ page: pages[0] }));
    await flushMicrotasks();

    // Make p2 dirty; then open p3..p10 (10 pages total > cap of 8).
    // Oldest clean page (p1) is evicted, while dirty p2 and recent p3..p10 stay cached.
    await hook.current.select("p2", "none", { keepCurrent: false });
    await flushMicrotasks();
    hook.current.active!.edit({ ...hook.current.active!.content, title: "Dirty p2" });
    await flushMicrotasks();
    for (let i = 3; i <= 10; i++) {
      await hook.current.select(`p${i}`, "none", { keepCurrent: false });
      await flushMicrotasks();
    }
    expect(hook.current.hasCached("p1")).toBe(false);
    expect(hook.current.hasCached("p2")).toBe(true);
    expect(hook.current.hasCached("p10")).toBe(true);
  });

  it("notifies onMissing when a clean cached note revalidates as 404 and retries failed cached drafts on reopen", async () => {
    createFakeBrowser();
    const pageA = makePage("a", "Alpha", 1);
    const pageB = makePage("b", "Beta", 1);
    let aFetchCount = 0;
    let bPatchCount = 0;
    const missing: string[] = [];

    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/pages/a") {
        aFetchCount += 1;
        return aFetchCount === 1
          ? Promise.resolve(jsonResponse({ page: pageA }))
          : Promise.resolve(jsonResponse({ error: "Not found" }, 404));
      }
      if (url === "/api/pages/b" && init?.method === "PATCH") {
        bPatchCount += 1;
        if (bPatchCount === 1) return Promise.resolve(jsonResponse({ error: "Temporary outage" }, 503));
        return Promise.resolve(jsonResponse({ page: makePage("b", "Unsaved B", 2) }));
      }
      if (url === "/api/pages/b") return Promise.resolve(jsonResponse({ page: pageB }));
      return Promise.reject(new Error(`unexpected ${url}`));
    }));

    const hook = hookRuntime.mount(() => useNotePages(false, { embedded: true, onMissing: (id) => { missing.push(id); } }));
    await flushMicrotasks();

    // 1. Open A, deactivate, reopen A -> background 404 must notify onMissing("a").
    await hook.current.select("a", "none", { keepCurrent: false });
    await flushMicrotasks();
    hook.current.deactivate();
    await flushMicrotasks();
    await hook.current.select("a", "none", { keepCurrent: false });
    await flushMicrotasks();
    expect(missing).toEqual(["a"]);
    expect(hook.current.activeId).toBeNull();

    // 2. Open B, make an edit whose save fails (503), leave, reopen B -> revalidation confirms v1 and retries save.
    await hook.current.select("b", "none", { keepCurrent: false });
    await flushMicrotasks();
    hook.current.active!.edit({ ...hook.current.active!.content, title: "Unsaved B" });
    await hook.current.active!.flush();
    await flushMicrotasks();
    expect(hook.current.active?.status).toBe("error");
    hook.current.deactivate();
    await flushMicrotasks();

    await hook.current.select("b", "none", { keepCurrent: false });
    await flushMicrotasks();
    await flushMicrotasks();
    expect(bPatchCount).toBe(2);
    expect(hook.current.active?.status).toBe("saved");
    expect(hook.current.active?.version).toBe(2);
  });

  it("preserves unsaved drafts on native pageTrashed and recovers them when restored", async () => {
    createFakeBrowser();
    const pageA = makePage("a", "Alpha", 1);
    let patchCount = 0;

    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/pages/a" && init?.method === "PATCH") {
        patchCount += 1;
        return patchCount === 1
          ? Promise.resolve(jsonResponse({ error: "Temporary outage" }, 503))
          : Promise.resolve(jsonResponse({ page: makePage("a", "Unsaved draft", 2) }));
      }
      if (url === "/api/pages/a") return Promise.resolve(jsonResponse({ page: pageA }));
      return Promise.reject(new Error(`unexpected ${url}`));
    }));

    const hook = hookRuntime.mount(() => useNotePages(false, { embedded: true }));
    await flushMicrotasks();

    await hook.current.select("a", "none", { keepCurrent: false });
    await flushMicrotasks();
    hook.current.active!.edit({ ...hook.current.active!.content, title: "Unsaved draft" });
    await hook.current.active!.flush();
    await flushMicrotasks();
    expect(localStorage.getItem("notefable:page-draft:v1:a")).toContain("Unsaved draft");

    // Native trashes the page from the list: evicts warm queue, preserves localStorage draft.
    window.dispatchEvent(new CustomEvent("notefable:pages-trashed", { detail: { ids: ["a"], preserveDrafts: true } }));
    await flushMicrotasks();
    expect(hook.current.hasCached("a")).toBe(false);
    expect(localStorage.getItem("notefable:page-draft:v1:a")).toContain("Unsaved draft");

    // Page is restored and reopened: draft is recovered on top of v1.
    await hook.current.select("a", "none", { keepCurrent: false });
    await flushMicrotasks();
    expect(hook.current.active?.content.title).toBe("Unsaved draft");
    expect(hook.current.active?.dirty).toBe(true);
  });

  it("revalidates a gone cached queue after restore instead of immediately reporting missing", async () => {
    createFakeBrowser();
    const pageA = makePage("a", "Alpha", 1);
    let getCount = 0;
    let patchCount = 0;

    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/pages/a" && init?.method === "PATCH") {
        patchCount += 1;
        return Promise.resolve(jsonResponse({ page: makePage("a", "Dirty after restore", 2) }));
      }
      if (url === "/api/pages/a") {
        getCount += 1;
        if (getCount === 2) return Promise.resolve(jsonResponse({ error: "Not found" }, 404));
        return Promise.resolve(jsonResponse({ page: pageA }));
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    }));

    const hook = hookRuntime.mount(() => useNotePages(false, { embedded: true }));
    await flushMicrotasks();

    // Open A, edit it locally (dirty), then revalidate while trashed -> marks queue.gone = true.
    await hook.current.select("a", "none", { keepCurrent: false });
    await flushMicrotasks();
    hook.current.active!.edit({ ...hook.current.active!.content, title: "Dirty after restore" });
    hook.current.deactivate();
    await flushMicrotasks();
    await hook.current.select("a", "none", { keepCurrent: false });
    await flushMicrotasks();
    expect(hook.current.active?.gone).toBe(true);

    // Restore A on the server, leave, and reopen -> must revalidate from server, clear gone, and keep draft.
    hook.current.deactivate();
    await flushMicrotasks();
    const opened = await hook.current.select("a", "none", { keepCurrent: false });
    await flushMicrotasks();
    expect(opened).toBe(true);
    expect(hook.current.active?.gone).toBe(false);
    expect(hook.current.active?.content.title).toBe("Dirty after restore");
    expect(patchCount).toBe(0);
  });

  it("keeps a newer pending navigation alive when the previously displayed cached page returns 404", async () => {
    createFakeBrowser("https://app.notefable.com/app?view=pages");
    const pageA = makePage("a", "Alpha", 1);
    const pageB = makePage("b", "Beta", 1);
    let aFetchCount = 0;
    const revalA = deferred<Response>();
    const fetchB = deferred<Response>();

    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url === "/api/pages") return Promise.resolve(jsonResponse({ pages: [pageA, pageB], groups: [] }));
      if (url === "/api/pages/a") {
        aFetchCount += 1;
        return aFetchCount === 1 ? Promise.resolve(jsonResponse({ page: pageA })) : revalA.promise;
      }
      if (url === "/api/pages/b") return fetchB.promise;
      return Promise.reject(new Error(`unexpected ${url}`));
    }));

    const hook = hookRuntime.mount(() => useNotePages(true));
    await flushMicrotasks();

    // Cache A first, then reopen A so background revalidation is in flight.
    await hook.current.select("a", "push");
    await flushMicrotasks();
    await hook.current.select("a", "replace");
    await flushMicrotasks();

    // Start navigating to uncached B while A is still displayed.
    const openingB = hook.current.select("b", "push");
    await flushMicrotasks();

    // A's background revalidation returns 404 before B resolves.
    revalA.resolve(jsonResponse({ error: "Not found" }, 404));
    await flushMicrotasks();

    // B resolves and must still become active (not cancelled by A's 404 cleanup).
    fetchB.resolve(jsonResponse({ page: pageB }));
    await openingB;
    await flushMicrotasks();
    expect(hook.current.activeId).toBe("b");
    expect(hook.current.active?.content.title).toBe("Beta");
  });

  it("applies fresh settings from a prefetched page when no newer local metadata change happened", async () => {
    createFakeBrowser("https://app.notefable.com/app?view=pages");
    const listSummary = { ...makePage("a", "Alpha", 1), locked: false };
    const prefetchedLocked = { ...makePage("a", "Alpha", 1), locked: true };

    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url === "/api/pages") return Promise.resolve(jsonResponse({ pages: [listSummary], groups: [] }));
      if (url === "/api/pages/a") return Promise.resolve(jsonResponse({ page: prefetchedLocked }));
      return Promise.reject(new Error(`unexpected ${url}`));
    }));

    const hook = hookRuntime.mount(() => useNotePages(true));
    await flushMicrotasks();
    expect(hook.current.pages[0]?.locked).toBe(false);

    // Prefetch gets locked=true from another device, then user clicks immediately within 5s.
    hook.current.prefetch("a", true);
    await flushMicrotasks();
    await hook.current.select("a", "push");
    await flushMicrotasks();

    expect(hook.current.pages[0]?.locked).toBe(true);
  });

  it("keeps a failed trash out of the list-load error and does not close anything", async () => {
    createFakeBrowser();
    const pageA = makePage("a", "Alpha", 1);
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/pages") return Promise.resolve(jsonResponse({ pages: [makeSummary(pageA)], groups: [] }));
      if (url === "/api/pages/a" && init?.method === "DELETE") return Promise.resolve(jsonResponse({ error: "Trash is unavailable." }, 503));
      if (url === "/api/pages/a") return Promise.resolve(jsonResponse({ page: pageA }));
      return Promise.reject(new Error(`unexpected ${url}`));
    }));
    const hook = hookRuntime.mount(() => useNotePages(true));
    await flushMicrotasks();
    await hook.current.select("a", "push");
    await flushMicrotasks();

    expect(await hook.current.remove("a")).toBe(false);
    await flushMicrotasks();
    expect(hook.current.trashError).toBe("Trash is unavailable.");
    // 一覧の読み込み失敗（「再試行」で一覧を読み直す帯）には出さない。
    expect(hook.current.error).toBe("");
    expect(hook.current.activeId).toBe("a");
    expect(hook.current.pages.map((page) => page.id)).toEqual(["a"]);
    hook.current.clearTrashError();
    await flushMicrotasks();
    expect(hook.current.trashError).toBe("");
  });

  it("keeps pages created or renamed while a trash request is in flight", async () => {
    createFakeBrowser();
    const pageA = makePage("a", "Alpha", 1);
    const pageB = makePage("b", "Beta", 1);
    const pageChild = { ...makePage("c", "Child", 1), parentId: "a" };
    const deleteA = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/pages") return Promise.resolve(jsonResponse({ pages: [makeSummary(pageA), makeSummary(pageB), makeSummary(pageChild)], groups: [] }));
      if (url === "/api/pages/a" && init?.method === "DELETE") return deleteA.promise;
      return Promise.reject(new Error(`unexpected ${url}`));
    }));
    const hook = hookRuntime.mount(() => useNotePages(true));
    await flushMicrotasks();

    const removing = hook.current.remove("a");
    await flushMicrotasks();
    // 待っている間に、チャットから新しいページが作られ、別のページの名前が変わった。
    window.dispatchEvent(new CustomEvent("notefable:page-created", { detail: makePage("n", "New", 1) }));
    window.dispatchEvent(new CustomEvent("notefable:page-updated", { detail: makePage("b", "Beta renamed", 2) }));
    await flushMicrotasks();
    deleteA.resolve(jsonResponse({ ids: ["c"] }));
    expect(await removing).toBe(true);
    await flushMicrotasks();
    const byId = new Map(hook.current.pages.map((page) => [page.id, page]));
    expect([...byId.keys()].sort()).toEqual(["b", "n"]);
    expect(byId.get("b")?.title).toBe("Beta renamed");
  });

  it("removes the trashed note from the URL without dropping the drawer's Back marker", async () => {
    const { history } = createFakeBrowser("https://app.notefable.com/app?view=pages&page=a");
    const pageA = makePage("a", "Alpha", 1);
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/pages") return Promise.resolve(jsonResponse({ pages: [makeSummary(pageA)], groups: [] }));
      if (url === "/api/pages/a" && init?.method === "DELETE") return Promise.resolve(jsonResponse({ ids: [] }));
      if (url === "/api/pages/a") return Promise.resolve(jsonResponse({ page: pageA }));
      return Promise.reject(new Error(`unexpected ${url}`));
    }));
    const hook = hookRuntime.mount(() => useNotePages(true));
    await flushMicrotasks();
    expect(hook.current.activeId).toBe("a");
    // モバイルのドロワーが開いている（目印の履歴にいる）。
    history.pushState({ notefableSheet: true }, "");
    vi.mocked(sheetHistory.restoreSheetMarker).mockClear();

    expect(await hook.current.remove("a")).toBe(true);
    await flushMicrotasks();
    expect(hook.current.activeId).toBeNull();
    expect(window.location.href).toBe("https://app.notefable.com/app?view=pages");
    expect(sheetHistory.restoreSheetMarker).toHaveBeenCalledTimes(1);
  });

  it("restores the sheet marker when AI-undo trashing or a missing note cleans the URL", async () => {
    const { history } = createFakeBrowser("https://app.notefable.com/app?view=pages&page=gone");
    const pageA = makePage("a", "Alpha", 1);
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url === "/api/pages") return Promise.resolve(jsonResponse({ pages: [makeSummary(pageA)], groups: [] }));
      if (url === "/api/pages/a") return Promise.resolve(jsonResponse({ page: pageA }));
      return Promise.reject(new Error(`unexpected ${url}`));
    }));
    history.pushState({ notefableSheet: true }, "");
    vi.mocked(sheetHistory.restoreSheetMarker).mockClear();
    const hook = hookRuntime.mount(() => useNotePages(true));
    await flushMicrotasks();
    // 一覧に無いノートを指す URL：page= を外し、目印は積み直してもらう。
    expect(window.location.href).toBe("https://app.notefable.com/app?view=pages");
    expect(sheetHistory.restoreSheetMarker).toHaveBeenCalledTimes(1);

    await hook.current.select("a", "push");
    await flushMicrotasks();
    history.pushState({ notefableSheet: true }, "");
    vi.mocked(sheetHistory.restoreSheetMarker).mockClear();
    window.dispatchEvent(new CustomEvent(PAGES_TRASHED_EVENT, { detail: { ids: ["a"] } }));
    await flushMicrotasks();
    expect(window.location.href).toBe("https://app.notefable.com/app?view=pages");
    expect(sheetHistory.restoreSheetMarker).toHaveBeenCalledTimes(1);
  });

  it("syncs locked metadata onto both pages and active queue.page from updateSettings and notefable:page-meta", async () => {
    createFakeBrowser("https://app.notefable.com/app?view=pages&page=a");
    const pageA = makePage("a", "Alpha", 1);
    const updatedSummaryLocked = { ...makeSummary(pageA), locked: true };
    const externalUnlocked = { ...makeSummary(pageA), locked: false };
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/pages") return Promise.resolve(jsonResponse({ pages: [makeSummary(pageA)], groups: [] }));
      if (url === "/api/pages/a") return Promise.resolve(jsonResponse({ page: pageA }));
      if (url === "/api/pages/a/settings" && init?.method === "PUT") {
        return Promise.resolve(jsonResponse({ page: updatedSummaryLocked }));
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    }));

    const hook = hookRuntime.mount(() => useNotePages(true));
    await flushMicrotasks();
    expect(hook.current.active?.page.locked).toBe(false);

    expect(await hook.current.updateSettings("a", { locked: true })).toBe(true);
    await flushMicrotasks();
    expect(hook.current.pages.find((p) => p.id === "a")?.locked).toBe(true);
    expect(hook.current.active?.page.locked).toBe(true);

    // Cross-view metadata update from embed/panel must also sync active queue.page.locked immediately.
    window.dispatchEvent(new CustomEvent("notefable:page-meta", { detail: externalUnlocked }));
    await flushMicrotasks();
    expect(hook.current.pages.find((p) => p.id === "a")?.locked).toBe(false);
    expect(hook.current.active?.page.locked).toBe(false);
  });

  it("merges detached functional updates onto latest queue data while guarding generation, locked, gone, conflict, and deleted targets", () => {
    const initialDeck = normalizeDeck({
      format: DECK_FORMAT,
      theme: { id: "simple", mode: "light" },
      slides: [
        { ...createSlide("bullets", { title: "Slide 1" }), id: "s1" },
        { ...createSlide("bullets", { title: "Slide 2" }), id: "s2" },
      ],
    });
    const newerDeck = normalizeDeck({
      ...initialDeck,
      slides: [
        { ...createSlide("bullets", { title: "Edited After Reopen" }), id: "s1" },
        initialDeck.slides[1],
      ],
    });

    const page: NotePage = {
      ...makePage("sl1", "Deck", 1),
      kind: "slides",
      data: initialDeck as unknown as NotePage["data"],
    };
    const save = vi.fn(async (content) => ({ ...page, ...content, version: 2 }));
    const changed = vi.fn();
    const queue = new NoteSaveQueue(page, save, changed);
    // Simulate newer edit made after reopening the deck on the same queue generation.
    queue.edit({ ...queue.content, data: newerDeck as unknown as NotePage["data"] });

    // Functional updater merges an image element onto s2 using latest queue.content.data, preserving s1's newer title.
    const merged = applyCanvasEditorChange(queue, 0, false, (latest) => {
      const d = normalizeDeck(latest);
      if (!d.slides.some((s) => s.id === "s2")) return null;
      return {
        ...d,
        slides: d.slides.map((s) => (s.id === "s2" ? { ...s, notes: "Attached later" } : s)),
      } as unknown as typeof latest;
    });
    expect(merged).toBe(true);
    const savedDeck = normalizeDeck(queue.content.data);
    expect(savedDeck.slides[0].elements.find((e) => e.type === "text" && e.role === "title")?.type === "text").toBe(true);
    expect(savedDeck.slides[1].notes).toBe("Attached later");
    expect((savedDeck.slides[0].elements[0] as { doc: { content: Array<{ content?: Array<{ text?: string }> }> } }).doc.content[0]?.content?.[0]?.text).toBe("Edited After Reopen");

    // Returns false when updater returns null (e.g. target slide was deleted).
    const beforeNullEdit = queue.content.data;
    expect(applyCanvasEditorChange(queue, 0, false, () => null)).toBe(false);
    expect(queue.content.data).toBe(beforeNullEdit);

    // Guards against locked page, gone queue, and generation mismatch; allows merging into a conflict draft without scheduling overwrite saves.
    expect(applyCanvasEditorChange(queue, 0, true, (latest) => latest)).toBe(false);
    expect(applyCanvasEditorChange(queue, 1, false, (latest) => latest)).toBe(false);
    queue.gone = true;
    expect(applyCanvasEditorChange(queue, 0, false, (latest) => latest)).toBe(false);
    queue.gone = false;
    queue.status = "conflict";
    const mergedDuringConflict = applyCanvasEditorChange(queue, 0, false, (latest) => {
      const d = normalizeDeck(latest);
      return {
        ...d,
        slides: d.slides.map((s) => (s.id === "s2" ? { ...s, notes: "Uploaded during conflict" } : s)),
      } as unknown as typeof latest;
    });
    expect(mergedDuringConflict).toBe(true);
    expect(queue.status).toBe("conflict");
    expect(normalizeDeck(queue.content.data).slides[1].notes).toBe("Uploaded during conflict");
  });

  it("flushes pending canvas edits before locking, syncs locked state from 423 PAGE_LOCKED without false conflict, and marks queues gone on manual Trash", async () => {
    createFakeBrowser("https://app.notefable.com/app?view=pages&page=sl1");
    const initialDeck = normalizeDeck({
      format: DECK_FORMAT,
      theme: { id: "simple", mode: "light" },
      slides: [{ ...createSlide("bullets", { title: "Deck" }), id: "s1" }],
    });
    const page: NotePage = {
      ...makePage("sl1", "Deck", 1),
      kind: "slides",
      data: initialDeck as unknown as NotePage["data"],
    };
    const lockedSummary = { ...makeSummary(page), locked: true };
    const callOrder: string[] = [];
    let rejectPatchAsLocked = false;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/pages") return Promise.resolve(jsonResponse({ pages: [makeSummary(page)], groups: [] }));
      if (url === "/api/pages/sl1" && (!init?.method || init.method === "GET")) return Promise.resolve(jsonResponse({ page }));
      if (url === "/api/pages/sl1" && init?.method === "PATCH") {
        callOrder.push("PATCH");
        if (rejectPatchAsLocked) {
          return Promise.resolve(jsonResponse({ error: "This page is locked.", code: "PAGE_LOCKED", page: lockedSummary }, 423));
        }
        return Promise.resolve(jsonResponse({ version: 2, page: { ...makeSummary(page), title: "Saved before lock", version: 2 } }));
      }
      if (url === "/api/pages/sl1/settings" && init?.method === "PUT") {
        callOrder.push("PUT /settings");
        return Promise.resolve(jsonResponse({ page: { ...lockedSummary, version: 2 } }));
      }
      if (url === "/api/pages/sl1" && init?.method === "DELETE") {
        return Promise.resolve(jsonResponse({ ids: [] }));
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    }));

    const hook = hookRuntime.mount(() => useNotePages(true));
    await flushMicrotasks();
    const queue = hook.current.active!;
    expect(queue).toBeDefined();

    // Locking flushes pending edits first so PATCH lands before PUT /settings.
    queue.edit({ ...queue.content, title: "Saved before lock" });
    expect(await hook.current.updateSettings("sl1", { locked: true })).toBe(true);
    await flushMicrotasks();
    expect(callOrder).toEqual(["PATCH", "PUT /settings"]);
    expect(queue.status).toBe("saved");
    expect(queue.page.locked).toBe(true);

    // A 423 PAGE_LOCKED rejection keeps the draft in "error" (not false "conflict") and syncs locked: true.
    rejectPatchAsLocked = true;
    queue.page = { ...queue.page, locked: false };
    queue.edit({ ...queue.content, title: "Edited while locked remotely" });
    expect(await queue.flush()).toBe(false);
    await flushMicrotasks();
    expect(hook.current.pages.find((p) => p.id === "sl1")?.locked).toBe(true);
    expect(queue.page.locked).toBe(true);
    expect(queue.status).toBe("error");
    expect(queue.error).toBe("This page is locked.");

    // Load latest resolved version, then verify manual Trash marks queue gone
    // and prevents late detached callbacks from writing or reinserting the page.
    queue.loadLatest(page);
    expect(await hook.current.remove("sl1")).toBe(true);
    await flushMicrotasks();
    expect(queue.gone).toBe(true);
    expect(hook.current.pages).toEqual([]);
    expect(applyCanvasEditorChange(queue, queue.generation, false, (latest) => latest)).toBe(false);
    expect(localStorage.getItem("notefable:canvas-draft:v1:sl1")).toBeNull();
  });

  it("waits for detached slide uploads on PAGES_WILL_CHANGE and avoids loadLatest overwrite on background page updates", async () => {
    const { fakeWindow } = createFakeBrowser("https://app.notefable.com/app?view=pages&page=sl1");
    const initialDeck = normalizeDeck({
      format: DECK_FORMAT,
      theme: { id: "simple", mode: "light" },
      slides: [{ ...createSlide("bullets", { title: "Deck" }), id: "s1" }],
    });
    const sl1: NotePage = {
      ...makePage("sl1", "Deck", 1),
      kind: "slides",
      data: initialDeck as unknown as NotePage["data"],
    };
    const sl1v2: NotePage = {
      ...sl1,
      title: "Deck v2",
      version: 2,
    };
    const otherNote = makePage("n2", "Other Note", 1);

    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url === "/api/pages") return Promise.resolve(jsonResponse({ pages: [makeSummary(sl1), makeSummary(otherNote)], groups: [] }));
      if (url === "/api/pages/sl1") return Promise.resolve(jsonResponse({ page: sl1 }));
      if (url === "/api/pages/n2") return Promise.resolve(jsonResponse({ page: otherNote }));
      return Promise.reject(new Error(`unexpected ${url}`));
    }));

    const hook = hookRuntime.mount(() => useNotePages(true));
    await flushMicrotasks();
    const slQueue = hook.current.active!;
    expect(slQueue.page.id).toBe("sl1");

    const upload1 = deferred<void>();
    trackSlideUpload("sl1", upload1.promise, 5000);
    await hook.current.select("n2", "push");
    await flushMicrotasks();
    expect(hook.current.activeId).toBe("n2");

    // 1. PAGES_WILL_CHANGE waits for the detached upload on sl1 even while n2 is displayed.
    let changeReady = false;
    const waiting = saveBeforePageChange(["sl1"]).then((ok) => {
      changeReady = true;
      return ok;
    });
    await flushMicrotasks();
    expect(changeReady).toBe(false);
    upload1.resolve();
    expect(await waiting).toBe(true);

    // 2. Background page-updated while another detached upload is still running flags conflict instead of loadLatest().
    const upload2 = deferred<void>();
    trackSlideUpload("sl1", upload2.promise, 5000);
    try {
      fakeWindow.dispatchEvent(new CustomEvent("notefable:page-updated", { detail: sl1v2 }));
      await flushMicrotasks();
      expect(slQueue.status).toBe("conflict");
      expect(slQueue.generation).toBe(0);
      expect(slQueue.latest?.version).toBe(2);
    } finally {
      upload2.resolve();
      await flushMicrotasks();
    }
  });

  it("keeps a page created while the initial list load is still in flight", async () => {
    createFakeBrowser("https://app.notefable.com/app?view=pages");
    const existing = makePage("old", "Old", 1);
    const created = makePage("fresh", "Untitled", 1);
    const listFetch = deferred<Response>();

    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/pages" && (!init?.method || init.method === "GET")) return listFetch.promise;
      if (url === "/api/pages" && init?.method === "POST") return Promise.resolve(jsonResponse({ page: created }, 201));
      return Promise.reject(new Error(`unexpected ${init?.method ?? "GET"} ${url}`));
    }));

    const hook = hookRuntime.mount(() => useNotePages(true));
    await flushMicrotasks();
    expect(hook.current.listLoading).toBe(true);

    // User clicks New note before GET /api/pages finishes.
    await hook.current.create(false, null, "note", null);
    await flushMicrotasks();
    expect(hook.current.activeId).toBe("fresh");
    expect(window.location.href).toContain("page=fresh");

    // Now the older GET /api/pages resolves without "fresh".
    listFetch.resolve(jsonResponse({ pages: [existing], groups: [] }));
    await flushMicrotasks();

    expect(hook.current.activeId).toBe("fresh");
    expect(hook.current.active?.page.id).toBe("fresh");
    expect(hook.current.pages.map((p) => p.id)).toContain("fresh");
    expect(window.location.href).toContain("page=fresh");
  });

  it("does not resurrect a page created and trashed during initial load, and keeps sidebar updates made before load finishes", async () => {
    createFakeBrowser("https://app.notefable.com/app?view=pages&page=old");
    const existing = makePage("old", "Old", 1);
    const trashed = makePage("temp", "Temp", 1);
    const kept = makePage("kept", "Untitled", 1);
    const listFetch = deferred<Response>();
    let createCount = 0;

    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/pages" && (!init?.method || init.method === "GET")) return listFetch.promise;
      if (url === "/api/pages" && init?.method === "POST") {
        createCount += 1;
        return Promise.resolve(jsonResponse({ page: createCount === 1 ? trashed : kept }, 201));
      }
      if (url === "/api/pages/temp" && init?.method === "DELETE") {
        return Promise.resolve(jsonResponse({ ids: ["temp"] }));
      }
      if (url === "/api/pages/kept/favorite" && init?.method === "PUT") {
        return Promise.resolve(jsonResponse({ page: { ...kept, favoritedAt: "2026-11-26T00:00:00.000Z" } }));
      }
      return Promise.reject(new Error(`unexpected ${init?.method ?? "GET"} ${url}`));
    }));

    const hook = hookRuntime.mount(() => useNotePages(true));
    await flushMicrotasks();

    // Create "temp" and trash it before GET /api/pages finishes.
    await hook.current.create(false, null, "note", null);
    await flushMicrotasks();
    await hook.current.remove("temp");
    await flushMicrotasks();

    // Create "kept" and favorite it before GET /api/pages finishes; also leave URL pointing at "old"
    // (simulating deferred syncPageUrl waiting on sheet cleanup).
    await hook.current.create(false, null, "note", null);
    await flushMicrotasks();
    await hook.current.setFavorite("kept", true);
    await flushMicrotasks();
    window.history.replaceState(null, "", "https://app.notefable.com/app?view=pages&page=old");

    // Resolve initial GET /api/pages with only "old".
    listFetch.resolve(jsonResponse({ pages: [existing], groups: [] }));
    await flushMicrotasks();

    // "temp" must not come back; "kept" must retain its favorite and remain active instead of reverting to "old".
    expect(hook.current.pages.map((p) => p.id).sort()).toEqual(["kept", "old"]);
    expect(hook.current.pages.find((p) => p.id === "kept")?.favoritedAt).toBe("2026-11-26T00:00:00.000Z");
    expect(hook.current.activeId).toBe("kept");
  });
});
