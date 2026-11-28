import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ states: [] as unknown[], effects: [] as (() => void | (() => void))[] }));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useCallback: <T,>(fn: T) => fn,
    useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
    useId: () => "ai-gen-test-id",
    useRef: (initial: unknown) => ({ current: initial }),
    useState: (initial: unknown) => {
      const value = hooks.states.length ? hooks.states.shift() : typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [value, vi.fn()];
    },
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  };
});
vi.mock("@/components/i18n-provider", () => ({
  useT: () => (key: string, vars?: Record<string, unknown>) =>
    key.replace(/\{(\w+)\}/g, (match, name: string) => String(vars?.[name] ?? match)),
}));
vi.mock("@/lib/account-store", () => ({
  useAccount: () => ({ account: { configured: true, billing: true, user: null } }),
}));
vi.mock("@/lib/use-back-to-close", () => ({ useBackToClose: vi.fn() }));
const bridge = vi.hoisted(() => ({ canOpen: true, canShowAiGenerate: false, canShowUsageLimit: false, canShowStorageLimit: false, posted: [] as unknown[] }));
vi.mock("@/lib/native-bridge", () => ({
  nativeCanOpenPage: () => bridge.canOpen,
  nativeCanShowAiGenerate: () => bridge.canShowAiGenerate,
  nativeCanShowUsageLimit: () => bridge.canShowUsageLimit,
  nativeCanShowStorageLimit: () => bridge.canShowStorageLimit,
  postToNative: (message: unknown) => { bridge.posted.push(message); return true; },
}));

import { AiGenerateHost, WorkspaceAiEntry } from "./ai-generate-panel";
import {
  closeAiGenerate,
  getAiGenerate,
  openAiGenerate,
  resetAiGenerate,
  submitAiGenerate,
  updateAiGenerateDraft,
} from "@/lib/ai-generate-jobs";

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
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  return textOf((node as AnyElement).props?.children as ReactNode);
}
const names = (tree: ReactNode) => elements(tree).map((el) => (typeof el.type === "function" ? el.type.name : ""));

function renderHost(embedded = false) {
  const host = AiGenerateHost({ embedded, kinds: ["note", "whiteboard", "slides"] }) as AnyElement | null;
  if (!host) return null;
  hooks.states = [];
  hooks.effects = [];
  return (host.type as (props: unknown) => ReactNode)(host.props);
}

const storage = new Map<string, string>();
const fetchMock = vi.fn();

beforeEach(() => {
  hooks.states = [];
  hooks.effects = [];
  bridge.canOpen = true;
  bridge.canShowAiGenerate = false;
  bridge.canShowUsageLimit = false;
  bridge.canShowStorageLimit = false;
  bridge.posted = [];
  storage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", {
    dispatchEvent: vi.fn(),
    matchMedia: () => ({ matches: false }),
  });
  vi.stubGlobal("localStorage", {
    get length() { return storage.size; },
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  });
  resetAiGenerate();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function flushMicrotasks() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe("AiGenerateHost & ai-generate-jobs", () => {
  it("opens unified panel in Note -> Whiteboard -> Slides order with zero Sparkles icons", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ scope: "scope-1" }));
    openAiGenerate({ kind: "whiteboard", prompt: "Map photosynthesis" });
    await flushMicrotasks();

    const tree = renderHost();
    expect(tree).not.toBeNull();
    expect(names(tree)).not.toContain("Sparkles");

    const view = getAiGenerate();
    expect(view?.phase).toBe("ready");
    if (view?.phase === "ready") {
      expect(view.draft.kind).toBe("whiteboard");
      expect(view.draft.prompt).toBe("Map photosynthesis");
    }

    // Switching kind keeps the typed prompt intact.
    updateAiGenerateDraft((draft) => ({ ...draft, kind: "slides" }));
    const afterSwitch = getAiGenerate();
    expect(afterSwitch?.phase === "ready" && afterSwitch.draft.prompt).toBe("Map photosynthesis");
  });

  it("generates a note via /api/pages/generate and prevents duplicate submit while working", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ scope: "scope-1" }));
    openAiGenerate({ kind: "note", prompt: "Study guide for optics" });
    await flushMicrotasks();

    let resolvePost!: (res: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolvePost = resolve; }));

    const first = submitAiGenerate();
    const second = submitAiGenerate(); // double-submit while working must be ignored
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 GET scope + 1 POST generate

    resolvePost(Response.json({ page: { id: "cnote1", kind: "note", title: "Optics Guide" } }, { status: 201 }));
    await Promise.all([first, second]);

    const view = getAiGenerate();
    expect(view?.phase).toBe("ready");
    if (view?.phase === "ready") {
      expect(view.job).toMatchObject({ state: "done", kind: "note", page: { id: "cnote1", title: "Optics Guide" } });
    }
  });

  it("reuses slides outline and deck routes without losing user prompt text", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ scope: "scope-1" }));
    openAiGenerate({ kind: "slides", prompt: "Solar system exploration" });
    await flushMicrotasks();

    fetchMock.mockResolvedValueOnce(Response.json({
      outline: { title: "Solar System", slides: [{ title: "Inner Planets", points: ["Mercury to Mars"] }] },
    }));
    await submitAiGenerate();

    const afterOutline = getAiGenerate();
    expect(afterOutline?.phase).toBe("ready");
    if (afterOutline?.phase === "ready") {
      expect(afterOutline.draft.slidesStep).toBe("outline");
      expect(afterOutline.draft.prompt).toBe("Solar system exploration");
      expect(afterOutline.draft.slidesOutline?.title).toBe("Solar System");
    }

    fetchMock.mockResolvedValueOnce(Response.json({
      page: { id: "cslide1", kind: "slides", title: "Solar System" },
    }, { status: 201 }));
    await submitAiGenerate();

    const afterDeck = getAiGenerate();
    expect(afterDeck?.phase).toBe("ready");
    if (afterDeck?.phase === "ready") {
      expect(afterDeck.job).toMatchObject({ state: "done", kind: "slides", page: { id: "cslide1" } });
    }
    closeAiGenerate();
  });

  it("preserves a rejected limit draft kind when reopened without a new prompt", async () => {
    const session = new Map<string, string>();
    const sessionStorageMock = {
      getItem: (key: string) => session.get(key) ?? null,
      setItem: (key: string, value: string) => { session.set(key, value); },
      removeItem: (key: string) => { session.delete(key); },
    };
    vi.stubGlobal("sessionStorage", sessionStorageMock);
    (window as unknown as Record<string, unknown>).sessionStorage = sessionStorageMock;
    fetchMock.mockResolvedValueOnce(Response.json({ scope: "scope-1" }));
    openAiGenerate({ kind: "whiteboard", prompt: "TCP handshake" });
    await flushMicrotasks();

    fetchMock.mockResolvedValueOnce(Response.json({ error: "Limit reached", code: "usage_limit", tier: "guest" }, { status: 429 }));
    await submitAiGenerate();

    // Simulate reload / post-sign-in reopen with default kind="note" and no new prompt.
    resetAiGenerate();
    fetchMock.mockResolvedValueOnce(Response.json({ scope: "scope-2" }));
    openAiGenerate({ kind: "note" });
    await flushMicrotasks();

    const recovered = getAiGenerate();
    expect(recovered?.phase).toBe("ready");
    if (recovered?.phase === "ready") {
      expect(recovered.draft.kind).toBe("whiteboard");
      expect(recovered.draft.prompt).toBe("TCP handshake");
    }
  });

  it("renders WorkspaceAiEntry with Note -> Whiteboard -> Slides pills and zero Sparkles icons", () => {
    const onOpen = vi.fn();
    const tree = WorkspaceAiEntry({
      kinds: ["note", "slides", "whiteboard"],
      activeFilter: "whiteboard",
      busy: false,
      onOpen,
    });
    expect(names(tree)).not.toContain("Sparkles");
    const radios = elements(tree).filter((el) => el.props?.role === "radio");
    expect(radios.map((el) => textOf(el).trim())).toEqual(["Note", "Whiteboard", "Slides"]);
    expect(radios[1].props["aria-checked"]).toBe(true);
  });
});
