import { describe, expect, it } from "vitest";
import { creatablePageKinds, PAGE_KIND_FEATURES, type PageKind } from "@/lib/page-kinds";
import { canDropIn, sectionKindOf, showsImportMarkdownForFilter, workspaceCreateKinds, workspaceSections } from "@/lib/workspace-sections";

// ワークスペースのサイドバーとホームの分区（#168）：プロジェクトなしの最上位を種類ごとに分ける。
const page = (id: string, kind: PageKind | undefined, extra: { parentId?: string | null; groupId?: string | null; position?: number } = {}) =>
  ({ id, kind, parentId: extra.parentId ?? null, groupId: extra.groupId ?? null, position: extra.position ?? 0, createdAt: `2026-11-0${id.length}T00:00:00Z` });
const all: PageKind[] = ["note", "whiteboard", "slides"];

describe("workspace sections", () => {
  it("puts top-level pages without a project into the section of their kind, in list order, with sub-pages counted", () => {
    const pages = [
      page("n1", "note", { position: 1 }), page("n2", undefined, { position: 0 }),
      page("w1", "whiteboard"), page("s1", "slides"),
      // サブページは種類にかかわらず親の下（自分の分区には出ない）。
      page("w2", "whiteboard", { parentId: "n1" }), page("n3", "note", { parentId: "w1" }),
      // プロジェクトの中は分区に出ない。消えたプロジェクトの groupId はプロジェクトなし。
      page("s2", "slides", { groupId: "g1" }), page("s3", "slides", { groupId: "gone" }),
    ];
    const sections = workspaceSections(pages, [{ id: "g1" }], all);
    expect(sections.map((section) => section.kind)).toEqual(["note", "whiteboard", "slides"]);
    expect(sections[0].roots.map((p) => p.id)).toEqual(["n2", "n1"]);
    expect(sections[0].count).toBe(3);
    expect(sections[1].roots.map((p) => p.id)).toEqual(["w1"]);
    expect(sections[1].count).toBe(2);
    expect(sections[2].roots.map((p) => p.id)).toEqual(["s3", "s1"]);
    expect(sections[2].count).toBe(2);
  });

  it("lists pages of kinds that can't be created yet in the Notes section, so no page disappears", () => {
    const pages = [page("n1", "note"), page("w1", "whiteboard"), page("s1", "slides")];
    const sections = workspaceSections(pages, [], ["note"]);
    expect(sections).toHaveLength(1);
    expect(sections[0].roots.map((p) => p.id).sort()).toEqual(["n1", "s1", "w1"]);
    expect(sectionKindOf({ kind: "whiteboard" }, ["note"])).toBe("note");
    expect(sectionKindOf({ kind: "whiteboard" }, all)).toBe("whiteboard");
    expect(sectionKindOf({}, all)).toBe("note");
  });

  it("stops at broken cyclic data instead of looping", () => {
    const pages = [page("a", "note", { parentId: "b" }), page("b", "note", { parentId: "a" }), page("c", "note")];
    expect(workspaceSections(pages, [], all)[0]).toMatchObject({ count: 1 });
  });

  it("lets a page be dropped only into its own section, and anywhere without a section", () => {
    expect(canDropIn("note", "note")).toBe(true);
    expect(canDropIn("whiteboard", "note")).toBe(false);
    expect(canDropIn("whiteboard", undefined)).toBe(true);
    expect(canDropIn(undefined, "note")).toBe(false);
  });

  it("offers notes first, then whiteboards, then slides, when their editors are on", () => {
    expect(creatablePageKinds()[0]).toBe("note");
    expect(creatablePageKinds().every((kind) => PAGE_KIND_FEATURES[kind].editor)).toBe(true);
    const on = { ...PAGE_KIND_FEATURES, whiteboard: { ...PAGE_KIND_FEATURES.whiteboard, editor: true }, slides: { ...PAGE_KIND_FEATURES.slides, editor: true } };
    expect(creatablePageKinds(on)).toEqual(["note", "whiteboard", "slides"]);
    const off = { ...PAGE_KIND_FEATURES, note: { ...PAGE_KIND_FEATURES.note, editor: false } };
    expect(creatablePageKinds(off)[0]).toBe("note");
  });

  it("narrows home creation cards and Import Markdown visibility to the active filter", () => {
    expect(workspaceCreateKinds(all, null)).toEqual(["note", "whiteboard", "slides"]);
    expect(workspaceCreateKinds(all, "note")).toEqual(["note"]);
    expect(workspaceCreateKinds(all, "whiteboard")).toEqual(["whiteboard"]);
    expect(workspaceCreateKinds(all, "slides")).toEqual(["slides"]);

    expect(showsImportMarkdownForFilter(null)).toBe(true);
    expect(showsImportMarkdownForFilter("note")).toBe(true);
    expect(showsImportMarkdownForFilter("whiteboard")).toBe(false);
    expect(showsImportMarkdownForFilter("slides")).toBe(false);
  });
});
