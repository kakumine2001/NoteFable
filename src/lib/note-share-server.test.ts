import { beforeEach, describe, expect, it, vi } from "vitest";

// 公開共有の木には、公開用のビューがある種類（ノート・ホワイトボード・スライド）だけを出す。スライドは葉（その下のサブページは出さない）。
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
    expect(mocks.findMany.mock.calls[0][0].where).toMatchObject({ parentId: "root", deletedAt: null, shareExcludeFromParent: false, kind: { in: ["note", "whiteboard", "slides"] } });
  });

  it("publishes a whiteboard like a note (its body is read by the public view)", async () => {
    mocks.findFirst.mockResolvedValue(root({ kind: "whiteboard" }));
    const resolved = await resolvePublicShare(token);
    expect(resolved?.page).toMatchObject({ id: "root", kind: "whiteboard", data: null });
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

  it("publishes a whiteboard and tells the page view its kind and the sub-pages' kinds", async () => {
    mocks.findFirst.mockResolvedValue(root({ kind: "whiteboard" }));
    mocks.findMany.mockResolvedValue([{ id: "n1", title: "Child", icon: null, kind: "note" }, { id: "w1", title: "Board", icon: null, kind: "whiteboard" }]);
    const resolved = await resolvePublicShare(token);
    expect(resolved?.page).toMatchObject({ id: "root", kind: "whiteboard" });
    expect(resolved?.breadcrumbs[0]).toMatchObject({ id: "root", kind: "whiteboard" });
    expect(resolved?.children).toEqual([{ id: "n1", title: "Child", icon: null, kind: "note" }, { id: "w1", title: "Board", icon: null, kind: "whiteboard" }]);
  });

  it("opens a slide deck as a page of the share but not a note under it, while a note under a whiteboard opens", async () => {
    mocks.findFirst.mockResolvedValueOnce(root()).mockResolvedValueOnce(page("deck", { kind: "slides", parentId: "root" }));
    expect((await resolvePublicShare(token, "deck"))?.page).toMatchObject({ id: "deck", kind: "slides" });

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

  it("never reports \"include sub-pages\" for a slide deck (publishing it does not save the pages below first)", async () => {
    mocks.findFirst.mockResolvedValue(page("deck", { kind: "slides", shareToken: token, shareEnabled: true, shareIncludeSubpages: true }));
    expect((await resolveOwnerShareState("owner", "deck", "https://example.com"))?.includeSubpages).toBe(false);
  });

  it("does not report a page as published through its parent when a slide deck is in between, but a deck or a whiteboard under the shared page inherits it", async () => {
    const shared = ancestor("root", { shareToken: token, shareEnabled: true, depth: 2 });
    mocks.findFirst.mockResolvedValue(page("child", { parentId: "deck" }));
    mocks.queryRaw.mockResolvedValue([ancestor("deck", { kind: "slides", parentId: "root" }), shared]);
    expect((await resolveOwnerShareState("owner", "child", "https://example.com"))?.inheritedFrom).toBeNull();

    // スライドそのものは、親の公開を受け継ぐ（公開リンクの中の 1 ページとして開く。その下は出さない）。
    mocks.findFirst.mockResolvedValue(page("deck", { kind: "slides", parentId: "root" }));
    mocks.queryRaw.mockResolvedValue([shared]);
    expect((await resolveOwnerShareState("owner", "deck", "https://example.com"))?.inheritedFrom).toMatchObject({ id: "root" });

    // ホワイトボードは親の公開を受け継ぐ。
    mocks.findFirst.mockResolvedValue(page("board", { kind: "whiteboard", parentId: "root" }));
    mocks.queryRaw.mockResolvedValue([shared]);
    expect((await resolveOwnerShareState("owner", "board", "https://example.com"))?.inheritedFrom).toMatchObject({ id: "root" });

    mocks.findFirst.mockResolvedValue(page("child", { parentId: "root" }));
    mocks.queryRaw.mockResolvedValue([shared]);
    expect((await resolveOwnerShareState("owner", "child", "https://example.com"))?.inheritedFrom).toMatchObject({ id: "root" });
  });
});
