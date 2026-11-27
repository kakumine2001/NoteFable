import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 部品を関数として呼び、返った要素の木を調べる（DOM は使わない）。useState は呼ばれた順に用意した値を返し、
// useEffect は走らせずに集める（必要なテストだけが呼ぶ）。
const hooks = vi.hoisted(() => ({ states: [] as unknown[], effects: [] as (() => void | (() => void))[] }));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useCallback: <T,>(fn: T) => fn,
    useContext: () => false,
    useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
    useId: () => "test-id",
    useRef: (initial: unknown) => ({ current: initial }),
    useState: (initial: unknown) => [hooks.states.length ? hooks.states.shift() : initial, vi.fn()],
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  };
});
vi.mock("@/components/i18n-provider", () => ({
  useT: () => (key: string, vars?: Record<string, unknown>) => key.replace(/\{(\w+)\}/g, (match, name: string) => String(vars?.[name] ?? match)),
}));
vi.mock("@/lib/use-back-to-close", () => ({ useBackToClose: vi.fn() }));
const bridge = vi.hoisted(() => ({ canOpen: false, canShowWizard: false, canShowLimit: false, canShowStorageLimit: false, posted: [] as unknown[] }));
vi.mock("@/lib/native-bridge", () => ({
  dispatchPageUpdated: vi.fn(),
  nativeCanOpenPage: () => bridge.canOpen,
  nativeCanShowSlidesWizard: () => bridge.canShowWizard,
  nativeCanShowUsageLimit: () => bridge.canShowLimit,
  nativeCanShowStorageLimit: () => bridge.canShowStorageLimit,
  postToNative: (message: unknown) => { bridge.posted.push(message); return true; },
}));
const accountState = vi.hoisted(() => ({ account: null as null | { configured: boolean; user: unknown; billing?: boolean } }));
vi.mock("@/lib/account-store", () => ({ useAccount: () => ({ account: accountState.account }) }));

import { NewPageButton } from "./new-page-button";
import { NotePageMenu } from "./note-page-menu";
import { SlidesWizardHost } from "./slides-wizard";
import {
  getSlidesWizard, openSlidesWizard, requestSlides, resetSlidesWizard, setSlidesPicker, updateSlidesDraft,
} from "@/lib/slides-wizard-jobs";
import type { NotePageSummary } from "@/types/notes";

type AnyElement = ReactElement<Record<string, unknown>>;

// この窓の中の部品は呼び出して開き、他の部品（アイコン・ログインの案内など）は要素のまま残す。
const OWN = new Set(["SourceStep", "OutlineStep", "NotePicker", "OpenButton", "Progress", "OutlineError"]);

function elements(node: ReactNode): AnyElement[] {
  const found: AnyElement[] = [];
  const visit = (item: ReactNode) => {
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) { item.forEach(visit); return; }
    const el = item as AnyElement;
    if (typeof el.type === "function" && OWN.has(el.type.name)) { visit((el.type as (props: unknown) => ReactNode)(el.props)); return; }
    found.push(el);
    visit(el.props?.children as ReactNode);
  };
  visit(node);
  return found;
}
function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  const el = node as AnyElement;
  if (typeof el.type === "function" && OWN.has(el.type.name)) return textOf((el.type as (props: unknown) => ReactNode)(el.props));
  return textOf(el.props?.children as ReactNode);
}
const buttons = (tree: ReactNode) => elements(tree).filter((el) => el.type === "button");
const labelOf = (el: AnyElement) => (textOf(el).trim() || String(el.props["aria-label"] ?? ""));
const labels = (tree: ReactNode) => buttons(tree).map(labelOf);
const byLabel = (tree: ReactNode, label: string) => buttons(tree).find((el) => labelOf(el) === label);
const click = (el: AnyElement | undefined) => (el?.props.onClick as () => void)();
const names = (tree: ReactNode) => elements(tree).map((el) => (typeof el.type === "function" ? el.type.name : ""));

const NOTE_ID = "cnote000000000000000000001";
const SLIDES = { id: "cslides000000000000000001", kind: "slides", title: "Vaccines", icon: null } as NotePageSummary;
const OUTLINE = { title: "Vaccines", slides: [{ title: "How they work", points: ["Antibodies"] }, { title: "Safety", points: [] }] };

class MemoryStorage {
  items = new Map<string, string>();
  get length() { return this.items.size; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
}

let pending: { resolve: (response: Response) => void }[] = [];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>((_url, init) => (init?.method === "POST"
  ? new Promise<Response>((resolve) => { pending.push({ resolve }); })
  : Promise.resolve(json(200, { scope: "scope-a" }))));
const dispatchEvent = vi.fn();
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const sent = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([url, init]) => ({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> }));

beforeEach(() => {
  hooks.states = [];
  hooks.effects = [];
  bridge.canOpen = false;
  bridge.canShowWizard = false;
  bridge.canShowLimit = false;
  bridge.canShowStorageLimit = false;
  bridge.posted = [];
  accountState.account = null;
  pending = [];
  fetchMock.mockClear();
  dispatchEvent.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("localStorage", new MemoryStorage());
  vi.stubGlobal("window", { dispatchEvent });
  resetSlidesWizard();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// 窓の中身を描く。states は窓の useState の順（notes, notesError, attempt, closedLimit）と、中の面の分。
function dialog(embedded = false, states: unknown[] = []) {
  const host = SlidesWizardHost({ embedded }) as AnyElement | null;
  if (!host) return null;
  hooks.states = states;
  hooks.effects = [];
  return (host.type as (props: unknown) => ReactNode)(host.props);
}
async function open(entry: Parameters<typeof openSlidesWizard>[0]["entry"] = { type: "new" }) {
  openSlidesWizard({ entry, model: "luna" });
  await settle();
}
const fill = (topic: string) => updateSlidesDraft((draft) => ({ ...draft, source: { ...draft.source, topic } }));
const outline = () => updateSlidesDraft((draft) => ({ ...draft, step: "outline", source: { ...draft.source, topic: "Vaccines" }, outline: OUTLINE }));
async function respond(status: number, body: unknown) {
  await settle();
  pending.at(-1)!.resolve(json(status, body));
  await settle();
}
const view = () => {
  const current = getSlidesWizard();
  if (current?.phase !== "ready") throw new Error("not ready");
  return current;
};

describe("Generate slides window: options", () => {
  it("is hidden until an entry point opens it", () => {
    expect(dialog()).toBeNull();
  });

  it("asks for a topic or notes, keeps theme under Advanced, and states the cost", async () => {
    await open();
    let tree = dialog();
    const text = textOf(tree);
    for (const label of ["Generate slides", "Make slides from", "A topic", "Your notes", "Number of slides", "Tone", "Slide language", "Wording", "Audience", "Advanced", "Theme", "This counts as 1 chat message."]) {
      expect(text).toContain(label);
    }
    expect(byLabel(tree, "Create outline")?.props.disabled).toBe(true);
    expect(labels(tree)).not.toContain("Start over");
    fill("Vaccines");
    tree = dialog();
    expect(byLabel(tree, "Create outline")?.props.disabled).toBe(false);
    expect(labels(tree)).toContain("Start over");
    click(byLabel(tree, "Create outline"));
    await settle();
    expect(sent()[0].url).toBe("/api/pages/slides/outline");
    expect(textOf(dialog())).toContain("Writing the outline…");
  });

  it("fixes the chat or the note it was opened from", async () => {
    await open({ type: "chat", sessionId: "csession00000000000000001", title: "Study chat" });
    let tree = dialog();
    expect(textOf(tree)).toContain("Study chat");
    expect(labels(tree)).not.toContain("A topic");
    expect(byLabel(tree, "Create outline")?.props.disabled).toBe(false);

    await open({ type: "note", pageId: NOTE_ID, title: "Plan" });
    tree = dialog();
    expect(textOf(tree)).toContain("Plan");
    expect(labels(tree)).toContain("Choose notes");
    // ノートから開いた窓では、そのノートは外せない。
    expect(labels(tree)).not.toContain("Remove Plan");
  });

  it("picks notes in a layer of its own", async () => {
    await open({ type: "note", pageId: NOTE_ID, title: "Plan" });
    click(byLabel(dialog(), "Choose notes"));
    expect(view().picker).toBe(true);
    const list = [{ id: NOTE_ID, title: "Plan", icon: null }, { id: "cnote2", title: "Ideas", icon: null }];
    const tree = dialog(false, [list]);
    const boxes = elements(tree).filter((el) => el.type === "input" && el.props.type === "checkbox");
    expect(boxes.map((box) => [box.props.checked, box.props.disabled])).toEqual([[true, true], [false, false]]);
    (boxes[1].props.onChange as () => void)();
    expect(view().draft.source.notes.map((note) => note.id)).toEqual([NOTE_ID, "cnote2"]);
    click(byLabel(dialog(false, [list]), "Done"));
    expect(view().picker).toBe(false);
    setSlidesPicker(false);
  });
});

describe("Generate slides window: outline", () => {
  it("edits, reorders, adds and deletes slides before generating", async () => {
    await open();
    outline();
    const tree = dialog();
    expect(textOf(tree)).toContain("Title slide");
    expect(textOf(tree)).toContain("Slide 2");
    expect(labels(tree)).toEqual(expect.arrayContaining(["Move up", "Move down", "Delete slide", "Delete point", "Add point", "Add slide", "Start over", "Back", "Regenerate outline", "Generate slides"]));
    vi.stubGlobal("requestAnimationFrame", vi.fn());
    click(buttons(tree).find((el) => labelOf(el) === "Move down"));
    expect(view().draft.outline?.slides.map((slide) => slide.title)).toEqual(["Safety", "How they work"]);
    click(buttons(dialog()).find((el) => labelOf(el) === "Delete slide"));
    expect(view().draft.outline?.slides.map((slide) => slide.title)).toEqual(["How they work"]);
    // 1 枚だけになったら消せない。
    expect(byLabel(dialog(), "Delete slide")?.props.disabled).toBe(true);
    click(byLabel(dialog(), "Add slide"));
    expect(view().draft.outline?.slides).toHaveLength(2);
    // 題名の無いスライドがある間は作れない。
    expect(byLabel(dialog(), "Generate slides")?.props.disabled).toBe(true);
    expect(textOf(dialog())).toContain("Give the title slide and every slide a title.");
    click(byLabel(dialog(), "Back"));
    expect(view().draft.step).toBe("source");
    click(byLabel(dialog(), "Back to outline"));
    expect(view().draft.step).toBe("outline");
  });

  it("shows progress, then opens the new slides", async () => {
    await open();
    outline();
    click(byLabel(dialog(), "Generate slides"));
    let tree = dialog();
    expect(textOf(tree)).toContain("Writing the slides…");
    expect(labels(tree)).toEqual(["Close", "Close"]);
    await respond(201, { page: SLIDES, partial: true });
    tree = dialog();
    expect(textOf(tree)).toContain("Created “Vaccines” in Workspace.");
    expect(textOf(tree)).toContain("Part of the content was too long and was left out.");
    dispatchEvent.mockClear();
    click(byLabel(tree, "Open slides"));
    const event = dispatchEvent.mock.calls[0][0] as CustomEvent;
    expect([event.type, event.detail]).toEqual(["notefable:open-note", { id: SLIDES.id }]);
    expect(getSlidesWizard()).toBeNull();
  });

  it("asks the app to open the slides, or only reports them when the app cannot", async () => {
    await open();
    outline();
    void requestSlides("deck");
    await respond(201, { page: SLIDES });
    expect(labels(dialog(true))).toEqual(["Close", "Close"]);
    bridge.canOpen = true;
    bridge.posted = [];
    dispatchEvent.mockClear();
    click(byLabel(dialog(true), "Open slides"));
    expect(bridge.posted).toEqual([{ type: "openPage", id: SLIDES.id }]);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it("offers to retry or go back when the slides could not be made", async () => {
    await open();
    outline();
    void requestSlides("deck");
    await respond(502, { error: "Could not generate slides. Try again." });
    const tree = dialog();
    expect(textOf(tree)).toContain("Could not generate slides. Try again.");
    expect(labels(tree)).toEqual(["Close", "Back", "Try again"]);
    click(byLabel(tree, "Try again"));
    await settle();
    expect(sent()[1]).toEqual(sent()[0]);
    await respond(502, { error: "x" });
    click(byLabel(dialog(), "Back"));
    expect(view().job).toEqual({ state: "idle" });
    expect(textOf(dialog())).toContain("Title slide");
  });
});

describe("Generate slides window: usage limit and the app", () => {
  it("offers sign-in or upgrade on the web only", async () => {
    await open();
    fill("Vaccines");
    void requestSlides("outline");
    await respond(429, { error: "You've reached today's limit.", code: "usage_limit", tier: "guest", kind: "chat" });
    accountState.account = { configured: true, user: null };
    expect(textOf(dialog())).toContain("You've reached today's limit.");
    expect(names(dialog())).toContain("GuestLimitPrompt");
    expect(names(dialog(true))).not.toContain("GuestLimitPrompt");

    // アプリには usageLimit を（ページ ID なしで）渡す。受け取れない古いアプリには送らない。
    const run = () => { dialog(true); hooks.effects.forEach((effect) => { if (String(effect).includes("usageLimit")) effect(); }); };
    run();
    expect(bridge.posted).toEqual([]);
    bridge.canShowLimit = true;
    run();
    expect(bridge.posted).toEqual([{ type: "usageLimit", tier: "guest", kind: "chat" }]);
  });

  it("tells the app when it appears and disappears, with whether it is still generating", async () => {
    await open();
    fill("Vaccines");
    void requestSlides("outline");
    const effect = () => {
      hooks.effects = [];
      SlidesWizardHost({ embedded: true });
      return hooks.effects[0]();
    };
    expect(effect()).toBeUndefined();
    expect(bridge.posted).toEqual([]);
    bridge.canShowWizard = true;
    const cleanup = effect() as () => void;
    cleanup();
    expect(bridge.posted).toEqual([{ type: "slidesWizard", state: "open" }, { type: "slidesWizard", state: "closed", busy: true }]);
    await respond(200, { outline: OUTLINE });
    bridge.posted = [];
    (effect() as () => void)();
    expect(bridge.posted.at(-1)).toEqual({ type: "slidesWizard", state: "closed", busy: false });
    // ブラウザーでは知らせない。
    bridge.posted = [];
    hooks.effects = [];
    SlidesWizardHost({});
    hooks.effects[0]();
    expect(bridge.posted).toEqual([]);
  });

  it("tells the app which notes it is generating slides from, for the note menu's busy state", async () => {
    await open({ type: "note", pageId: NOTE_ID, title: "Vaccines" });
    const start = () => {
      hooks.effects = [];
      SlidesWizardHost({ embedded: true });
      return hooks.effects.find((effect) => String(effect).includes("slidesJobs"))!() as (() => void) | undefined;
    };
    // 受け取れない古いアプリには送らない。
    expect(start()).toBeUndefined();
    expect(bridge.posted).toEqual([]);

    bridge.canShowWizard = true;
    const stop = start();
    expect(bridge.posted).toEqual([{ type: "slidesJobs", pageIds: [] }]);
    void requestSlides("outline");
    expect(bridge.posted.at(-1)).toEqual({ type: "slidesJobs", pageIds: [NOTE_ID] });
    await respond(200, { outline: OUTLINE });
    expect(bridge.posted).toEqual([{ type: "slidesJobs", pageIds: [] }, { type: "slidesJobs", pageIds: [NOTE_ID] }, { type: "slidesJobs", pageIds: [] }]);
    stop!();
    void requestSlides("outline", { fresh: true });
    expect(bridge.posted).toHaveLength(3);
  });

  it("keeps Generate images OFF by default, previews max image credits before generating, and uses zero Sparkles icons", async () => {
    await open();
    let tree = dialog();
    // Toggle is OFF by default and credit warning only shows when toggled ON.
    const sourceToggle = elements(tree).find((el) => el.type === "input" && el.props.type === "checkbox");
    expect(sourceToggle?.props.checked).toBe(false);
    expect(textOf(tree)).toContain("Generate images for slides");
    expect(textOf(tree)).not.toContain("image credits");
    expect(names(tree)).not.toContain("Sparkles");

    // Enabling on options step previews the credit cost based on slide count.
    updateSlidesDraft((draft) => ({ ...draft, options: { ...draft.options, pageCount: 8, generateImages: true } }));
    tree = dialog();
    expect(textOf(tree)).toContain("up to 7 image credits");
    expect(names(tree)).not.toContain("Sparkles");

    // On the outline step, previews exact max image credits matching the outline slide count right before Generate slides.
    outline();
    tree = dialog();
    expect(textOf(tree)).toContain("up to 2 image credits");
    expect(textOf(tree)).toContain("This counts as 1 chat message, plus up to 2 image credits.");
    expect(names(tree)).not.toContain("Sparkles");
  });

  it("shows live image progress, Stop/Resume controls, and native image usageLimit / storageLimit prompts on the done screen", async () => {
    let serverVersion = 1;
    let liveDeck: Record<string, unknown> = {
      format: 1,
      theme: { id: "simple", mode: "light" },
      slides: [
        {
          id: "s1",
          layout: "imageText",
          elements: [{ id: "img1", type: "image", role: "image", x: 0, y: 0, w: 400, h: 400, rotation: 0, src: "", fit: "cover", radius: 16, pendingImagePrompt: "Antibody diagram" }],
        },
        {
          id: "s2",
          layout: "imageText",
          elements: [{ id: "img2", type: "image", role: "image", x: 0, y: 0, w: 400, h: 400, rotation: 0, src: "", fit: "cover", radius: 16, pendingImagePrompt: "Memory cells" }],
        },
      ],
    };
    fetchMock.mockImplementation((url, init) => {
      if (init?.method === "POST") return new Promise<Response>((resolve) => { pending.push({ resolve }); });
      if (url === `/api/pages/${SLIDES.id}` && init?.method === "PATCH") {
        serverVersion += 1;
        liveDeck = (JSON.parse(String(init.body)) as { data: Record<string, unknown> }).data;
        return Promise.resolve(json(200, { version: serverVersion }));
      }
      if (url === `/api/pages/${SLIDES.id}`) return Promise.resolve(json(200, { page: { ...SLIDES, version: serverVersion, data: liveDeck } }));
      return Promise.resolve(json(200, { scope: "scope-a" }));
    });

    await open();
    outline();
    updateSlidesDraft((draft) => ({ ...draft, options: { ...draft.options, generateImages: true } }));
    void requestSlides("deck");
    await respond(201, {
      page: SLIDES,
      imageTasks: [
        { slideId: "s1", elementId: "img1", slideTitle: "How they work", prompt: "Antibody diagram" },
        { slideId: "s2", elementId: "img2", slideTitle: "Immune memory", prompt: "Memory cells" },
      ],
    });
    // Working state shows live progress + Stop + Open slides.
    let tree = dialog();
    expect(textOf(tree)).toContain("Generating slide images… (0/2)");
    expect(textOf(tree)).toContain("Current slide: How they work");
    expect(labels(tree)).toEqual(expect.arrayContaining(["Stop", "Close", "Open slides"]));

    // Stopping waits for the in-flight image to finish and persist, then stops before slide 2.
    click(byLabel(tree, "Stop"));
    tree = dialog();
    expect(labels(tree)).toEqual(expect.arrayContaining(["Stopping after this slide…", "Close", "Open slides"]));
    await respond(200, { url: "/api/pages/files?key=note-files%2Fu1%2F00000000-0000-4000-8000-000000000001.png&name=ai-image.png", name: "ai-image.png", prompt: "Antibody diagram" });
    tree = dialog();
    expect(textOf(tree)).toContain("Generated 1 of 2 slide images. 1 remaining.");
    expect(labels(tree)).toEqual(expect.arrayContaining(["Resume", "Close", "Open slides"]));

    // Resuming and hitting 429 usage_limit shows GuestLimitPrompt on web and sends kind:"image" to native.
    click(byLabel(tree, "Resume"));
    await respond(429, { error: "Image limit reached.", code: "usage_limit", tier: "guest", kind: "image" });
    accountState.account = { configured: true, user: null };
    expect(names(dialog())).toContain("GuestLimitPrompt");
    bridge.canShowLimit = true;
    bridge.posted = [];
    dialog(true);
    hooks.effects.forEach((effect) => { if (String(effect).includes("usageLimit")) effect(); });
    expect(bridge.posted).toEqual([{ type: "usageLimit", tier: "guest", kind: "image" }]);

    // Resuming and hitting 413 storage_limit shows StorageLimitPrompt on web and sends storageLimit to native.
    click(byLabel(dialog(), "Resume"));
    await respond(413, { error: "Storage full.", code: "storage_limit", tier: "member", used: 50, limit: 100 });
    expect(names(dialog())).toContain("StorageLimitPrompt");
    bridge.canShowStorageLimit = true;
    bridge.posted = [];
    dialog(true);
    hooks.effects.forEach((effect) => { if (String(effect).includes("storageLimit")) effect(); });
    expect(bridge.posted).toEqual([{ type: "storageLimit", tier: "member", used: 50, limit: 100 }]);
  });
});

describe("Generate slides entries", () => {
  const PAGE = { id: NOTE_ID, kind: "note", title: "Plan", icon: null, version: 1, groupId: null } as NotePageSummary;
  const menu = (page: NotePageSummary, onGenerateSlides?: () => void) => {
    hooks.states = [{ anchor: {}, trigger: {}, focusLast: false }, false];
    return NotePageMenu({
      page, busy: false, error: "", onSettings: vi.fn(), onFavorite: vi.fn(), onDuplicate: vi.fn(), onAddSubpage: vi.fn(),
      onDrawDiagram: vi.fn(), onGenerateSlides, onMove: vi.fn(), onExport: vi.fn(), onTrash: vi.fn(),
    });
  };

  it("is in the note menu after Draw as diagram, for notes only", () => {
    const onGenerateSlides = vi.fn();
    const tree = menu(PAGE, onGenerateSlides);
    const items = labels(tree);
    expect(items.indexOf("Generate slides")).toBe(items.indexOf("Draw as diagram") + 1);
    click(byLabel(tree, "Generate slides"));
    expect(onGenerateSlides).toHaveBeenCalledTimes(1);
    expect(labels(menu({ ...PAGE, kind: "slides" }, vi.fn()))).not.toContain("Generate slides");
    expect(labels(menu(PAGE))).not.toContain("Generate slides");
  });

  it("shows in the note menu that slides are being generated", async () => {
    await open({ type: "note", pageId: NOTE_ID });
    void requestSlides("outline");
    expect(labels(menu(PAGE, vi.fn()))).toContain("Generating slides…");
  });

  it("adds Generate with AI to the new page menu where slides can be created", () => {
    const onCreate = vi.fn();
    const onGenerate = vi.fn();
    const render = (kinds: ("note" | "slides" | "whiteboard")[], generate?: () => void) => {
      hooks.states = [{ anchor: {}, trigger: {}, focusLast: false }];
      return NewPageButton({ kinds, busy: false, onCreate, onGenerate: generate, className: "c", menuLabel: "New page", children: "+" });
    };
    const all = render(["note", "slides", "whiteboard"], onGenerate);
    expect(labels(all)).toEqual(["+", "Note", "Slides", "Whiteboard", "Generate with AI"]);
    click(byLabel(all, "Generate with AI"));
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
    // スライドの分区の「+」：1 種類でもメニューを開き、作る操作の名前で出す。
    expect(labels(render(["slides"], onGenerate))).toEqual(["+", "New slide deck", "Generate with AI"]);
    expect(labels(render(["note", "slides"]))).not.toContain("Generate with AI");
    // スライドを作れない分区は、押すとすぐ作る。
    const note = render(["note"], onGenerate);
    expect(byLabel(note, "+")?.props["aria-haspopup"]).toBeUndefined();
  });
});
