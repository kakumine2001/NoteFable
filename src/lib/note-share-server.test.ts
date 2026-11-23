import { beforeEach, describe, expect, it, vi } from "vitest";

// 公開共有の木に、公開用ビューがまだ無い種類（ホワイトボード・スライド）を出さないこと。その下のサブページも出さない。
const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), findMany: vi.fn(), queryRaw: vi.fn(), canvasFindFirst: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  databaseSchema: "notefable",
  prisma: { notePage: { findFirst: mocks.findFirst, findMany: mocks.findMany }, noteCanvas: { findFirst: mocks.canvasFindFirst }, $queryRaw: mocks.queryRaw },
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
    expect(mocks.findMany.mock.calls[0][0].where).toMatchObject({ parentId: "root", deletedAt: null, shareExcludeFromParent: false, kind: { in: ["note", "slides"] } });
  });

  it("does not publish a whiteboard even when its share flag is set", async () => {
    mocks.findFirst.mockResolvedValue(root({ kind: "whiteboard" }));
    expect(await resolvePublicShare(token)).toBeNull();
  });

  it("publishes a slide deck as a leaf: its body, no sub-pages, and nothing below it", async () => {
    const deck = { slides: [{ id: "s1", elements: [] }] };
    mocks.canvasFindFirst.mockResolvedValue({ data: deck });
    mocks.findFirst.mockResolvedValue(root({ kind: "slides" }));
    const resolved = await resolvePublicShare(token);
    expect(resolved?.page).toMatchObject({ id: "root", kind: "slides", data: deck });
    expect(resolved?.children).toEqual([]);
    expect(mocks.findMany).not.toHaveBeenCalled();
    // A deck's own sub-pages are never public, even with "include sub-pages".
    // (It is refused before the sub-page is read, so only the deck is queued.)
    mocks.findFirst.mockResolvedValueOnce(root({ kind: "slides" }));
    expect(await resolvePublicShare(token, "child")).toBeNull();
    expect(mocks.findFirst).toHaveBeenCalledTimes(2);
    // A page under a deck inside a shared note is not reachable either.
    mocks.findFirst.mockResolvedValueOnce(root()).mockResolvedValueOnce(page("child", { parentId: "deck" }));
    mocks.queryRaw.mockResolvedValueOnce([ancestor("deck", { kind: "slides", parentId: "root" }), ancestor("root", { depth: 2 })]);
    expect(await resolvePublicShare(token, "child")).toBeNull();
    // A deck under a shared note opens as a page of that share.
    mocks.findFirst.mockResolvedValueOnce(root()).mockResolvedValueOnce(page("deck", { kind: "slides", parentId: "root" }));
    expect((await resolvePublicShare(token, "deck"))?.page).toMatchObject({ id: "deck", kind: "slides", data: deck });
  });

  it("does not open a whiteboard sub-page, nor a note that sits under a whiteboard", async () => {
    mocks.findFirst.mockResolvedValueOnce(root()).mockResolvedValueOnce(page("board", { kind: "whiteboard", parentId: "root" }));
    expect(await resolvePublicShare(token, "board")).toBeNull();

    mocks.findFirst.mockResolvedValueOnce(root()).mockResolvedValueOnce(page("child", { parentId: "board" }));
    mocks.queryRaw.mockResolvedValueOnce([ancestor("board", { kind: "whiteboard", parentId: "root" }), ancestor("root", { depth: 2 })]);
    expect(await resolvePublicShare(token, "child")).toBeNull();

    // ノートだけの道筋なら、これまでどおり開ける。
    mocks.findFirst.mockResolvedValueOnce(root()).mockResolvedValueOnce(page("child", { parentId: "mid" }));
    mocks.queryRaw.mockResolvedValueOnce([ancestor("mid", { parentId: "root" }), ancestor("root", { depth: 2 })]);
    expect((await resolvePublicShare(token, "child"))?.page.id).toBe("child");
  });

  it("does not report a page as published through its parent when a whiteboard is in between, or when the page itself is a whiteboard", async () => {
    const shared = ancestor("root", { shareToken: token, shareEnabled: true, depth: 2 });
    mocks.findFirst.mockResolvedValue(page("child", { parentId: "board" }));
    mocks.queryRaw.mockResolvedValue([ancestor("board", { kind: "whiteboard", parentId: "root" }), shared]);
    expect((await resolveOwnerShareState("owner", "child", "https://example.com"))?.inheritedFrom).toBeNull();

    mocks.findFirst.mockResolvedValue(page("board", { kind: "whiteboard", parentId: "root" }));
    mocks.queryRaw.mockResolvedValue([shared]);
    expect((await resolveOwnerShareState("owner", "board", "https://example.com"))?.inheritedFrom).toBeNull();

    mocks.findFirst.mockResolvedValue(page("child", { parentId: "root" }));
    mocks.queryRaw.mockResolvedValue([shared]);
    expect((await resolveOwnerShareState("owner", "child", "https://example.com"))?.inheritedFrom).toMatchObject({ id: "root" });
  });
});
