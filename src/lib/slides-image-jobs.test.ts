import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAiDeck, pendingSlideImageTasks } from "./slides/ai-build";
import { normalizeDeck, type Deck } from "./slides/model";
import {
  dismissSlideImageJob, getSlideImageJob, isAnySlideImageJobWorking, isSlideImageJobWorking,
  parseSlideImageTasks, registerSlideImageEditor, resetSlideImageJobs, resumeSlideImageJob,
  startSlideImageJob, stopSlideImageJob,
} from "./slides-image-jobs";

const PAGE_ID = "cslides000000000000000001";
const FILE_1 = "/api/pages/files?key=note-files%2Fu1%2F00000000-0000-4000-8000-000000000001.png&name=one.png";
const FILE_2 = "/api/pages/files?key=note-files%2Fu1%2F00000000-0000-4000-8000-000000000002.png&name=two.png";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const settle = async (ticks = 6) => {
  for (let i = 0; i < ticks; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function makeDeck(): Deck {
  return buildAiDeck({
    title: "Solar System",
    theme: { id: "simple", mode: "light" },
    slides: [
      { title: "Inner Planets", body: "- Mercury and Venus", notes: "", imagePrompt: "Clean illustration of inner rocky planets" },
      { title: "Gas Giants", body: "- Jupiter and Saturn", notes: "", imagePrompt: "Clean illustration of ringed gas giant" },
    ],
  }).deck;
}

describe("slides-image-jobs", () => {
  const dispatchEvent = vi.fn();
  const postMessage = vi.fn<(message: string) => void>();

  beforeEach(() => {
    resetSlideImageJobs();
    dispatchEvent.mockClear();
    postMessage.mockClear();
    vi.stubGlobal("window", { dispatchEvent, NoteFableNative: { postMessage } });
  });

  afterEach(() => {
    resetSlideImageJobs();
    vi.unstubAllGlobals();
  });

  it("parses valid imageTasks and ignores malformed entries", () => {
    expect(parseSlideImageTasks([
      { slideId: "s1", elementId: "e1", slideTitle: "Title", prompt: "  A lake  " },
      { slideId: "", elementId: "e2", prompt: "Bad" },
      { slideId: "s2", elementId: "e2", prompt: "   " },
      null,
    ])).toEqual([{ slideId: "s1", elementId: "e1", slideTitle: "Title", prompt: "A lake" }]);
  });

  it("generates images one-by-one, persists via PATCH with 409 retry, and notifies web & native", async () => {
    let serverDeck = makeDeck();
    let serverVersion = 1;
    let imageCalls = 0;
    let failFirstPatchWith409 = true;
    const tasks = pendingSlideImageTasks(serverDeck);
    expect(tasks).toHaveLength(2);

    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url, init) => {
      if (url === `/api/pages/${PAGE_ID}` && (!init?.method || init.method === "GET")) {
        return json(200, { page: { id: PAGE_ID, kind: "slides", title: "Solar System", icon: null, version: serverVersion, data: serverDeck } });
      }
      if (url === "/api/pages/images" && init?.method === "POST") {
        imageCalls += 1;
        return json(200, {
          url: imageCalls === 1 ? FILE_1 : FILE_2,
          name: imageCalls === 1 ? "one.png" : "two.png",
          prompt: (JSON.parse(String(init.body)) as { prompt: string }).prompt,
        });
      }
      if (url === `/api/pages/${PAGE_ID}` && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { data: Deck; version: number };
        if (failFirstPatchWith409) {
          failFirstPatchWith409 = false;
          // Simulate concurrent edit on the server before our PATCH landed.
          serverVersion = 2;
          serverDeck = { ...serverDeck, slides: serverDeck.slides.map((s, idx) => (idx === 0 ? { ...s, notes: "User edit" } : s)) };
          return json(409, { error: "Version conflict." });
        }
        expect(body.version).toBe(serverVersion);
        serverVersion += 1;
        serverDeck = normalizeDeck(body.data);
        return json(200, { version: serverVersion });
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    startSlideImageJob(PAGE_ID, tasks);
    await settle(15);

    expect(imageCalls).toBe(2);
    expect(getSlideImageJob(PAGE_ID)).toMatchObject({ status: "done", total: 2, completed: 2, remaining: 0 });
    expect(isSlideImageJobWorking(PAGE_ID)).toBe(false);
    expect(isAnySlideImageJobWorking()).toBe(false);
    // Concurrent user edit survived the 409 retry!
    expect(serverDeck.slides[0].notes).toBe("User edit");
    expect(pendingSlideImageTasks(serverDeck)).toEqual([]);
    const imgs = serverDeck.slides.slice(1).flatMap((s) => s.elements.filter((e) => e.type === "image"));
    expect(imgs.map((img) => ({ src: img.src, prompt: img.generated?.prompt, pending: img.pendingImagePrompt }))).toEqual([
      { src: FILE_1, prompt: "Clean illustration of inner rocky planets", pending: undefined },
      { src: FILE_2, prompt: "Clean illustration of ringed gas giant", pending: undefined },
    ]);
    expect(dispatchEvent.mock.calls.filter(([e]) => (e as CustomEvent).type === "notefable:page-updated")).toHaveLength(2);
    expect(postMessage.mock.calls.map(([m]) => JSON.parse(m))).toEqual([{ type: "pagesChanged" }, { type: "pagesChanged" }]);

    dismissSlideImageJob(PAGE_ID);
    expect(getSlideImageJob(PAGE_ID)).toBeNull();
  });

  it("commits through the live registered editor without PATCHing directly", async () => {
    let liveDeck = makeDeck();
    const tasks = pendingSlideImageTasks(liveDeck);
    const appliedCalls: string[] = [];
    const unregister = registerSlideImageEditor(PAGE_ID, {
      getDeck: () => liveDeck,
      applyImage: ({ slideId, elementId, url, prompt }) => {
        appliedCalls.push(slideId);
        liveDeck = {
          ...liveDeck,
          slides: liveDeck.slides.map((s) => (s.id !== slideId ? s : {
            ...s,
            elements: s.elements.map((e) => (e.id === elementId && e.type === "image"
              ? { ...e, src: url, generated: { prompt }, pendingImagePrompt: undefined }
              : e)),
          })),
        };
        return true;
      },
    });

    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url, init) => {
      if (url === "/api/pages/images" && init?.method === "POST") {
        return json(200, { url: appliedCalls.length === 0 ? FILE_1 : FILE_2, name: "gen.png" });
      }
      throw new Error(`Unexpected fetch while editor is mounted: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    startSlideImageJob(PAGE_ID, tasks);
    await settle(10);

    expect(appliedCalls).toEqual(tasks.map((t) => t.slideId));
    expect(getSlideImageJob(PAGE_ID)).toMatchObject({ status: "done", total: 2, completed: 2, remaining: 0 });
    expect(pendingSlideImageTasks(liveDeck)).toEqual([]);
    unregister();
  });

  it("finishes saving the in-flight slide on user Stop and resumes remaining slides without double-charging", async () => {
    let serverDeck = buildAiDeck({
      title: "Solar System",
      theme: { id: "simple", mode: "light" },
      slides: [
        { title: "Inner Planets", body: "- Mercury and Venus", notes: "", imagePrompt: "Clean illustration of inner rocky planets" },
        { title: "Gas Giants", body: "- Jupiter and Saturn", notes: "", imagePrompt: "Clean illustration of ringed gas giant" },
        { title: "Ice Giants", body: "- Uranus and Neptune", notes: "", imagePrompt: "Clean illustration of blue ice giant" },
      ],
    }).deck;
    let serverVersion = 1;
    const tasks = pendingSlideImageTasks(serverDeck);
    expect(tasks).toHaveLength(3);
    const imagePrompts: string[] = [];
    let holdSecondImage: ((response: Response) => void) | null = null;
    let secondAborted = false;
    const FILE_3 = "/api/pages/files?key=note-files%2Fu1%2F00000000-0000-4000-8000-000000000003.png&name=three.png";

    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url, init) => {
      if (url === `/api/pages/${PAGE_ID}` && (!init?.method || init.method === "GET")) {
        return json(200, { page: { id: PAGE_ID, kind: "slides", title: "Solar System", icon: null, version: serverVersion, data: serverDeck } });
      }
      if (url === "/api/pages/images" && init?.method === "POST") {
        const prompt = (JSON.parse(String(init.body)) as { prompt: string }).prompt;
        imagePrompts.push(prompt);
        if (imagePrompts.length === 1) {
          return json(200, { url: FILE_1, name: "one.png", prompt });
        }
        if (imagePrompts.length === 2) {
          return new Promise<Response>((resolve, reject) => {
            holdSecondImage = resolve;
            init.signal?.addEventListener("abort", () => {
              secondAborted = true;
              reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
            });
          });
        }
        return json(200, { url: FILE_3, name: "three.png", prompt });
      }
      if (url === `/api/pages/${PAGE_ID}` && init?.method === "PATCH") {
        serverVersion += 1;
        serverDeck = normalizeDeck((JSON.parse(String(init.body)) as { data: Deck }).data);
        return json(200, { version: serverVersion });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    startSlideImageJob(PAGE_ID, tasks);
    await settle(8);
    expect(holdSecondImage).not.toBeNull();
    expect(getSlideImageJob(PAGE_ID)).toMatchObject({ status: "working", completed: 1, remaining: 2, total: 3 });

    // Clicking Stop waits for the already-billed in-flight image to finish and persist, then stops before slide 3.
    stopSlideImageJob(PAGE_ID);
    expect(secondAborted).toBe(false);
    expect(getSlideImageJob(PAGE_ID)).toMatchObject({ status: "working", stopping: true, completed: 1, remaining: 2, total: 3 });

    holdSecondImage!(json(200, { url: FILE_2, name: "two.png", prompt: "Clean illustration of ringed gas giant" }));
    await settle(10);
    expect(secondAborted).toBe(false);
    expect(getSlideImageJob(PAGE_ID)).toMatchObject({ status: "stopped", stopping: false, completed: 2, remaining: 1, total: 3 });
    // Both slide 1 and slide 2 were saved cleanly; only slide 3 remains pending.
    expect(pendingSlideImageTasks(serverDeck)).toHaveLength(1);
    expect(pendingSlideImageTasks(serverDeck)[0].slideTitle).toBe("Ice Giants");

    // Resume only generates slide 3 — slide 2 is NEVER requested a second time.
    await resumeSlideImageJob(PAGE_ID);
    await settle(10);
    expect(imagePrompts).toEqual([
      "Clean illustration of inner rocky planets",
      "Clean illustration of ringed gas giant",
      "Clean illustration of blue ice giant",
    ]);
    expect(getSlideImageJob(PAGE_ID)).toMatchObject({ status: "done", completed: 3, remaining: 0, total: 3 });
    expect(pendingSlideImageTasks(serverDeck)).toEqual([]);
  });

  it("does not count discarded images when the user removes or fills a slide while generating", async () => {
    let liveDeck = makeDeck();
    const tasks = pendingSlideImageTasks(liveDeck);
    const unregister = registerSlideImageEditor(PAGE_ID, {
      getDeck: () => liveDeck,
      applyImage: ({ slideId }) => {
        // Simulate user having deleted slide 1 while its image was in flight.
        if (slideId === tasks[0].slideId) return false;
        liveDeck = {
          ...liveDeck,
          slides: liveDeck.slides.map((s) => (s.id !== slideId ? s : {
            ...s,
            elements: s.elements.map((e) => (e.type === "image"
              ? { ...e, src: FILE_2, generated: { prompt: tasks[1].prompt }, pendingImagePrompt: undefined }
              : e)),
          })),
        };
        return true;
      },
    });

    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url, init) => {
      if (url === "/api/pages/images" && init?.method === "POST") {
        return json(200, { url: FILE_1, name: "ai-image.png" });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    startSlideImageJob(PAGE_ID, tasks);
    await settle(10);
    expect(getSlideImageJob(PAGE_ID)).toMatchObject({ status: "done", completed: 1, total: 1, remaining: 0 });
    unregister();
  });

  it("handles 429 usage_limit and 413 storage_limit cleanly without losing earlier images", async () => {
    let serverDeck = makeDeck();
    let serverVersion = 1;
    const tasks = pendingSlideImageTasks(serverDeck);
    let call = 0;

    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url, init) => {
      if (url === `/api/pages/${PAGE_ID}` && (!init?.method || init.method === "GET")) {
        return json(200, { page: { id: PAGE_ID, kind: "slides", title: "Solar System", icon: null, version: serverVersion, data: serverDeck } });
      }
      if (url === "/api/pages/images" && init?.method === "POST") {
        call += 1;
        if (call === 1) return json(200, { url: FILE_1, name: "one.png" });
        if (call === 2) return json(429, { error: "Image limit reached.", code: "usage_limit", tier: "guest", kind: "image" });
        return json(413, { error: "Storage full.", code: "storage_limit", tier: "member", used: 100, limit: 100 });
      }
      if (url === `/api/pages/${PAGE_ID}` && init?.method === "PATCH") {
        serverVersion += 1;
        serverDeck = normalizeDeck((JSON.parse(String(init.body)) as { data: Deck }).data);
        return json(200, { version: serverVersion });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    startSlideImageJob(PAGE_ID, tasks);
    await settle(10);
    expect(getSlideImageJob(PAGE_ID)).toMatchObject({
      status: "error",
      completed: 1,
      remaining: 1,
      total: 2,
      error: "Image limit reached.",
      usageLimit: { tier: "guest", kind: "image", message: "Image limit reached." },
    });

    // Resume hits 413 storage_limit on slide 2 (still doesn't touch slide 1).
    await resumeSlideImageJob(PAGE_ID);
    await settle(10);
    expect(call).toBe(3);
    expect(getSlideImageJob(PAGE_ID)).toMatchObject({
      status: "error",
      completed: 1,
      remaining: 1,
      total: 2,
      error: "Storage full.",
      storageLimit: { tier: "member", used: 100, limit: 100, message: "Storage full." },
    });
  });
});
