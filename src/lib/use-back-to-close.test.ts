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
const MARKER = { notefableSheet: true };
const dropPage = (url: URL) => {
  if (url.searchParams.get("page") !== "x") return false;
  url.searchParams.delete("page");
  return true;
};
// Notes のホームからノート x を開いたところ（[ホーム, x]）。
const opened = () => fakeBrowser([{ state: null, href: HOME }, { state: null, href: NOTE }]);

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

  it("rewrites the note entry under a confirm dialog's marker, so Back after closing never reaches the trashed note", async () => {
    const browser = opened();
    const { replaceSheetUrl, useBackToClose } = await import("./use-back-to-close");
    useBackToClose(true, vi.fn());
    expect(browser.stack).toEqual([{ state: null, href: HOME }, { state: null, href: NOTE }, { state: MARKER, href: NOTE }]);

    const after = vi.fn();
    replaceSheetUrl(dropPage, after);
    // ゴミ箱へ移せたので確認の小窓が閉じる（目印を退ける history.back は replaceSheetUrl がもう始めている）。
    cleanups.pop()!();
    vi.runAllTimers();
    expect(browser.history.back).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
    // 退けた目印（「進む」の先）も書き換え済み。どこにもゴミ箱のノートの URL は残らない。
    expect(browser.stack).toEqual([{ state: null, href: HOME }, { state: null, href: HOME }, { state: MARKER, href: HOME }]);
    expect(browser.current()).toEqual({ state: null, href: HOME });
  });

  it("keeps an open drawer's marker on top of the rewritten entry", async () => {
    const browser = opened();
    const { replaceSheetUrl, useBackToClose } = await import("./use-back-to-close");
    const closeDrawer = vi.fn();
    useBackToClose(true, closeDrawer);

    replaceSheetUrl(dropPage);
    vi.runAllTimers();
    expect(browser.stack).toEqual([{ state: null, href: HOME }, { state: null, href: HOME }, { state: MARKER, href: HOME }]);
    expect(browser.current()).toEqual({ state: MARKER, href: HOME });
    expect(closeDrawer).not.toHaveBeenCalled();
    // 「戻る」はドロワーを閉じるだけ。
    browser.userBack();
    expect(closeDrawer).toHaveBeenCalledTimes(1);
    expect(browser.current()).toEqual({ state: null, href: HOME });
  });

  it("takes over a closed drawer's scheduled cleanup and rewrites the entry underneath", async () => {
    const browser = opened();
    const { replaceSheetUrl, useBackToClose } = await import("./use-back-to-close");
    useBackToClose(true, vi.fn());
    // ドロワーを閉じた（目印を外す history.back が予約された）直後に URL を片付ける。
    cleanups.pop()!();
    const after = vi.fn();
    replaceSheetUrl(dropPage, after);
    vi.runAllTimers();
    expect(browser.history.back).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
    expect(browser.stack).toEqual([{ state: null, href: HOME }, { state: null, href: HOME }, { state: MARKER, href: HOME }]);
    expect(browser.current()).toEqual({ state: null, href: HOME });
  });

  it("waits for an in-flight cleanup back and rewrites the entry it lands on", async () => {
    const browser = opened();
    const { replaceSheetUrl, useBackToClose } = await import("./use-back-to-close");
    useBackToClose(true, vi.fn());
    cleanups.pop()!();
    // 後始末の history.back が走った（popstate はまだ）。
    vi.runOnlyPendingTimers();
    expect(browser.history.back).toHaveBeenCalledTimes(1);
    const after = vi.fn();
    replaceSheetUrl(dropPage, after);
    expect(browser.history.replaceState).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(browser.history.back).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
    // 進行中の history.back がもう目印を離れたので、「進む」の先の目印だけは書き換えられない。
    expect(browser.stack).toEqual([{ state: null, href: HOME }, { state: null, href: HOME }, { state: MARKER, href: NOTE }]);
    expect(browser.current()).toEqual({ state: null, href: HOME });
  });

  it("does not move history when the URL does not need rewriting", async () => {
    const browser = fakeBrowser([{ state: null, href: HOME }]);
    const { replaceSheetUrl, useBackToClose } = await import("./use-back-to-close");
    useBackToClose(true, vi.fn());
    const after = vi.fn();
    replaceSheetUrl(dropPage, after);
    vi.runAllTimers();
    expect(browser.history.back).not.toHaveBeenCalled();
    expect(browser.history.replaceState).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(browser.stack).toEqual([{ state: null, href: HOME }, { state: MARKER, href: HOME }]);
  });

  it("replaces the URL in place when no sheet is open", async () => {
    const browser = opened();
    const { replaceSheetUrl } = await import("./use-back-to-close");
    const after = vi.fn();
    replaceSheetUrl(dropPage, after);
    expect(after).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(browser.history.back).not.toHaveBeenCalled();
    expect(browser.stack).toEqual([{ state: null, href: HOME }, { state: null, href: HOME }]);
  });
});
