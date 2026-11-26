import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UNSAVED_NOTE } from "./draw-diagram-jobs";
import { readSlidesDraft } from "./slides-wizard-draft";
import {
  closeSlidesWizard, dismissSlidesError, getSlidesJobState, getSlidesWizard, hideSlidesWizard, isSlidesWizardBusy, openSlidesWizard, requestSlides,
  resetSlidesWizard, retrySlidesWizardLoad, setSlidesPicker, SLIDES_FAILED, slidesWizardBack, startOverSlides, subscribeSlidesWizard, syncSlidesNotes,
  updateSlidesDraft,
} from "./slides-wizard-jobs";

const NOTE = "cnote000000000000000000001";
const OTHER = "cnote000000000000000000002";
const PAGE = { id: "cslides000000000000000001", kind: "slides", title: "Vaccines", icon: null, version: 1, groupId: null, parentId: null };
const OUTLINE = { title: "Vaccines", slides: [{ title: "How they work", points: ["Antibodies"] }] };

class MemoryStorage {
  items = new Map<string, string>();
  get length() { return this.items.size; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
}

type Deferred = { resolve: (response: Response) => void; reject: (error: unknown) => void };
let pending: Deferred[] = [];
let scope = "scope-a";
let scopeStatus = 200;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
// scope の GET はすぐ返し、POST は保留してテストが返す。
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>((url, init) => (init?.method === "POST"
  ? new Promise<Response>((resolve, reject) => { pending.push({ resolve, reject }); })
  : Promise.resolve(json(scopeStatus, scopeStatus === 200 ? { scope } : { error: "Database is unavailable. Try again in a moment." }))));
const dispatchEvent = vi.fn();
const postMessage = vi.fn<(message: string) => void>();
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
const sent = () => posts().map(([url, init]) => ({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> }));
function ready() {
  const view = getSlidesWizard();
  if (view?.phase !== "ready") throw new Error(`not ready: ${view?.phase}`);
  return view;
}
async function open(...args: Parameters<typeof openSlidesWizard>) {
  openSlidesWizard(...args);
  await settle();
}
async function openTopic(topic = "Vaccines") {
  await open({ entry: { type: "new" }, model: "luna" });
  updateSlidesDraft((draft) => ({ ...draft, source: { ...draft.source, topic } }));
}
async function respond(status: number, body: unknown) {
  pending.at(-1)!.resolve(json(status, body));
  await settle();
}

beforeEach(() => {
  resetSlidesWizard();
  pending = [];
  scope = "scope-a";
  scopeStatus = 200;
  fetchMock.mockClear();
  dispatchEvent.mockClear();
  postMessage.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("localStorage", new MemoryStorage());
  vi.stubGlobal("window", { dispatchEvent, NoteFableNative: { postMessage } });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("slides wizard state", () => {
  it("loads the draft scope first, and can retry when it fails", async () => {
    scopeStatus = 503;
    const listener = vi.fn();
    const stop = subscribeSlidesWizard(listener);
    openSlidesWizard({ entry: { type: "new" }, model: "luna" });
    expect(getSlidesWizard()).toEqual({ key: "new", phase: "loading" });
    await settle();
    expect(getSlidesWizard()).toEqual({ key: "new", phase: "failed" });
    scopeStatus = 200;
    retrySlidesWizardLoad();
    await settle();
    expect(ready()).toMatchObject({ key: "new", job: { state: "idle" }, picker: false });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/pages/slides/outline");
    expect(listener).toHaveBeenCalled();
    stop();
  });

  it("restores the saved draft, per user", async () => {
    await openTopic("Saved topic");
    closeSlidesWizard();
    resetSlidesWizard();
    await open({ entry: { type: "new" }, model: "luna" });
    expect(ready().draft.source.topic).toBe("Saved topic");
    closeSlidesWizard();
    scope = "scope-b";
    await open({ entry: { type: "new" }, model: "luna" });
    expect(ready().draft.source.topic).toBe("");
  });

  it("closes the note picker first, then the window, and keeps the draft", async () => {
    expect(slidesWizardBack()).toBe(false);
    await openTopic();
    setSlidesPicker(true);
    expect(slidesWizardBack()).toBe(true);
    expect(ready().picker).toBe(false);
    expect(slidesWizardBack()).toBe(true);
    expect(getSlidesWizard()).toBeNull();
    await open({ entry: { type: "new" }, model: "luna" });
    expect(ready().draft.source.topic).toBe("Vaccines");
    expect(hideSlidesWizard()).toBe(true);
    expect(hideSlidesWizard()).toBe(false);
  });

  it("starts over with an empty draft", async () => {
    await openTopic();
    startOverSlides();
    expect(ready().draft.source.topic).toBe("");
    expect(readSlidesDraft("scope-a", { type: "new" })).toBeNull();
  });

  it("refreshes note titles and drops notes that are gone, keeping the entry's note", async () => {
    await open({ entry: { type: "note", pageId: NOTE }, model: "luna" });
    updateSlidesDraft((draft) => ({ ...draft, source: { ...draft.source, notes: [...draft.source.notes, { id: OTHER, title: "Old", icon: null }] } }));
    syncSlidesNotes([{ id: OTHER, title: "New title", icon: "📗" }]);
    expect(ready().draft.source.notes).toEqual([{ id: NOTE, title: "", icon: null }, { id: OTHER, title: "New title", icon: "📗" }]);
    syncSlidesNotes([{ id: NOTE, title: "Plan", icon: null }]);
    expect(ready().draft.source.notes).toEqual([{ id: NOTE, title: "Plan", icon: null }]);
  });
});

describe("slides wizard requests", () => {
  it("asks for an outline, keeps going when closed and writes it to the draft", async () => {
    await openTopic();
    void requestSlides("outline");
    expect(ready().job).toEqual({ state: "working", stage: "outline" });
    expect(isSlidesWizardBusy()).toBe(true);
    expect(getSlidesJobState("new")).toBe("working");
    // 二度押しは無視し、要求の間は直せない。
    void requestSlides("outline");
    updateSlidesDraft((draft) => ({ ...draft, source: { ...draft.source, topic: "Changed" } }));
    await settle();
    expect(sent()).toEqual([{
      url: "/api/pages/slides/outline",
      body: {
        source: { type: "topic", topic: "Vaccines" },
        options: { pageCount: "auto", tone: "auto", audience: "", language: "auto", wording: "condense", theme: { id: "simple", mode: "light" }, generateImages: false },
        model: "luna", clientRequestId: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/),
      },
    }]);
    closeSlidesWizard();
    await respond(200, { outline: OUTLINE, partial: true });
    expect(isSlidesWizardBusy()).toBe(false);
    expect(readSlidesDraft("scope-a", { type: "new" })).toMatchObject({ step: "outline", outline: OUTLINE, partial: true });
    expect(readSlidesDraft("scope-a", { type: "new" })?.request).toBeUndefined();
    await open({ entry: { type: "new" }, model: "luna" });
    expect(ready()).toMatchObject({ job: { state: "idle" }, draft: { step: "outline", outline: OUTLINE } });
  });

  it("resends the same request with the same id, and a changed or regenerated one with a new id", async () => {
    await openTopic();
    void requestSlides("outline");
    await settle();
    await respond(502, { error: "Could not generate slides. Try again." });
    expect(ready().job).toEqual({ state: "error", stage: "outline", message: SLIDES_FAILED, status: 502 });
    // 読み直し（リロード）を挟んでも同じ ID で送り直す。自動では送らない。
    resetSlidesWizard();
    await open({ entry: { type: "new" }, model: "luna" });
    expect(posts()).toHaveLength(1);
    void requestSlides("outline");
    await settle();
    pending.at(-1)!.reject(new TypeError("offline"));
    await settle();
    expect(ready().job).toMatchObject({ state: "error", message: SLIDES_FAILED, status: 0 });
    const [first, second] = sent();
    expect(second.body.clientRequestId).toBe(first.body.clientRequestId);
    void requestSlides("outline", { fresh: true });
    await settle();
    expect(sent()[2].body.clientRequestId).not.toBe(first.body.clientRequestId);
    await respond(409, { error: "This request is still running. Try again in a moment.", code: "request_in_progress" });
    expect(ready().job).toMatchObject({ message: "This request is still running. Try again in a moment.", status: 409 });
    updateSlidesDraft((draft) => ({ ...draft, options: { ...draft.options, pageCount: 8 } }));
    expect(ready().job).toEqual({ state: "idle" });
    void requestSlides("outline");
    await settle();
    expect(sent()[3].body.clientRequestId).not.toBe(sent()[2].body.clientRequestId);
  });

  it("creates the deck where it was opened from, then forgets the draft", async () => {
    await open({ entry: { type: "new", groupId: "cgroup" }, model: "luna" });
    updateSlidesDraft((draft) => ({ ...draft, step: "outline", source: { ...draft.source, topic: "Vaccines" }, outline: { title: " Vaccines ", slides: [{ title: "How", points: ["", "A"] }] } }));
    void requestSlides("deck");
    await settle();
    expect(sent()[0]).toMatchObject({
      url: "/api/pages/slides/deck",
      body: { groupId: "cgroup", outline: { title: "Vaccines", slides: [{ title: "How", points: ["A"] }] } },
    });
    expect(sent()[0].body).not.toHaveProperty("parentId");
    await respond(201, { page: PAGE, partial: true });
    expect(ready().job).toEqual({ state: "done", page: PAGE, partial: true });
    expect(readSlidesDraft("scope-a", { type: "new", groupId: "cgroup" })).toBeNull();
    const event = dispatchEvent.mock.calls[0][0] as CustomEvent;
    expect([event.type, event.detail]).toEqual(["notefable:page-created", PAGE]);
    expect(postMessage.mock.calls.map(([message]) => JSON.parse(message))).toEqual([{ type: "pagesChanged" }]);
    // 出来た結果は閉じたら忘れ、次は新しい下書き。
    closeSlidesWizard();
    await open({ entry: { type: "new", groupId: "cgroup" }, model: "luna" });
    expect(ready()).toMatchObject({ job: { state: "idle" }, draft: { step: "source", outline: null } });
  });

  it("does not send a deck with a missing title, and uses a new id after the page is gone", async () => {
    await openTopic();
    updateSlidesDraft((draft) => ({ ...draft, step: "outline", outline: { title: "T", slides: [{ title: " ", points: [] }] } }));
    await requestSlides("deck");
    expect(posts()).toHaveLength(0);
    updateSlidesDraft((draft) => ({ ...draft, outline: OUTLINE }));
    void requestSlides("deck");
    await settle();
    await respond(404, { error: "These slides were moved to the trash." });
    expect(ready().job).toMatchObject({ state: "error", stage: "deck", status: 404, message: "These slides were moved to the trash." });
    expect(readSlidesDraft("scope-a", { type: "new" })?.request).toBeUndefined();
    dismissSlidesError();
    void requestSlides("deck");
    await settle();
    expect(sent()[1].body.clientRequestId).not.toBe(sent()[0].body.clientRequestId);
  });

  it("reports the usage limit and keeps the draft", async () => {
    await openTopic();
    void requestSlides("outline");
    await settle();
    await respond(429, { error: "You've reached today's limit.", code: "usage_limit", tier: "member", kind: "chat" });
    expect(ready().job).toEqual({ state: "error", stage: "outline", message: "You've reached today's limit.", status: 429, limit: { tier: "member" } });
    expect(ready().draft.source.topic).toBe("Vaccines");
    // 閉じると失敗の表示は消える（下書きは残る）。
    closeSlidesWizard();
    await open({ entry: { type: "new" }, model: "luna" });
    expect(ready()).toMatchObject({ job: { state: "idle" }, draft: { source: { topic: "Vaccines" } } });
  });

  it("saves the open note before reading notes, and sends nothing when that fails", async () => {
    await open({ entry: { type: "note", pageId: NOTE, title: "Plan" }, model: "luna" });
    const flush = vi.fn(async () => false);
    await requestSlides("outline", { flush });
    expect(flush).toHaveBeenCalledWith([NOTE]);
    expect(posts()).toHaveLength(0);
    expect(ready().job).toEqual({ state: "error", stage: "outline", message: UNSAVED_NOTE, status: 0 });
    void requestSlides("outline", { flush: async () => true });
    await settle();
    expect(sent()[0].body.source).toEqual({ type: "notes", pageIds: [NOTE] });
    // テーマの要求は保存を待たない。
    await respond(200, { outline: OUTLINE });
    closeSlidesWizard();
    await openTopic();
    flush.mockClear();
    void requestSlides("outline", { flush });
    await settle();
    expect(flush).not.toHaveBeenCalled();
  });

  it("drops results that arrive after the user changed", async () => {
    await openTopic();
    void requestSlides("outline");
    await settle();
    resetSlidesWizard();
    await respond(200, { outline: OUTLINE });
    expect(getSlidesWizard()).toBeNull();
    expect(readSlidesDraft("scope-a", { type: "new" })?.outline).toBeNull();
  });

  it("starts per-slide image generation when deck returns imageTasks and stays busy while images run", async () => {
    const liveDeck = {
      format: 1,
      theme: { id: "simple", mode: "light" },
      slides: [{
        id: "s1",
        layout: "imageText",
        elements: [{ id: "img1", type: "image", role: "image", x: 0, y: 0, w: 400, h: 400, rotation: 0, src: "", fit: "cover", radius: 16, pendingImagePrompt: "Clean illustration of antibodies" }],
      }],
    };
    fetchMock.mockImplementation((url, init) => {
      if (init?.method === "POST") return new Promise<Response>((resolve, reject) => { pending.push({ resolve, reject }); });
      if (url === `/api/pages/${PAGE.id}`) return Promise.resolve(json(200, { page: { ...PAGE, data: liveDeck } }));
      return Promise.resolve(json(scopeStatus, scopeStatus === 200 ? { scope } : { error: "Database is unavailable. Try again in a moment." }));
    });
    await openTopic();
    updateSlidesDraft((draft) => ({ ...draft, step: "outline", outline: OUTLINE, options: { ...draft.options, generateImages: true } }));
    void requestSlides("deck");
    await settle();
    await respond(201, {
      page: PAGE,
      imageTasks: [{ slideId: "s1", elementId: "img1", slideTitle: "How they work", prompt: "Clean illustration of antibodies" }],
    });
    expect(ready().job).toEqual({ state: "done", page: PAGE, partial: false });
    expect(isSlidesWizardBusy()).toBe(true);
    // Closing while images are still generating keeps the done state when reopened.
    closeSlidesWizard();
    await open({ entry: { type: "new" }, model: "luna" });
    expect(ready().job).toEqual({ state: "done", page: PAGE, partial: false });
  });
});
