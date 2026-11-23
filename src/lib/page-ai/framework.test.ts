import { beforeEach, describe, expect, it, vi } from "vitest";

// AI 操控底座の枠組み（ツールの定義・実行の振り分け・予覧・アダプターの表）を、テスト用の偽アダプター（スライド）で確かめる。
const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), canvas: vi.fn(), createProposal: vi.fn(), apply: vi.fn(), view: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  databaseSchema: "notefable",
  prisma: { notePage: { findFirst: mocks.findFirst }, noteCanvas: { findFirst: mocks.canvas }, noteProposal: { create: mocks.createProposal } },
}));
vi.mock("@/lib/note-embeddings", () => ({ AI_SEMANTIC_THRESHOLD: 0.32, scheduleNoteEmbeddingBackfill: vi.fn(), scheduleNoteEmbeddingSync: vi.fn(), semanticSearchNotes: vi.fn() }));
vi.mock("@/lib/page-ai/proposals", async (load) => ({ ...await load<object>(), applyProposal: mocks.apply, proposalView: mocks.view }));
vi.mock("@/lib/page-ai/registry", async () => {
  const { noteAdapter } = await import("./note-adapter");
  const { canvasTextAdapter } = await import("./canvas-adapter");
  const { fakeSlidesAdapter } = await import("./fake-adapter");
  const adapters = { note: noteAdapter, whiteboard: canvasTextAdapter("whiteboard"), slides: fakeSlidesAdapter() };
  return { PAGE_ADAPTERS: adapters, adapterFor: (kind: keyof typeof adapters) => adapters[kind], allAdapters: () => Object.values(adapters) };
});

import { FAKE_PNG_BASE64 } from "./fake-adapter";
import { pageToolDefinitions, runPageTool } from "./tools";

const ctx = { userId: "mine", sessionId: "s1", excludeMessageIds: [] };
const updatedAt = new Date("2026-11-20T00:00:00Z");
const deck = { slides: [{ id: "s1", elements: [{ id: "s1-title", type: "text", text: "Intro" }] }, { id: "s2", elements: [{ id: "s2-title", type: "text", text: "End" }] }] };

describe("AI harness framework with a fake slides adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue({ id: "deck", kind: "slides", title: "Deck", icon: null, version: 2, blocks: [], updatedAt, canvas: { segments: [] } });
    mocks.canvas.mockResolvedValue({ data: deck });
    mocks.createProposal.mockImplementation(async ({ data }: { data: { kind: string; pageKind: string; payload: unknown } }) => ({
      id: "prop1", kind: data.kind, status: "PENDING", pageKind: data.pageKind, payload: data.payload, appliedPageId: null, autoApplied: false, appliedVersion: null, revisionId: null,
    }));
  });

  it("defines every tool once: the shared ones, then each adapter's edit and create tools, and the preview tool only for vision models", () => {
    const names = (vision: boolean) => pageToolDefinitions({ vision }).map((tool) => tool.name);
    expect(names(false)).toEqual(["search_notes", "list_pages", "read_note", "list_chat_attachments", "propose_note_edit", "propose_fake_slides_edit", "propose_note_create", "propose_fake_slides_create"]);
    expect(names(true)).toEqual([...names(false), "preview_page"]);
    for (const tool of pageToolDefinitions({ vision: true })) {
      expect(tool.parameters).toMatchObject({ type: "object", additionalProperties: false });
      // OpenAI の strict モード：すべての項目を required に並べる。
      expect(Object.keys((tool.parameters as { properties: object }).properties).sort()).toEqual([...(tool.parameters as { required: string[] }).required].sort());
    }
  });

  it("reads a page through its kind's adapter", async () => {
    const result = await runPageTool("read_note", { noteId: "deck" }, ctx);
    expect(result.content).toContain("kind: slides\nversion: 2");
    expect(result.content).toContain("Slide 1 (id: s1): Intro\nSlide 2 (id: s2): End");
  });

  it("turns an adapter's ops into a stored proposal for that kind, with version checks done by the framework", async () => {
    const result = await runPageTool("propose_fake_slides_edit", { noteId: "deck", version: 2, ops: [{ op: "set_title", slideId: "s2", text: "Thanks" }] }, ctx);
    expect(result.isError).toBeUndefined();
    const saved = mocks.createProposal.mock.calls[0][0].data as { pageKind: string; payload: { proposed: { data: typeof deck }; images: unknown[] } };
    expect(saved.pageKind).toBe("slides");
    expect(saved.payload.proposed.data.slides[1].elements[0].text).toBe("Thanks");
    expect(saved.payload.images).toHaveLength(1);
    const [event] = result.events as { type: string; pageKind: string; changes: { target: unknown; before: string; after: string; afterImage: string }[] }[];
    expect(event).toMatchObject({ type: "notefable.proposal", pageKind: "slides", changes: [{ op: "update", target: { type: "slide", number: 2 }, before: "End", after: "Thanks" }] });
    expect(event.changes[0].afterImage).toBe("/api/proposals/prop1/image?change=0&side=after");
    expect(JSON.stringify(result.events)).not.toContain(FAKE_PNG_BASE64);

    expect(await runPageTool("propose_fake_slides_edit", { noteId: "deck", version: 1, ops: [{ op: "add_slide", text: "x" }] }, ctx)).toMatchObject({ isError: true, content: expect.stringContaining("version 2") });
    expect(await runPageTool("propose_fake_slides_edit", { noteId: "deck", version: 2, ops: [{ op: "set_title", slideId: "nope", text: "x" }] }, ctx)).toMatchObject({ isError: true, content: "Slide nope not found." });
  });

  it("points the model at the right tool for the page's kind", async () => {
    const wrong = await runPageTool("propose_note_edit", { noteId: "deck", version: 2, title: null, edits: [] }, ctx);
    expect(wrong).toMatchObject({ isError: true, content: expect.stringContaining("Use propose_fake_slides_edit.") });
    mocks.findFirst.mockResolvedValue({ id: "n1", kind: "note", title: "N", icon: null, version: 1, blocks: [], updatedAt, canvas: null });
    expect(await runPageTool("propose_fake_slides_edit", { noteId: "n1", version: 1, ops: [] }, ctx)).toMatchObject({ isError: true, content: expect.stringContaining("not a slide deck") });
  });

  it("creates pages directly when the adapter says so, without asking for auto-apply", async () => {
    mocks.apply.mockResolvedValue({ ok: true, status: "applied", kind: "create", page: { id: "new" } });
    mocks.view.mockResolvedValue({ kind: "create_proposal", id: "prop1", status: "applied", autoApplied: true, appliedPageId: "new" });
    const result = await runPageTool("propose_fake_slides_create", { title: "Plan", slides: ["A", "B"] }, ctx);
    expect(mocks.apply).toHaveBeenCalledWith("mine", "prop1", { auto: true });
    expect(result.label).toBe("Created page “Plan”");
    expect(JSON.parse(result.content)).toMatchObject({ status: "applied", applied: true });
    expect(mocks.createProposal.mock.calls[0][0].data).toMatchObject({ kind: "CREATE", pageKind: "slides" });
  });

  it("returns a preview image to vision models only", async () => {
    const seen = await runPageTool("preview_page", { noteId: "deck", slideId: "s1", elementIds: [] }, { ...ctx, vision: true });
    expect(seen).toMatchObject({ label: "Previewed “Deck”", images: [{ mimeType: "image/png", base64: FAKE_PNG_BASE64 }] });
    expect(await runPageTool("preview_page", { noteId: "deck", slideId: "s1", elementIds: [] }, ctx)).toMatchObject({ isError: true });
    expect(await runPageTool("preview_page", { noteId: "deck", slideId: "missing", elementIds: [] }, { ...ctx, vision: true })).toMatchObject({ isError: true });
    mocks.findFirst.mockResolvedValue({ id: "w1", kind: "whiteboard", title: "Board", icon: null, version: 1, blocks: [], updatedAt, canvas: { segments: [] } });
    expect(await runPageTool("preview_page", { noteId: "w1", slideId: null, elementIds: [] }, { ...ctx, vision: true })).toMatchObject({ isError: true, content: expect.stringContaining("not available") });
  });
});
