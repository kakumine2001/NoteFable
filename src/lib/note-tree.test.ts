import { describe, expect, it } from "vitest";
import { ancestorsOf, canMoveInto, childrenByParent, descendantIdsOf, duplicateTitle, rootPages } from "./note-tree";

const page = (id: string, parentId: string | null, position = 0) => ({ id, parentId, position, createdAt: "2026-01-01T00:00:00.000Z" });
// a ─ b ─ c、a ─ d、e（最上位）、f（親が一覧にない：最上位として扱う）
const pages = [page("a", null, 1), page("b", "a", 2), page("c", "b", 3), page("d", "a", 4), page("e", null, 5), page("f", "gone", 6)];

describe("note tree helpers", () => {
  it("groups children under their parent in list order and treats orphans as top level", () => {
    const children = childrenByParent(pages);
    expect(children.get(null)!.map((item) => item.id)).toEqual(["a", "e", "f"]);
    expect(children.get("a")!.map((item) => item.id)).toEqual(["b", "d"]);
    expect(rootPages(pages).map((item) => item.id)).toEqual(["a", "e", "f"]);
  });

  it("lists ancestors from the top and stops on broken cycles", () => {
    expect(ancestorsOf(pages, "c").map((item) => item.id)).toEqual(["a", "b"]);
    expect(ancestorsOf(pages, "a")).toEqual([]);
    const loop = [page("x", "y"), page("y", "x")];
    expect(ancestorsOf(loop, "x").map((item) => item.id)).toEqual(["y"]);
  });

  it("finds descendants and refuses moves into the page itself or its sub-pages", () => {
    expect([...descendantIdsOf(pages, "a")].sort()).toEqual(["b", "c", "d"]);
    expect(canMoveInto(pages, "a", "c")).toBe(false);
    expect(canMoveInto(pages, "a", "a")).toBe(false);
    expect(canMoveInto(pages, "c", "a")).toBe(true);
    expect(canMoveInto(pages, "b", "e")).toBe(true);
  });

  it("names a duplicate like Notion and keeps it within the title limit", () => {
    expect(duplicateTitle("Plan")).toBe("Plan (1)");
    expect(duplicateTitle("x".repeat(200))).toHaveLength(200);
  });
});
