import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 部品を関数として呼び、返った要素の木を調べる（DOM は使わない）。useState は呼ばれた順に用意した値を返す。
const hooks = vi.hoisted(() => ({ states: [] as unknown[], setters: [] as ReturnType<typeof vi.fn>[] }));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useCallback: <T,>(fn: T) => fn,
    useContext: () => false,
    useEffect: () => {},
    useLayoutEffect: () => {},
    useId: () => "test-id",
    useRef: (initial: unknown) => ({ current: initial }),
    useState: (initial: unknown) => {
      const value = hooks.states.length ? hooks.states.shift() : initial;
      const setter = vi.fn();
      hooks.setters.push(setter);
      return [value, setter];
    },
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  };
});
vi.mock("@/components/i18n-provider", () => ({ useT: () => (key: string) => key }));
vi.mock("@/lib/use-back-to-close", () => ({ useBackToClose: vi.fn() }));
const bridge = vi.hoisted(() => ({ canOpen: false, posted: [] as unknown[] }));
vi.mock("@/lib/native-bridge", () => ({
  nativeCanOpenPage: () => bridge.canOpen,
  postToNative: (message: unknown) => { bridge.posted.push(message); return true; },
}));
vi.mock("@/lib/clipboard", () => ({ writeClipboardText: vi.fn(async () => true) }));

import { AnswerActions } from "./answer-actions";
import { DrawDiagramHost } from "./draw-diagram-dialog";
import { NotePageMenu } from "./note-page-menu";
import type { TurnActions } from "./turn-actions";
import { writeClipboardText } from "@/lib/clipboard";
import { getDiagramDialog, getDiagramJob, openDiagramDialog, resetDiagramJobs, startDiagramJob, UNSAVED_NOTE } from "@/lib/draw-diagram-jobs";
import type { NotePageSummary } from "@/types/notes";

type AnyElement = ReactElement<Record<string, unknown>>;

function elements(node: ReactNode): AnyElement[] {
  const found: AnyElement[] = [];
  const visit = (item: ReactNode) => {
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) { item.forEach(visit); return; }
    const el = item as AnyElement;
    found.push(el);
    visit(el.props?.children as ReactNode);
  };
  visit(node);
  return found;
}
function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf((node as AnyElement).props?.children as ReactNode);
}
const buttons = (tree: ReactNode) => elements(tree).filter((el) => el.type === "button");
const labels = (tree: ReactNode) => buttons(tree).map((el) => textOf(el).trim()).filter(Boolean);
const byLabel = (tree: ReactNode, label: string) => buttons(tree).find((el) => textOf(el).trim() === label);
const click = (el: AnyElement | undefined) => (el?.props.onClick as () => void)();

const SESSION = "csession00000000000000001";
const SAVED = "cmessage00000000000000001";
const PAGE = { id: "cnote000000000000000000001", kind: "note", title: "Plan", icon: null, version: 1, groupId: null } as NotePageSummary;
const WHITEBOARD = { id: "cwhiteboard000000000000001", kind: "whiteboard", title: "Board", icon: null, version: 1, groupId: null, parentId: PAGE.id } as NotePageSummary;
const MENU = { anchor: {}, trigger: {}, focusLast: false };

let pending: { resolve: (response: Response) => void }[] = [];
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => new Promise<Response>((resolve) => { pending.push({ resolve }); }));
const dispatchEvent = vi.fn();
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  hooks.states = [];
  hooks.setters = [];
  bridge.canOpen = false;
  bridge.posted = [];
  pending = [];
  fetchMock.mockClear();
  dispatchEvent.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", { dispatchEvent });
  resetDiagramJobs();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function turnActions(): TurnActions {
  return { regenerate: vi.fn(), edit: vi.fn(), dismissEditDraft: vi.fn(), showVersion: vi.fn(), branch: vi.fn(), drawDiagram: vi.fn() };
}

// 回答の「…」メニューを開いた状態で描く（useState: done, status, error, downloading, menu, reporting）。
function answerMenu(messageId: string, actions?: TurnActions) {
  hooks.states = [null, "", null, false, MENU, false];
  return AnswerActions({ messageId, content: "1. Plan\n2. Build", sessionId: SESSION, conversationTitle: "Chat", actions });
}

// ノートの「…」メニューを開いた状態で描く（useState: menu, reporting）。
function noteMenu(page: NotePageSummary, onDrawDiagram?: () => void) {
  hooks.states = [MENU, false];
  return NotePageMenu({
    page, busy: false, error: "", onSettings: vi.fn(), onFavorite: vi.fn(), onDuplicate: vi.fn(), onAddSubpage: vi.fn(),
    onDrawDiagram, onMove: vi.fn(), onExport: vi.fn(), onTrash: vi.fn(),
  });
}

function dialog(embedded = false) {
  const host = DrawDiagramHost({ embedded }) as AnyElement | null;
  if (!host) return null;
  // copied, copyFailed
  hooks.states = [false, false];
  return (host.type as (props: unknown) => ReactNode)(host.props);
}

describe("Draw as diagram in the answer menu", () => {
  it("comes right after Save to page for saved answers in the main chat", () => {
    const actions = turnActions();
    const tree = answerMenu(SAVED, actions);
    const items = labels(tree);
    expect(items.indexOf("Draw as diagram")).toBe(items.indexOf("Save to page") + 1);
    click(byLabel(tree, "Draw as diagram"));
    expect(actions.drawDiagram).toHaveBeenCalledWith(SESSION, SAVED);
  });

  it("is not offered for answers that are not saved yet or outside the main chat", () => {
    expect(labels(answerMenu("2f1c9a7e-1b7a-4c1e-9a43-7f5d7c1e0b11", turnActions()))).not.toContain("Draw as diagram");
    expect(labels(answerMenu(SAVED))).not.toContain("Draw as diagram");
  });

  it("shows that the diagram is being drawn", () => {
    startDiagramJob({ type: "answer", sessionId: SESSION, messageId: SAVED }, "luna");
    expect(labels(answerMenu(SAVED, turnActions()))).toContain("Drawing a diagram…");
  });
});

describe("Draw as diagram in the note menu", () => {
  it("comes right after Add a page inside, only for notes", () => {
    const onDrawDiagram = vi.fn();
    const tree = noteMenu(PAGE, onDrawDiagram);
    const items = labels(tree);
    expect(items.indexOf("Draw as diagram")).toBe(items.indexOf("Add a page inside") + 1);
    click(byLabel(tree, "Draw as diagram"));
    expect(onDrawDiagram).toHaveBeenCalledTimes(1);
    // メニューは閉じてから始める。
    expect(hooks.setters[0]).toHaveBeenCalledWith(null);
    expect(labels(noteMenu(WHITEBOARD, vi.fn()))).not.toContain("Draw as diagram");
    expect(labels(noteMenu(PAGE))).not.toContain("Draw as diagram");
  });
});

describe("Draw as diagram window", () => {
  const key = `answer:${SESSION}\n${SAVED}`;

  it("is hidden until an entry point opens it", () => {
    expect(dialog()).toBeNull();
  });

  it("shows progress and keeps the job when closed while working", () => {
    startDiagramJob({ type: "answer", sessionId: SESSION, messageId: SAVED }, "luna");
    openDiagramDialog(key);
    const tree = dialog();
    const text = textOf(tree);
    expect(text).toContain("AI turns this into an editable diagram on a new whiteboard. This counts as 1 chat message.");
    expect(text).toContain("Drawing a diagram…");
    expect(labels(tree)).toEqual(["Close"]);
    click(byLabel(tree, "Close"));
    expect(getDiagramDialog()).toBeNull();
    expect(getDiagramJob(key)).toEqual({ status: "working" });
  });

  it("opens the new whiteboard, then forgets the job", async () => {
    startDiagramJob({ type: "answer", sessionId: SESSION, messageId: SAVED }, "luna");
    pending[0].resolve(json(201, { page: WHITEBOARD, partial: true }));
    await settle();
    openDiagramDialog(key);
    const tree = dialog();
    expect(textOf(tree)).toContain("The diagram is ready. Part of the material was too long, so only the first part was drawn.");
    expect(labels(tree)).toEqual(["Close", "Open whiteboard"]);
    dispatchEvent.mockClear();
    click(byLabel(tree, "Open whiteboard"));
    const event = dispatchEvent.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe("notefable:open-note");
    expect(event.detail).toEqual({ id: WHITEBOARD.id });
    expect(getDiagramDialog()).toBeNull();
    expect(getDiagramJob(key)).toBeNull();
  });

  it("asks the app to open the whiteboard inside the WebView, or only reports it when the app cannot", async () => {
    startDiagramJob({ type: "note", pageId: PAGE.id }, "luna");
    pending[0].resolve(json(201, { page: WHITEBOARD }));
    await settle();
    openDiagramDialog(`note:${PAGE.id}`);
    expect(labels(dialog(true))).toEqual(["Close"]);
    bridge.canOpen = true;
    dispatchEvent.mockClear();
    click(byLabel(dialog(true), "Open whiteboard"));
    // 出来たときにアプリへ一覧の読み直しを頼み、「開く」でそのページを開いてもらう。
    expect(bridge.posted).toEqual([{ type: "pagesChanged" }, { type: "openPage", id: WHITEBOARD.id }]);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it("retries with the same request and copies the diagram source when it could not be converted", async () => {
    startDiagramJob({ type: "answer", sessionId: SESSION, messageId: SAVED }, "luna");
    pending[0].resolve(json(422, { error: "Could not turn this into an editable diagram.", code: "diagram_invalid", source: "flowchart TD\nA-->B" }));
    await settle();
    openDiagramDialog(key);
    const tree = dialog();
    expect(textOf(tree)).toContain("Could not turn this into an editable diagram.");
    expect(labels(tree)).toEqual(["Close", "Copy diagram source", "Try again"]);
    click(byLabel(tree, "Copy diagram source"));
    expect(writeClipboardText).toHaveBeenCalledWith("flowchart TD\nA-->B");
    click(byLabel(tree, "Try again"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [first, second] = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as unknown);
    expect(second).toEqual(first);
  });

  it("shows the generic failure without a copy button", async () => {
    startDiagramJob({ type: "answer", sessionId: SESSION, messageId: SAVED }, "luna");
    pending[0].resolve(json(503, { error: "Could not draw a diagram. Try again." }));
    await settle();
    openDiagramDialog(key);
    expect(labels(dialog())).toEqual(["Close", "Try again"]);
  });

  it("explains that the note must be saved first, without starting", () => {
    openDiagramDialog(`note:${PAGE.id}`, UNSAVED_NOTE);
    const tree = dialog();
    expect(textOf(tree)).toContain(UNSAVED_NOTE);
    expect(labels(tree)).toEqual(["Close"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
