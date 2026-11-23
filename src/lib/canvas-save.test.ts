import { describe, expect, it, vi } from "vitest";
import { canvasSaveBody, canvasSavedPage, creatablePageKinds, newPageBody, parseCanvasDraft } from "./canvas-save";
import { NoteSaveQueue } from "./note-save-queue";
import { PAGE_KIND_FEATURES } from "./page-kinds";
import type { NotePage } from "@/types/notes";

const deck = { slides: [{ id: "s1", elements: [{ id: "e1", text: "Hello" }] }] };
const page: NotePage = {
  id: "deck", kind: "slides", title: "Deck", icon: null, cover: null, coverPosition: null, blocks: [], data: deck,
  version: 3, groupId: null, createdAt: "2026-11-23", updatedAt: "2026-11-23",
};

describe("canvas save body", () => {
  it("sends the body only when it changed since the last save", () => {
    expect(canvasSaveBody({ title: "Deck", icon: null, data: deck }, 3, deck)).toEqual({ title: "Deck", icon: null, version: 3 });
    const edited = { slides: [] };
    expect(canvasSaveBody({ title: "Deck", icon: "🎯", data: edited }, 3, deck)).toEqual({ title: "Deck", icon: "🎯", data: edited, version: 3 });
    // Nothing loaded yet (no body known): never invent one.
    expect(canvasSaveBody({ title: "Deck", icon: null }, 0, undefined)).toEqual({ title: "Deck", icon: null, version: 0 });
  });

  it("rebuilds the saved page from the summary and the body that was sent", () => {
    const edited = { slides: [] };
    const summary = { id: "deck", kind: "slides" as const, title: "Renamed", icon: null, version: 4, groupId: null, createdAt: "x", updatedAt: "y" };
    const saved = canvasSavedPage(page, { version: 4, page: summary }, { data: edited }, deck);
    expect(saved).toMatchObject({ title: "Renamed", version: 4, data: edited, blocks: [], cover: null });
    // Title-only save keeps the previous body.
    expect(canvasSavedPage(page, { version: 4, page: summary }, { data: deck }, deck).data).toBe(deck);
  });
});

describe("canvas drafts", () => {
  it("restores a valid draft and drops broken or unsavable ones", () => {
    const draft = JSON.stringify({ title: "Draft", icon: "🎯", data: deck, version: 3, blocks: [], cover: null, coverPosition: null });
    expect(parseCanvasDraft("slides", draft, page)).toMatchObject({ title: "Draft", icon: "🎯", data: deck, version: 3, blocks: [] });
    expect(parseCanvasDraft("slides", "{", page)).toBeUndefined();
    expect(parseCanvasDraft("slides", JSON.stringify({ title: "x", data: deck }), page)).toBeUndefined();
    // A whiteboard body is not a slide deck.
    expect(parseCanvasDraft("slides", JSON.stringify({ title: "x", data: { elements: [] }, version: 1 }), page)).toBeUndefined();
    // Embedded images are never saved, so such a draft would fail forever.
    const embedded = { slides: [{ id: "s1", elements: [{ id: "i", src: "data:image/png;base64,AAAA" }] }] };
    expect(parseCanvasDraft("slides", JSON.stringify({ title: "x", data: embedded, version: 1 }), page)).toBeUndefined();
    // An unknown icon value falls back to the saved icon.
    expect(parseCanvasDraft("slides", JSON.stringify({ title: "x", icon: "<b>", data: deck, version: 1 }), { icon: "🙂" })?.icon).toBe("🙂");
  });
});

describe("new page body", () => {
  it("creates notes as before and canvases with their kind", () => {
    const content = { title: "Untitled", icon: null, cover: null, coverPosition: null, blocks: [] };
    expect(newPageBody("note", content, null)).toEqual(content);
    expect(newPageBody("note", content, "parent")).toEqual({ ...content, parentId: "parent" });
    expect(newPageBody("slides", content, null)).toEqual({ kind: "slides", title: "Untitled", icon: null });
    expect(newPageBody("slides", { ...content, data: deck }, "p")).toEqual({ kind: "slides", title: "Untitled", icon: null, data: deck, parentId: "p" });
  });

  it("offers only kinds that have an editor, notes first", () => {
    const kinds = creatablePageKinds();
    expect(kinds[0]).toBe("note");
    expect(kinds.every((kind) => PAGE_KIND_FEATURES[kind].editor)).toBe(true);
  });
});

describe("autosave queue with a canvas body", () => {
  it("keeps the body in the queue content and acknowledges the saved version", async () => {
    const edited = { slides: [] };
    const save = vi.fn(async (content: { data?: unknown }, version: number) => ({ ...page, data: content.data as Record<string, unknown>, version: version + 1 }));
    const queue = new NoteSaveQueue(page, save, () => {});
    expect(queue.content.data).toBe(deck);
    queue.edit({ ...queue.content, data: edited });
    expect(await queue.flush()).toBe(true);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ data: edited }), 3);
    expect(queue.content.data).toBe(edited);
    expect(queue.version).toBe(4);
    expect(queue.page.data).toBe(edited);
  });
});
