import { beforeEach, describe, expect, it, vi } from "vitest";

// 公開共有の木に、公開用ビューがまだ無い種類（スライド）を出さないこと。その下のサブページも出さない。
// ホワイトボード（#152）は読み取り専用のビューがあるので、ノートと同じく公開できる。
const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), findMany: vi.fn(), queryRaw: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  databaseSchema: "notefable",
  prisma: { notePage: { findFirst: mocks.findFirst, findMany: mocks.findMany }, $queryRaw: mocks.queryRaw },
}));
import { generateShareToken, resolveOwnerShareState, resolvePublicShare } from "./note-share-server";

const token = generateShareToken();
const page = (id: string, extra: Record<string, unknown> = {}) => ({
  id, userId: "owner", kind: "note", parentId: null, title: id, icon: null, cover: null, coverPosition: null, blocks: [], fullWidth: false, smallText: false,
  font: "default", deletedAt: null, shareToken: null, shareEnabled: false, shareIncludeSubpages: true, shareExpiresAt: null, shareExcludeFromParent: false,
  updatedAt: new Date("2026-11-01T00:00:00Z"), ...extra,
});
const root = (extra: Record<string, unknown> = {}) => page("root", { shareToken: token, shareEnabled: true, ...extra });
const ancestor = (id: string, extra: Record<string, unknown> = {}) => ({ ...page(id), depth: 1, ...extra });

beforeEach(() => { vi.clearAllMocks(); mocks.findMany.mockResolvedValue([]); mocks.queryRaw.mockResolvedValue([]); });

describe("public share tree and page kinds", () => {
  it("lists only shareable kinds among the sub-pages", async () => {
    mocks.findFirst.mockResolvedValue(root());
    const resolved = await resolvePublicShare(token);
    expect(resolved?.page.id).toBe("root");
    expect(mocks.findMany.mock.calls[0][0].where).toMatchObject({ parentId: "root", deletedAt: null, shareExcludeFromParent: false, kind: { in: ["note", "whiteboard"] } });
  });

  it("does not publish a slide deck even when its share flag is set", async () => {
    mocks.findFirst.mockResolvedValue(root({ kind: "slides" }));
    expect(await resolvePublicShare(token)).toBeNull();
  });

  it("publishes a whiteboard and tells the page view its kind and the sub-pages' kinds", async () => {
    mocks.findFirst.mockResolvedValue(root({ kind: "whiteboard" }));
    mocks.findMany.mockResolvedValue([{ id: "n1", title: "Child", icon: null, kind: "note" }, { id: "w1", title: "Board", icon: null, kind: "whiteboard" }]);
    const resolved = await resolvePublicShare(token);
    expect(resolved?.page).toMatchObject({ id: "root", kind: "whiteboard" });
    expect(resolved?.breadcrumbs[0]).toMatchObject({ id: "root", kind: "whiteboard" });
    expect(resolved?.children).toEqual([{ id: "n1", title: "Child", icon: null, kind: "note" }, { id: "w1", title: "Board", icon: null, kind: "whiteboard" }]);
  });

  it("does not open a slide sub-page, nor a note that sits under a slide deck", async () => {
    mocks.findFirst.mockResolvedValueOnce(root()).mockResolvedValueOnce(page("deck", { kind: "slides", parentId: "root" }));
    expect(await resolvePublicShare(token, "deck")).toBeNull();

    mocks.findFirst.mockResolvedValueOnce(root()).mockResolvedValueOnce(page("child", { parentId: "deck" }));
    mocks.queryRaw.mockResolvedValueOnce([ancestor("deck", { kind: "slides", parentId: "root" }), ancestor("root", { depth: 2 })]);
    expect(await resolvePublicShare(token, "child")).toBeNull();

    // ホワイトボードの下のノートは開ける（ホワイトボードは公開できる種類）。
    mocks.findFirst.mockResolvedValueOnce(root()).mockResolvedValueOnce(page("child", { parentId: "board" }));
    mocks.queryRaw.mockResolvedValueOnce([ancestor("board", { kind: "whiteboard", parentId: "root" }), ancestor("root", { depth: 2 })]);
    expect((await resolvePublicShare(token, "child"))?.page.id).toBe("child");

    // ノートだけの道筋なら、これまでどおり開ける。
    mocks.findFirst.mockResolvedValueOnce(root()).mockResolvedValueOnce(page("child", { parentId: "mid" }));
    mocks.queryRaw.mockResolvedValueOnce([ancestor("mid", { parentId: "root" }), ancestor("root", { depth: 2 })]);
    expect((await resolvePublicShare(token, "child"))?.page.id).toBe("child");
  });

  it("does not report a page as published through its parent when a slide deck is in between, or when the page itself is a slide deck", async () => {
    const shared = ancestor("root", { shareToken: token, shareEnabled: true, depth: 2 });
    mocks.findFirst.mockResolvedValue(page("child", { parentId: "deck" }));
    mocks.queryRaw.mockResolvedValue([ancestor("deck", { kind: "slides", parentId: "root" }), shared]);
    expect((await resolveOwnerShareState("owner", "child", "https://example.com"))?.inheritedFrom).toBeNull();

    mocks.findFirst.mockResolvedValue(page("deck", { kind: "slides", parentId: "root" }));
    mocks.queryRaw.mockResolvedValue([shared]);
    expect((await resolveOwnerShareState("owner", "deck", "https://example.com"))?.inheritedFrom).toBeNull();

    // ホワイトボードは親の公開を受け継ぐ。
    mocks.findFirst.mockResolvedValue(page("board", { kind: "whiteboard", parentId: "root" }));
    mocks.queryRaw.mockResolvedValue([shared]);
    expect((await resolveOwnerShareState("owner", "board", "https://example.com"))?.inheritedFrom).toMatchObject({ id: "root" });

    mocks.findFirst.mockResolvedValue(page("child", { parentId: "root" }));
    mocks.queryRaw.mockResolvedValue([shared]);
    expect((await resolveOwnerShareState("owner", "child", "https://example.com"))?.inheritedFrom).toMatchObject({ id: "root" });
  });
});
