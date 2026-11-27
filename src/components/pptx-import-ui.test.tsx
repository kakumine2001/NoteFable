import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ states: [] as unknown[], effects: [] as (() => void | (() => void))[] }));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useCallback: <T,>(fn: T) => fn,
    useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
    useId: () => "pptx-test-id",
    useRef: (initial: unknown) => ({ current: initial }),
    useState: (initial: unknown) => [hooks.states.length ? hooks.states.shift() : initial, vi.fn()],
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  };
});
vi.mock("@/components/i18n-provider", () => ({
  useT: () => (key: string, vars?: Record<string, unknown>) =>
    key.replace(/\{(\w+)\}/g, (match, name: string) => String(vars?.[name] ?? match)),
}));
vi.mock("@/lib/use-back-to-close", () => ({ useBackToClose: vi.fn() }));
const bridge = vi.hoisted(() => ({ canOpen: false, canShowImport: false, canShowStorageLimit: false, posted: [] as unknown[] }));
vi.mock("@/lib/native-bridge", () => ({
  nativeCanOpenPage: () => bridge.canOpen,
  nativeCanShowPptxImport: () => bridge.canShowImport,
  nativeCanShowStorageLimit: () => bridge.canShowStorageLimit,
  postToNative: (message: unknown) => { bridge.posted.push(message); return true; },
}));
const importerMock = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/slides/pptx-import", async (original) => {
  const actual = await original<typeof import("@/lib/slides/pptx-import")>();
  return { ...actual, importPptxFile: importerMock.run };
});

import { NewPageButton } from "./new-page-button";
import { NotePageMenu } from "./note-page-menu";
import { PptxImportHost } from "./pptx-import-dialog";
import { getPptxImport, openPptxImport, resetPptxImport, startPptxImport } from "@/lib/pptx-import-jobs";
import { StorageLimitError } from "@/lib/usage-plans";
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
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  return textOf((node as AnyElement).props?.children as ReactNode);
}
const buttons = (tree: ReactNode) => elements(tree).filter((el) => el.type === "button");
const labelOf = (el: AnyElement) => (textOf(el).trim() || String(el.props["aria-label"] ?? ""));
const labels = (tree: ReactNode) => buttons(tree).map(labelOf);
const byLabel = (tree: ReactNode, label: string) => buttons(tree).find((el) => labelOf(el) === label);
const click = (el: AnyElement | undefined) => (el?.props.onClick as () => void)();
const names = (tree: ReactNode) => elements(tree).map((el) => (typeof el.type === "function" ? el.type.name : ""));

function renderDialog(embedded = false) {
  const host = PptxImportHost({ embedded, groups: [] }) as AnyElement | null;
  if (!host) return null;
  hooks.states = [];
  hooks.effects = [];
  return (host.type as (props: unknown) => ReactNode)(host.props);
}

const SLIDE_PAGE = { id: "cslide01", kind: "slides", title: "Deck", icon: null, version: 1, groupId: null } as NotePageSummary;
const NOTE_PAGE = { id: "cnote01", kind: "note", title: "Doc", icon: null, version: 1, groupId: null } as NotePageSummary;

beforeEach(() => {
  hooks.states = [];
  hooks.effects = [];
  bridge.canOpen = false;
  bridge.canShowImport = false;
  bridge.canShowStorageLimit = false;
  bridge.posted = [];
  importerMock.run.mockReset();
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  resetPptxImport();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PptxImportHost dialog & entries", () => {
  it("shows compatibility boundary on pick screen, per-slide report after import, and uses zero Sparkles icons", async () => {
    expect(renderDialog()).toBeNull();
    openPptxImport();
    const pick = renderDialog();
    const pickText = textOf(pick);
    expect(pickText).toContain("Import PowerPoint");
    expect(pickText).toContain("Up to 50 MB and 200 slides.");
    expect(names(pick)).not.toContain("Sparkles");

    importerMock.run.mockResolvedValueOnce({
      page: SLIDE_PAGE,
      report: {
        slideCount: 4,
        uploadedImageCount: 2,
        totalUnsupported: 2,
        totalPreviews: 1,
        slides: [
          {
            slideNumber: 2,
            slideTitle: "Revenue",
            issues: [
              { kind: "chart", count: 1, previewCount: 1 },
              { kind: "animation", count: 1, previewCount: 0 },
            ],
          },
        ],
      },
    });

    await startPptxImport(new File([new Uint8Array([1])], "deck.pptx"));
    const done = renderDialog();
    const doneText = textOf(done);
    expect(doneText).toContain("Imported “Deck” (4 slides).");
    expect(doneText).toContain("Unsupported items by slide (2)");
    expect(doneText).toContain("Slide 2");
    expect(doneText).toContain("Revenue");
    expect(doneText).toContain("Chart (static preview placed)");
    expect(doneText).toContain("Animations");
    expect(names(done)).not.toContain("Sparkles");
    click(byLabel(done, "Open slides"));
    expect(getPptxImport()).toBeNull();
  });

  it("posts storageLimit and pptxImport open/closed to native bridge when embedded", async () => {
    openPptxImport();
    bridge.canShowImport = true;
    bridge.canShowStorageLimit = true;
    hooks.effects = [];
    PptxImportHost({ embedded: true });
    const cleanup = hooks.effects[0]() as () => void;
    expect(bridge.posted).toEqual([{ type: "pptxImport", state: "open" }]);

    importerMock.run.mockRejectedValueOnce(new StorageLimitError("Full", "member", 50, 100));
    await startPptxImport(new File([new Uint8Array([1])], "deck.pptx"));
    bridge.posted = [];
    renderDialog(true);
    hooks.effects.forEach((effect) => { if (String(effect).includes("storageLimit")) effect(); });
    expect(bridge.posted).toEqual([{ type: "storageLimit", tier: "member", used: 50, limit: 100 }]);
    cleanup();
  });

  it("shows Import PowerPoint in NewPageButton where slides can be created and in NotePageMenu for slides only", () => {
    const onImportPptx = vi.fn();
    hooks.states = [{ anchor: {}, trigger: {}, focusLast: false }];
    const all = NewPageButton({
      kinds: ["note", "slides", "whiteboard"], busy: false, onCreate: vi.fn(), onGenerate: vi.fn(), onImportPptx,
      className: "c", menuLabel: "New page", children: "+",
    });
    expect(labels(all)).toEqual(["+", "Note", "Slides", "Whiteboard", "Generate with AI", "Import PowerPoint"]);
    click(byLabel(all, "Import PowerPoint"));
    expect(onImportPptx).toHaveBeenCalledTimes(1);

    hooks.states = [{ anchor: {}, trigger: {}, focusLast: false }];
    const slidesOnly = NewPageButton({
      kinds: ["slides"], busy: false, onCreate: vi.fn(), onGenerate: vi.fn(), onImportPptx,
      className: "c", menuLabel: "New slide deck", children: "+",
    });
    expect(labels(slidesOnly)).toEqual(["+", "New slide deck", "Generate with AI", "Import PowerPoint"]);

    hooks.states = [{ anchor: {}, trigger: {}, focusLast: false }, false];
    const slideMenu = NotePageMenu({
      page: SLIDE_PAGE, busy: false, error: "", onSettings: vi.fn(), onFavorite: vi.fn(), onDuplicate: vi.fn(),
      onAddSubpage: vi.fn(), onImportPptx, onMove: vi.fn(), onExport: vi.fn(), onTrash: vi.fn(),
    });
    expect(labels(slideMenu)).toContain("Import PowerPoint");

    hooks.states = [{ anchor: {}, trigger: {}, focusLast: false }, false];
    const noteMenu = NotePageMenu({
      page: NOTE_PAGE, busy: false, error: "", onSettings: vi.fn(), onFavorite: vi.fn(), onDuplicate: vi.fn(),
      onAddSubpage: vi.fn(), onImportPptx, onMove: vi.fn(), onExport: vi.fn(), onTrash: vi.fn(),
    });
    expect(labels(noteMenu)).not.toContain("Import PowerPoint");
  });
});
