import { describe, expect, it } from "vitest";
import { parseNoteBacklinks, whiteboardLinksTo } from "@/lib/note-backlinks";

const origin = "https://app.notefable.com";

describe("whiteboardLinksTo", () => {
  it("finds element links (relative or same-origin absolute) and page cards", () => {
    expect(whiteboardLinksTo({ elements: [{ id: "e", type: "rectangle", link: "/app?view=pages&page=target" }] }, "target", origin)).toBe(true);
    expect(whiteboardLinksTo({ elements: [{ id: "e", type: "text", link: `${origin}/?view=pages&page=target` }] }, "target", origin)).toBe(true);
    expect(whiteboardLinksTo({ elements: [{ id: "e", type: "rectangle", link: null, customData: { notefablePage: { id: "target", kind: "note" } } }] }, "target", origin)).toBe(true);
  });

  it("ignores deleted elements, unsupported types, other origins and other pages", () => {
    expect(whiteboardLinksTo({ elements: [{ id: "e", type: "rectangle", isDeleted: true, link: "/app?view=pages&page=target" }] }, "target", origin)).toBe(false);
    expect(whiteboardLinksTo({ elements: [{ id: "e", type: "iframe", link: "/app?view=pages&page=target" }] }, "target", origin)).toBe(false);
    expect(whiteboardLinksTo({ elements: [{ id: "e", type: "text", link: "https://evil.example/?view=pages&page=target" }] }, "target", origin)).toBe(false);
    expect(whiteboardLinksTo({ elements: [{ id: "e", type: "text", link: "/app?view=pages&page=target2" }] }, "target", origin)).toBe(false);
    expect(whiteboardLinksTo({ elements: [{ id: "e", type: "text", link: "/app?view=pages&page=other" }] }, "target", origin)).toBe(false);
  });

  it("rejects ids that cannot be page ids and tolerates broken input", () => {
    expect(whiteboardLinksTo({ elements: [{ id: "e", type: "rectangle", customData: { notefablePage: { id: "a b" } } }] }, "a b", origin)).toBe(false);
    expect(whiteboardLinksTo(null, "target", origin)).toBe(false);
    expect(whiteboardLinksTo({ elements: "nope" }, "target", origin)).toBe(false);
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
