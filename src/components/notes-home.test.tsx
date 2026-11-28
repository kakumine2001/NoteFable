import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ states: [] as unknown[] }));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useCallback: <T,>(fn: T) => fn,
    useEffect: vi.fn(),
    useId: () => "home-test-id",
    useRef: (initial: unknown) => ({ current: initial }),
    useState: (initial: unknown) => [
      hooks.states.length ? hooks.states.shift() : (typeof initial === "function" ? (initial as () => unknown)() : initial),
      vi.fn(),
    ],
  };
});
vi.mock("@/components/i18n-provider", () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      key.replace(/\{(\w+)\}/g, (match, name: string) => String(vars?.[name] ?? match)),
    tag: "en-US",
  }),
  useT: () => (key: string, vars?: Record<string, unknown>) =>
    key.replace(/\{(\w+)\}/g, (match, name: string) => String(vars?.[name] ?? match)),
}));
vi.mock("@/lib/use-expanded-pages", () => ({
  useExpandedPages: () => [{}, vi.fn()],
}));

import { NewPageButtons, NotesHome } from "./notes-home";
import type { PageKind } from "@/lib/page-kinds";
import type { NoteGroupSummary, NotePageSummary } from "@/types/notes";

type AnyElement = ReactElement<Record<string, unknown>>;

const INLINE = new Set(["NewPageButtons", "WorkspaceAiEntry"]);

function elements(node: ReactNode): AnyElement[] {
  const found: AnyElement[] = [];
  const visit = (item: ReactNode) => {
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) { item.forEach(visit); return; }
    const el = item as AnyElement;
    if (typeof el.type === "function" && INLINE.has(el.type.name)) {
      visit((el.type as (props: unknown) => ReactNode)(el.props));
      return;
    }
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
  if (typeof el.type === "function" && INLINE.has(el.type.name)) {
    return textOf((el.type as (props: unknown) => ReactNode)(el.props));
  }
  return textOf(el.props?.children as ReactNode);
}

const byClass = (tree: ReactNode, className: string) =>
  elements(tree).filter((el) => typeof el.props.className === "string" && el.props.className.split(/\s+/).includes(className));

const makePage = (
  id: string,
  kind: PageKind,
  title: string,
  extra: Partial<NotePageSummary> = {},
): NotePageSummary => ({
  id,
  kind,
  title,
  icon: null,
  version: 1,
  groupId: null,
  parentId: null,
  position: 0,
  favoritedAt: null,
  createdAt: "2026-11-20T00:00:00.000Z",
  updatedAt: "2026-11-28T00:00:00.000Z",
  ...extra,
});

const GROUPS: NoteGroupSummary[] = [
  { id: "g1", name: "Biology", position: 0 },
  { id: "g2", name: "Empty Project", position: 1 },
];

const PAGES: NotePageSummary[] = [
  makePage("n1", "note", "Cell Notes", { groupId: "g1", updatedAt: "2026-11-28T03:00:00.000Z", favoritedAt: "2026-11-25T00:00:00.000Z" }),
  makePage("w1", "whiteboard", "Cell Map", { groupId: "g1", updatedAt: "2026-11-28T04:00:00.000Z", favoritedAt: "2026-11-26T00:00:00.000Z" }),
  makePage("n2", "note", "Loose Note", { updatedAt: "2026-11-28T02:00:00.000Z" }),
  makePage("w2", "whiteboard", "Loose Board", { updatedAt: "2026-11-28T05:00:00.000Z" }),
  makePage("s1", "slides", "Review Deck", { updatedAt: "2026-11-28T01:00:00.000Z" }),
];

// NotesHome useState order: recentScroll, moving, creatingGroup, kindFilter, openedAt.
function renderHome(kindFilter: PageKind | null, pages = PAGES, groups = GROUPS) {
  hooks.states = [
    { prev: false, next: false },
    null,
    false,
    kindFilter,
    Date.parse("2026-11-28T06:00:00.000Z"),
  ];
  return NotesHome({
    pages,
    groups,
    groupError: "",
    busy: false,
    onOpen: vi.fn(),
    onCreate: vi.fn(),
    onGenerate: vi.fn(),
    onImportPptx: vi.fn(),
    onImport: vi.fn(),
    onWorkspaceChange: vi.fn(),
    onMoveNote: vi.fn(),
    onCreateGroup: vi.fn(),
    onReorder: vi.fn(),
    onMoveToPage: vi.fn(),
  });
}

beforeEach(() => {
  hooks.states = [];
});

describe("NotesHome page-type order and exclusive filters", () => {
  it("lists filter tabs, unified AI entry, create cards, and sections in Notes → Whiteboards → Slides order under All", () => {
    const tree = renderHome(null);
    expect(byClass(tree, "ws-filter-pill").map((el) => textOf(el).trim())).toEqual(["All", "Notes", "Whiteboards", "Slides"]);
    expect(byClass(tree, "ws-ai-kind-pill").map((el) => textOf(el).trim())).toEqual(["Note", "Whiteboard", "Slides"]);
    expect(byClass(tree, "ws-create-card").map((el) => textOf(el).trim())).toEqual(["New note", "New whiteboard", "New slide deck"]);
    expect(byClass(tree, "ws-create-actions")).toHaveLength(0);
    expect(byClass(tree, "ws-home-utils").flatMap((el) => elements(el).filter((c) => c.type === "button").map((c) => textOf(c).trim()))).toEqual([
      "New project",
      "Import Markdown",
      "Import PowerPoint",
    ]);
    expect(byClass(tree, "notes-recent-name").map((el) => textOf(el).trim())).toEqual([
      "Loose Board",
      "Cell Map",
      "Cell Notes",
      "Loose Note",
      "Review Deck",
    ]);
    // Uncategorized section headings follow Notes → Whiteboards → Slides after Favorites & Projects.
    const sectionTitles = byClass(tree, "notes-home-group").map((el) => textOf(el).replace(/\s+/g, " ").trim());
    expect(sectionTitles).toEqual(["Favorites 2", "Biology 2", "Empty Project 0", "Notes 1", "Whiteboards 1", "Slides 1"]);
  });

  it("shows only Notes items (plus New project, Import Markdown, and Note preselected in AI entry) under the Notes tab", () => {
    const tree = renderHome("note");
    expect(byClass(tree, "ws-create-card").map((el) => textOf(el).trim())).toEqual(["New note"]);
    expect(byClass(tree, "ws-create-actions")).toHaveLength(0);
    expect(byClass(tree, "ws-ai-kind-pill").find((el) => el.props["aria-checked"] === true)).toBeDefined();
    expect(textOf(byClass(tree, "ws-ai-kind-pill").find((el) => el.props["aria-checked"] === true)).trim()).toBe("Note");
    expect(byClass(tree, "ws-home-utils").flatMap((el) => elements(el).filter((c) => c.type === "button").map((c) => textOf(c).trim()))).toEqual([
      "New project",
      "Import Markdown",
    ]);
    expect(byClass(tree, "notes-recent-name").map((el) => textOf(el).trim())).toEqual(["Cell Notes", "Loose Note"]);
    const sectionTitles = byClass(tree, "notes-home-group").map((el) => textOf(el).replace(/\s+/g, " ").trim());
    expect(sectionTitles).toEqual(["Favorites 1", "Biology 1", "Notes 1"]);
  });

  it("shows only Whiteboards items (Whiteboard preselected in AI entry, Import Markdown and Import PowerPoint hidden) under Whiteboards", () => {
    const tree = renderHome("whiteboard");
    expect(byClass(tree, "ws-create-card").map((el) => textOf(el).trim())).toEqual(["New whiteboard"]);
    expect(byClass(tree, "ws-create-actions")).toHaveLength(0);
    expect(textOf(byClass(tree, "ws-ai-kind-pill").find((el) => el.props["aria-checked"] === true)).trim()).toBe("Whiteboard");
    expect(byClass(tree, "ws-home-utils").flatMap((el) => elements(el).filter((c) => c.type === "button").map((c) => textOf(c).trim()))).toEqual([
      "New project",
    ]);
    expect(byClass(tree, "notes-recent-name").map((el) => textOf(el).trim())).toEqual(["Loose Board", "Cell Map"]);
    const sectionTitles = byClass(tree, "notes-home-group").map((el) => textOf(el).replace(/\s+/g, " ").trim());
    expect(sectionTitles).toEqual(["Favorites 1", "Biology 1", "Whiteboards 1"]);
  });

  it("shows only Slides items plus Import PowerPoint (Slides preselected in AI entry, Import Markdown hidden) under Slides", () => {
    const tree = renderHome("slides");
    expect(byClass(tree, "ws-create-card").map((el) => textOf(el).trim())).toEqual(["New slide deck"]);
    expect(byClass(tree, "ws-create-actions")).toHaveLength(0);
    expect(textOf(byClass(tree, "ws-ai-kind-pill").find((el) => el.props["aria-checked"] === true)).trim()).toBe("Slides");
    expect(byClass(tree, "ws-home-utils").flatMap((el) => elements(el).filter((c) => c.type === "button").map((c) => textOf(c).trim()))).toEqual([
      "New project",
      "Import PowerPoint",
    ]);
    expect(byClass(tree, "notes-recent-name").map((el) => textOf(el).trim())).toEqual(["Review Deck"]);
    const sectionTitles = byClass(tree, "notes-home-group").map((el) => textOf(el).replace(/\s+/g, " ").trim());
    expect(sectionTitles).toEqual(["Slides 1"]);
  });

  it("hides Recently edited and shows empty-match notice when no pages of the selected type exist", () => {
    const onlyNotes = PAGES.filter((page) => page.kind === "note");
    const tree = renderHome("slides", onlyNotes, GROUPS);
    expect(byClass(tree, "ws-create-card").map((el) => textOf(el).trim())).toEqual(["New slide deck"]);
    expect(byClass(tree, "ws-home-utils").flatMap((el) => elements(el).filter((c) => c.type === "button").map((c) => textOf(c).trim()))).toEqual([
      "New project",
      "Import PowerPoint",
    ]);
    expect(byClass(tree, "notes-home-hero")).toHaveLength(0);
    expect(byClass(tree, "notes-recent-name")).toHaveLength(0);
    expect(textOf(tree)).toContain("No matching pages.");
  });

  it("keeps the legacy single-button mode only when deck is false", () => {
    const legacy = NewPageButtons({ kinds: ["note"], deck: false, busy: false, onCreate: vi.fn() });
    expect(byClass(legacy, "notes-empty-new")).toHaveLength(1);
    expect(byClass(legacy, "ws-create-card")).toHaveLength(0);
  });
});
