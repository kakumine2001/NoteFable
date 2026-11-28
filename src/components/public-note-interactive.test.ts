import { describe, expect, it, vi } from "vitest";
import { createHeadingRevealer, hashTargetId } from "./public-note-interactive";

const HERE = "https://notefable.com/s/token";

function fakePage(hash = "") {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const on = (type: string, listener: (event: Event) => void) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(listener);
  };
  const off = (type: string, listener: (event: Event) => void) => { listeners.get(type)?.delete(listener); };
  const elements = new Map<string, { scrollIntoView: ReturnType<typeof vi.fn> }>();
  const location = { hash, get href() { return `${HERE}${location.hash}`; } };
  const win = { location, addEventListener: on, removeEventListener: off } as unknown as Parameters<typeof createHeadingRevealer>[0];
  const doc = {
    addEventListener: on, removeEventListener: off,
    getElementById: (id: string) => elements.get(id) ?? null,
  } as unknown as Parameters<typeof createHeadingRevealer>[1];
  const fire = (type: string, event: Partial<MouseEvent> = {}) => { for (const listener of listeners.get(type) ?? []) listener({ type, button: 0, ...event } as Event); };
  const link = (href: string, target: string | null = null) =>
    ({ closest: () => ({ getAttribute: (name: string) => name === "href" ? href : name === "target" ? target : null }) }) as unknown as EventTarget;
  const show = (id: string) => { const element = { scrollIntoView: vi.fn() }; elements.set(id, element); return element; };
  return { win, doc, location, fire, link, show, listeners };
}

describe("public note heading links into closed toggles", () => {
  it("reads in-page hashes only", () => {
    expect(hashTargetId("#heading-a", HERE)).toBe("heading-a");
    expect(hashTargetId("#heading-%E8%A6%8B", HERE)).toBe("heading-見");
    expect(hashTargetId(`${HERE}#heading-a`, HERE)).toBe("heading-a");
    expect(hashTargetId("/s/other#heading-a", HERE)).toBeNull();
    expect(hashTargetId("https://example.com/s/token#heading-a", HERE)).toBeNull();
    expect(hashTargetId("#", HERE)).toBeNull();
    expect(hashTargetId(null, HERE)).toBeNull();
  });

  it("opens nested toggles down to a heading named in the URL on load, scrolls there once, then stops", () => {
    const page = fakePage("#heading-deep");
    const revealer = createHeadingRevealer(page.win, page.doc);
    const outer = vi.fn();
    revealer.subscribe(["heading-mid", "heading-deep"], outer);
    expect(outer).toHaveBeenCalledWith("heading-deep");
    // 外側が開いて描いた内側のトグルが登録すると、続けて開く。
    revealer.scrollTo("heading-deep");
    const inner = vi.fn();
    const stopInner = revealer.subscribe(["heading-deep"], inner);
    expect(inner).toHaveBeenCalledWith("heading-deep");
    const heading = page.show("heading-deep");
    revealer.scrollTo("heading-deep");
    expect(heading.scrollIntoView).toHaveBeenCalledTimes(1);
    // 果たした後に手で閉じて開き直しても、勝手に開かない。
    stopInner();
    const reopened = vi.fn();
    revealer.subscribe(["heading-deep"], reopened);
    expect(reopened).not.toHaveBeenCalled();
  });

  it("opens on TOC clicks (even for the current hash) and hash changes, but leaves visible headings and other toggles alone", () => {
    const page = fakePage("#heading-a");
    const revealer = createHeadingRevealer(page.win, page.doc);
    const first = vi.fn();
    const second = vi.fn();
    revealer.subscribe(["heading-a"], first);
    revealer.subscribe(["heading-b"], second);
    expect(first).toHaveBeenCalledTimes(1);
    // 同じハッシュをもう一度押した（hashchange は来ない）。
    page.fire("click", { target: page.link("#heading-a") });
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).not.toHaveBeenCalled();
    page.location.hash = "#heading-b";
    page.fire("hashchange");
    expect(second).toHaveBeenCalledWith("heading-b");
    // 新しいタブで開く操作や、画面に出ている見出しへのリンクはブラウザに任せる。
    page.fire("click", { target: page.link("#heading-a"), ctrlKey: true });
    page.fire("click", { target: page.link("#heading-a", "_blank") });
    expect(first).toHaveBeenCalledTimes(2);
    page.fire("click", { target: page.link("#heading-a", "_self") });
    expect(first).toHaveBeenCalledTimes(3);
    page.show("heading-a");
    page.fire("click", { target: page.link("#heading-a") });
    expect(first).toHaveBeenCalledTimes(3);
  });

  it("does not carry an unfulfilled request over to the next page or past a visible heading", () => {
    const page = fakePage("#heading-gone");
    const revealer = createHeadingRevealer(page.win, page.doc);
    const stop = revealer.subscribe(["heading-x"], vi.fn());
    // 指定は果たされないまま、トグルが全部無くなった（別の公開ページへ移った）。
    stop();
    page.location.hash = "";
    const next = vi.fn();
    revealer.subscribe(["heading-gone"], next);
    expect(next).not.toHaveBeenCalled();

    // 見えている見出しへのリンクを押したら、前の指定は消える。
    const other = fakePage();
    const second = createHeadingRevealer(other.win, other.doc);
    second.subscribe(["heading-a"], vi.fn());
    other.fire("click", { target: other.link("#heading-hidden") });
    other.show("heading-seen");
    other.fire("click", { target: other.link("#heading-seen") });
    const late = vi.fn();
    second.subscribe(["heading-hidden"], late);
    expect(late).not.toHaveBeenCalled();
  });

  it("stops listening when the last toggle goes away", () => {
    const page = fakePage();
    const revealer = createHeadingRevealer(page.win, page.doc);
    const stop = revealer.subscribe(["heading-a"], vi.fn());
    expect(page.listeners.get("hashchange")?.size).toBe(1);
    stop();
    expect(page.listeners.get("hashchange")?.size).toBe(0);
    expect(page.listeners.get("click")?.size).toBe(0);
  });
});
