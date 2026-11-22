import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Dictionary } from "@blocknote/core";

const { mockLocale, createBlockNoteSpy, sideMenuControllerSpy } = vi.hoisted(() => ({
  mockLocale: { current: "en" as "en" | "ar" | "ja" },
  createBlockNoteSpy: vi.fn<(...args: unknown[]) => unknown>(() => ({ document: [{ id: "b1", type: "paragraph", content: [], children: [] }], focus: vi.fn(), setTextCursorPosition: vi.fn() })),
  sideMenuControllerSpy: vi.fn<(...args: unknown[]) => null>(() => null),
}));

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useCallback: vi.fn((fn: unknown) => fn),
  useEffect: vi.fn(),
  useImperativeHandle: vi.fn(),
  useMemo: vi.fn((fn: () => unknown) => fn()),
  useRef: vi.fn(() => ({ current: null })),
  useState: vi.fn(),
}));
vi.mock("@blocknote/ariakit/style.css", () => ({}));
vi.mock("@blocknote/ariakit", () => ({ BlockNoteView: ({ children }: { children: unknown }) => children }));
vi.mock("@blocknote/code-block", () => ({ codeBlockOptions: { supportedLanguages: { text: { name: "Plain Text" } } }, syntaxHighlighter: {} }));
vi.mock("@blocknote/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blocknote/react")>();
  return {
    ...actual,
    SideMenuController: sideMenuControllerSpy,
    useCreateBlockNote: createBlockNoteSpy,
  };
});
vi.mock("@/components/i18n-provider", () => ({
  useI18n: () => ({ locale: mockLocale.current, dir: mockLocale.current === "ar" ? "rtl" : "ltr", t: (key: string) => key }),
  useT: () => (key: string) => key,
}));
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ preference: "light", resolved: "light", setPreference: vi.fn() }),
}));

import NoteEditor from "./note-editor";
import { cachedBlockNoteDictionary, loadBlockNoteDictionary } from "@/lib/i18n/blocknote-locales";

type ElementLike = { type?: unknown; props?: Record<string, unknown> };

function findElement(node: unknown, predicate: (el: ElementLike) => boolean): ElementLike | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return null;
  }
  const el = node as ElementLike;
  if (el.type && predicate(el)) return el;
  return el.props && "children" in el.props ? findElement(el.props.children, predicate) : null;
}

describe("NoteEditor per-locale dictionary lazy loading and RTL side-menu placement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocale.current = "en";
  });

  it("renders NoteEditorBody synchronously on the first render for English without an async dictionary fetch", () => {
    vi.mocked(useState).mockImplementation((initial?: unknown): ReturnType<typeof useState> => [
      typeof initial === "function" ? initial() : initial,
      vi.fn(),
    ]);

    const tree = NoteEditor({ blocks: [], onChange: vi.fn(), editable: true, editorRef: null, onFocusTitle: vi.fn() }) as { type: (...args: unknown[]) => unknown; props: Record<string, unknown> };
    expect(typeof tree.type).toBe("function");
    const bodyTree = tree.type(tree.props);

    expect(createBlockNoteSpy).toHaveBeenCalledOnce();
    const sideMenu = findElement(bodyTree, (el) => el.type === sideMenuControllerSpy);
    expect(sideMenu?.props?.floatingUIOptions).toEqual({ useFloatingOptions: { placement: "left-start" } });
  });

  it("holds a safe loading state on first render for uncached non-English locales, then mounts with the localized dictionary and right-start in RTL", async () => {
    mockLocale.current = "ar";
    expect(cachedBlockNoteDictionary("ar")).toBeNull();

    const saved = { current: null as { locale: string; dictionary: Dictionary } | null };
    vi.mocked(useState).mockImplementation((initial?: unknown): ReturnType<typeof useState> => [
      saved.current ?? (typeof initial === "function" ? initial() : initial),
      (next: unknown) => { saved.current = next as { locale: string; dictionary: Dictionary }; },
    ]);

    const firstRender = NoteEditor({ blocks: [], onChange: vi.fn(), editable: true, editorRef: null, onFocusTitle: vi.fn() }) as { type: unknown; props: { className?: string; children?: unknown } };
    expect(firstRender.type).toBe("p");
    expect(firstRender.props.className).toBe("notes-loading");
    expect(createBlockNoteSpy).not.toHaveBeenCalled();

    // Run effect to trigger lazy load of Arabic dictionary.
    vi.mocked(useEffect).mock.calls[0][0]();
    const arDict = await loadBlockNoteDictionary("ar");
    await Promise.resolve();
    expect(saved.current?.dictionary).toBe(arDict);

    // Subsequent render mounts NoteEditorBody with Arabic dictionary and right-start side menu.
    const secondRender = NoteEditor({ blocks: [], onChange: vi.fn(), editable: true, editorRef: null, onFocusTitle: vi.fn() }) as { type: (...args: unknown[]) => unknown; props: Record<string, unknown> };
    expect(typeof secondRender.type).toBe("function");
    const bodyTree = secondRender.type(secondRender.props);

    expect(createBlockNoteSpy).toHaveBeenCalledWith(expect.objectContaining({
      dictionary: expect.objectContaining({ slash_menu: arDict.slash_menu }),
    }));
    const sideMenu = findElement(bodyTree, (el) => el.type === sideMenuControllerSpy);
    expect(sideMenu?.props?.floatingUIOptions).toEqual({ useFloatingOptions: { placement: "right-start" } });
  });
});
