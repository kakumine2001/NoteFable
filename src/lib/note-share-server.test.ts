import { beforeEach, describe, expect, it, vi } from "vitest";

// 公開共有の木に、公開用ビューがまだ無い種類（ホワイトボード・スライド）を出さないこと。その下のサブページも出さない。
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
    expect(mocks.findMany.mock.calls[0][0].where).toMatchObject({ parentId: "root", deletedAt: null, shareExcludeFromParent: false, kind: { in: ["note"] } });
  });

  it("does not publish a whiteboard or slide deck even when its share flag is set", async () => {
    for (const kind of ["whiteboard", "slides"]) {
      mocks.findFirst.mockResolvedValue(root({ kind }));
      expect(await resolvePublicShare(token)).toBeNull();
    }
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
