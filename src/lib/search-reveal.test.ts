import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatMessageSelector, noteBlockSelector, REVEAL_CLASS, revealChatMessage, revealNoteBlock, takeCanvasReveal } from "./search-reveal";

// node 環境には DOM が無いので、このモジュールが使う分だけの偽物を用意する。
class FakeElement {
  classes = new Set<string>();
  offsetWidth = 0;
  scrollIntoView = vi.fn();
  inner: FakeElement | null = null;
  classList = { add: (name: string) => this.classes.add(name), remove: (name: string) => this.classes.delete(name), contains: (name: string) => this.classes.has(name) };
  querySelector = vi.fn((selector: string) => (selector.includes(".bn-block-content") ? this.inner : null));
  get flashing() { return this.classes.has(REVEAL_CLASS); }
}

const observers: FakeObserver[] = [];
class FakeObserver {
  disconnect = vi.fn();
  observe = vi.fn();
  constructor(public callback: () => void) { observers.push(this); }
}

const page = new Map<string, FakeElement>();
let reduced = false;

beforeEach(() => {
  vi.useFakeTimers();
  page.clear();
  observers.length = 0;
  reduced = false;
  vi.stubGlobal("document", { body: {}, querySelector: (selector: string) => page.get(selector) ?? null });
  vi.stubGlobal("window", { matchMedia: (query: string) => ({ matches: reduced && query.includes("reduce") }) });
  vi.stubGlobal("MutationObserver", FakeObserver);
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 16) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("selectors", () => {
  it("targets the BlockNote block wrapper by its data-id and escapes quotes", () => {
    expect(noteBlockSelector("abc-123")).toBe('.notes-block-editor .bn-block-outer[data-id="abc-123"]');
    expect(noteBlockSelector('a"]x\\')).toBe('.notes-block-editor .bn-block-outer[data-id="a\\"]x\\\\"]');
    expect(chatMessageSelector("m1")).toBe('[data-message-id="m1"]');
  });
});

describe("revealChatMessage", () => {
  it("scrolls an existing message to the centre and flashes it for about two seconds", async () => {
    const message = new FakeElement();
    page.set(chatMessageSelector("m1"), message);
    const result = revealChatMessage("m1");
    // 自動スクロールなどが落ち着くよう、2 フレーム待ってから動かす。
    await vi.advanceTimersByTimeAsync(10);
    expect(message.scrollIntoView).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(40);
    expect(await result).toBe(true);
    expect(message.scrollIntoView).toHaveBeenCalledWith({ block: "center", inline: "nearest", behavior: "smooth" });
    expect(message.flashing).toBe(true);
    await vi.advanceTimersByTimeAsync(1900);
    expect(message.flashing).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(message.flashing).toBe(false);
  });

  it("does not scroll smoothly when the user prefers reduced motion", async () => {
    reduced = true;
    const message = new FakeElement();
    page.set(chatMessageSelector("m1"), message);
    const result = revealChatMessage("m1");
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toBe(true);
    expect(message.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
  });

  it("waits for the message to be rendered and stops observing once found", async () => {
    const result = revealChatMessage("m1");
    expect(observers).toHaveLength(1);
    expect(observers[0].observe).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ childList: true, subtree: true }));
    await vi.advanceTimersByTimeAsync(1500);
    const message = new FakeElement();
    page.set(chatMessageSelector("m1"), message);
    observers[0].callback();
    expect(observers[0].disconnect).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toBe(true);
    expect(message.scrollIntoView).toHaveBeenCalledOnce();
    // 見つかったあとに待ち時間が過ぎても何も起きない。
    await vi.advanceTimersByTimeAsync(5000);
    expect(message.scrollIntoView).toHaveBeenCalledOnce();
  });

  it("gives up after about four seconds and cleans up", async () => {
    const result = revealChatMessage("missing");
    await vi.advanceTimersByTimeAsync(3900);
    expect(observers[0].disconnect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(await result).toBe(false);
    expect(observers[0].disconnect).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops when aborted, before or while waiting", async () => {
    const controller = new AbortController();
    const waiting = revealChatMessage("missing", { signal: controller.signal });
    controller.abort();
    expect(await waiting).toBe(false);
    expect(observers[0].disconnect).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(await revealChatMessage("missing", { signal: controller.signal })).toBe(false);
    expect(observers).toHaveLength(1);
  });

  it("moves the flash when another message is revealed", async () => {
    const first = new FakeElement();
    const second = new FakeElement();
    page.set(chatMessageSelector("m1"), first);
    page.set(chatMessageSelector("m2"), second);
    const one = revealChatMessage("m1");
    await vi.advanceTimersByTimeAsync(50);
    await one;
    const two = revealChatMessage("m2");
    await vi.advanceTimersByTimeAsync(50);
    await two;
    expect(first.flashing).toBe(false);
    expect(second.flashing).toBe(true);
  });
});

describe("takeCanvasReveal", () => {
  it("hands a slide editor that opens later the request it missed, once", async () => {
    const controller = new AbortController();
    void revealNoteBlock("slide-7", { signal: controller.signal });
    controller.abort();
    expect(takeCanvasReveal((id) => id === "other")).toBeNull();
    expect(takeCanvasReveal((id) => id === "slide-7")).toBe("slide-7");
    expect(takeCanvasReveal(() => true)).toBeNull();
  });

  it("forgets a request after the wait", async () => {
    const controller = new AbortController();
    void revealNoteBlock("slide-8", { signal: controller.signal });
    controller.abort();
    await vi.advanceTimersByTimeAsync(5000);
    expect(takeCanvasReveal(() => true)).toBeNull();
  });
});

describe("revealNoteBlock", () => {
  it("flashes the block's own content, not its nested children", async () => {
    const outer = new FakeElement();
    outer.inner = new FakeElement();
    page.set(noteBlockSelector("b1"), outer);
    const result = revealNoteBlock("b1");
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toBe(true);
    expect(outer.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "center" }));
    expect(outer.inner.flashing).toBe(true);
    expect(outer.flashing).toBe(false);
  });

  it("falls back to the wrapper when the content element is missing", async () => {
    const outer = new FakeElement();
    page.set(noteBlockSelector("b1"), outer);
    const result = revealNoteBlock("b1");
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toBe(true);
    expect(outer.flashing).toBe(true);
  });

  it("uses the element that exists when the frames have passed if it was re-created meanwhile", async () => {
    const stale = new FakeElement();
    page.set(noteBlockSelector("b1"), stale);
    const result = revealNoteBlock("b1");
    const fresh = new FakeElement();
    page.set(noteBlockSelector("b1"), fresh);
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toBe(true);
    expect(stale.scrollIntoView).not.toHaveBeenCalled();
    expect(fresh.scrollIntoView).toHaveBeenCalledOnce();
  });
});
