import { describe, expect, it, vi } from "vitest";
import { BACKLINKS_STALE_EVENT, dispatchBacklinksStale, extractCanvasLinks, MAX_CANVAS_LINKS, parseNoteBacklinks } from "@/lib/note-backlinks";

const pageLink = "/app?view=pages&page=target";
const element = (overrides: Record<string, unknown>) => ({ id: "e", type: "rectangle", ...overrides });
const slideText = (...marks: unknown[]) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "go", marks }] }] });

describe("extractCanvasLinks", () => {
  it("collects whiteboard element links and page cards, once each", () => {
    expect(extractCanvasLinks("whiteboard", { elements: [
      element({ id: "a", link: pageLink }),
      element({ id: "b", type: "text", link: "https://app.notefable.com/?view=pages&page=other" }),
      element({ id: "c", link: pageLink }),
      element({ id: "d", link: null, customData: { notefablePage: { id: "card", kind: "note" } } }),
    ] })).toEqual([pageLink, "https://app.notefable.com/?view=pages&page=other", "/app?view=pages&page=card"]);
  });

  it("skips deleted and unsupported elements, ordinary links and broken input", () => {
    expect(extractCanvasLinks("whiteboard", { elements: [
      element({ isDeleted: true, link: pageLink }),
      element({ type: "iframe", link: pageLink }),
      element({ link: "https://example.com/docs" }),
      element({ customData: { notefablePage: { id: "a b" } } }),
    ] })).toEqual([]);
    expect(extractCanvasLinks("whiteboard", null)).toEqual([]);
    expect(extractCanvasLinks("slides", { slides: "nope" })).toEqual([]);
  });

  it("collects slide text links, including inside lists, but not the whiteboard still's source page", () => {
    expect(extractCanvasLinks("slides", { slides: [
      { id: "s1", elements: [
        { id: "t1", type: "text", doc: slideText({ type: "link", attrs: { href: "https://app.notefable.com/?view=pages&page=one" } }) },
        { id: "t2", type: "text", doc: { type: "doc", content: [{ type: "bullet_list", content: [{ type: "list_item", content: [
          { type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "strong" }, { type: "link", attrs: { href: pageLink } }] }] },
        ] }] }] } },
        { id: "w", type: "whiteboard", pageId: "source" },
        { id: "l", type: "text", doc: slideText({ type: "link", attrs: { href: "mailto:a@b.c" } }) },
      ] },
    ] })).toEqual(["https://app.notefable.com/?view=pages&page=one", pageLink]);
  });

  it("keeps the column small", () => {
    const elements = Array.from({ length: MAX_CANVAS_LINKS + 5 }, (_, index) => element({ id: `e${index}`, link: `/app?view=pages&page=p${index}` }));
    expect(extractCanvasLinks("whiteboard", { elements })).toHaveLength(MAX_CANVAS_LINKS);
    expect(extractCanvasLinks("whiteboard", { elements: [element({ link: `/app?view=pages&page=x&q=${"y".repeat(3000)}` })] })).toEqual([]);
  });
});

describe("dispatchBacklinksStale", () => {
  it("announces which page changed", () => {
    const events: Event[] = [];
    vi.stubGlobal("window", { dispatchEvent: (event: Event) => { events.push(event); return true; } });
    dispatchBacklinksStale("p1");
    dispatchBacklinksStale();
    expect(events.map((event) => [event.type, (event as CustomEvent<{ pageId?: string }>).detail.pageId])).toEqual([
      [BACKLINKS_STALE_EVENT, "p1"], [BACKLINKS_STALE_EVENT, undefined],
    ]);
    vi.unstubAllGlobals();
  });
});

describe("parseNoteBacklinks", () => {
  it("keeps well-formed entries and drops broken ones", () => {
    expect(parseNoteBacklinks({
      pages: [{ id: "p1", kind: "note", title: "One", icon: null }, { id: 2, title: "bad", icon: null }],
      chats: [{ id: "c1", title: "Chat", icon: "💬", messageId: "m1" }, { id: "c2", title: "No message", icon: null, messageId: null }, { id: "c3", title: "bad" }],
    })).toEqual({
      pages: [{ id: "p1", kind: "note", title: "One", icon: null }],
      chats: [{ id: "c1", title: "Chat", icon: "💬", messageId: "m1" }, { id: "c2", title: "No message", icon: null, messageId: null }],
    });
    expect(parseNoteBacklinks({ pages: [] })).toBeNull();
    expect(parseNoteBacklinks("nope")).toBeNull();
  });
});
