import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// useBackToClose を React なしで呼べるよう、effect をその場で走らせる。
const cleanups = vi.hoisted(() => [] as (() => void)[]);
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useRef: <T,>(value: T) => ({ current: value }),
  useEffect: (effect: () => (() => void) | void) => {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  },
}));

type Entry = { state: unknown; href: string };

function fakeBrowser(entries: Entry[]) {
  const stack = entries.map((entry) => ({ ...entry }));
  let index = stack.length - 1;
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const dispatch = (event: Event) => { for (const listener of listeners.get(event.type) ?? []) listener(event); };
  const history = {
    get state() { return stack[index].state; },
    pushState: vi.fn((state: unknown, _title: string, url?: string | URL | null) => {
      const href = url ? new URL(String(url), stack[index].href).href : stack[index].href;
      stack.splice(index + 1);
      stack.push({ state, href });
      index = stack.length - 1;
    }),
    replaceState: vi.fn((state: unknown, _title: string, url?: string | URL | null) => {
      const href = url ? new URL(String(url), stack[index].href).href : stack[index].href;
      stack[index] = { state, href };
    }),
    back: vi.fn(() => {
      if (index === 0) return;
      index -= 1;
      // 実際の popstate と同じく、少し後に（信頼できるイベントとして）届く。
      setTimeout(() => dispatch({ type: "popstate", isTrusted: true } as unknown as Event));
    }),
  };
  vi.stubGlobal("window", {
    history,
    location: { get href() { return stack[index].href; } },
    addEventListener: (type: string, listener: (event: Event) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: (event: Event) => void) => { listeners.get(type)?.delete(listener); },
  });
  return { history, stack, current: () => stack[index], userBack: () => { index -= 1; dispatch({ type: "popstate", isTrusted: true } as unknown as Event); } };
}

const NOTE = "https://app.notefable.com/app?view=pages&page=x";
const HOME = "https://app.notefable.com/app?view=pages";
const dropPage = (url: URL) => {
  if (url.searchParams.get("page") !== "x") return false;
  url.searchParams.delete("page");
  return true;
};

describe("replaceSheetUrl", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    cleanups.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the drawer's Back marker when a trashed note's URL is cleaned up while the drawer is open", async () => {
    const browser = fakeBrowser([{ state: null, href: NOTE }]);
    const { replaceSheetUrl, useBackToClose } = await import("./use-back-to-close");
    const closeDrawer = vi.fn();
    useBackToClose(true, closeDrawer);
    expect(browser.current()).toEqual({ state: { notefableSheet: true }, href: NOTE });

    const after = vi.fn();
    replaceSheetUrl(dropPage, after);
    expect(after).toHaveBeenCalledTimes(1);
    expect(browser.current().href).toBe(HOME);
    vi.runAllTimers();
    // 目印が積み直され、「戻る」はドロワーを閉じるだけで、ゴミ箱に入ったノートの URL へは戻らない。
    expect(browser.current()).toEqual({ state: { notefableSheet: true }, href: HOME });
    browser.userBack();
    expect(closeDrawer).toHaveBeenCalledTimes(1);
    expect(browser.current().href).toBe(HOME);
  });

  it("waits for a closing drawer's in-flight history cleanup and rewrites the entry underneath", async () => {
    const browser = fakeBrowser([{ state: null, href: NOTE }]);
    const { replaceSheetUrl, useBackToClose } = await import("./use-back-to-close");
    useBackToClose(true, vi.fn());
    // ドロワーを閉じ、目印を外す history.back が走った（popstate はまだ）ところで URL を片付ける。
    cleanups.pop()!();
    vi.runOnlyPendingTimers();
    expect(browser.history.back).toHaveBeenCalledTimes(1);
    const after = vi.fn();
    replaceSheetUrl(dropPage, after);
    expect(browser.history.replaceState).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(after).toHaveBeenCalledTimes(1);
    expect(browser.stack).toEqual([{ state: null, href: HOME }, { state: { notefableSheet: true }, href: NOTE }]);
    expect(browser.current()).toEqual({ state: null, href: HOME });
  });

  it("rewrites a marker whose cleanup is only scheduled in place, like page URL sync does", async () => {
    const browser = fakeBrowser([{ state: null, href: NOTE }]);
    const { replaceSheetUrl, useBackToClose } = await import("./use-back-to-close");
    useBackToClose(true, vi.fn());
    cleanups.pop()!();
    replaceSheetUrl(dropPage);
    vi.runAllTimers();
    // 目印は書き換えで消えたので、後始末の history.back は走らない（ゴミ箱のノートの URL へ戻らない）。
    expect(browser.history.back).not.toHaveBeenCalled();
    expect(browser.current()).toEqual({ state: null, href: HOME });
  });

  it("replaces the URL in place without a marker, and skips when the URL no longer points at the note", async () => {
    const browser = fakeBrowser([{ state: null, href: NOTE }]);
    const { replaceSheetUrl } = await import("./use-back-to-close");
    replaceSheetUrl(dropPage);
    vi.runAllTimers();
    expect(browser.stack).toEqual([{ state: null, href: HOME }]);
    const after = vi.fn();
    replaceSheetUrl(dropPage, after);
    expect(browser.history.replaceState).toHaveBeenCalledTimes(1);
    expect(after).not.toHaveBeenCalled();
  });
});
