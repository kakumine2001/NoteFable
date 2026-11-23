import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getOrCreateUser: async () => ({ id: "user-1" }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    notePage: { findFirst: mocks.findFirst },
  },
}));

import { GET } from "./route";

describe("GET /api/pages/[pageId]/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the note does not exist, is in Trash, or belongs to another user", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/api/pages/p1/export"), { params: Promise.resolve({ pageId: "p1" }) });
    expect(response.status).toBe(404);
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: "p1", userId: "user-1", deletedAt: null },
      select: { kind: true, title: true, blocks: true },
    });
  });

  it("refuses whiteboards and slide decks with a message in the requester's language (old apps still show the menu item)", async () => {
    for (const kind of ["whiteboard", "slides"]) {
      mocks.findFirst.mockResolvedValue({ kind, title: "Board", blocks: [] });
      const response = await GET(new Request("http://localhost/api/pages/p1/export", { headers: { "accept-language": "zh-CN,zh;q=0.9" } }), { params: Promise.resolve({ pageId: "p1" }) });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toMatchObject({ code: "wrong_page_kind", kind });
      expect(body).not.toHaveProperty("markdown");
      expect(body.error).not.toBe("Only notes can be exported as Markdown.");
      expect(body.error).toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it("answers in English when the request asks for no supported language", async () => {
    mocks.findFirst.mockResolvedValue({ kind: "whiteboard", title: "Board", blocks: [] });
    const response = await GET(new Request("http://localhost/api/pages/p1/export"), { params: Promise.resolve({ pageId: "p1" }) });
    expect((await response.json()).error).toBe("Only notes can be exported as Markdown.");
  });

  it("exports an owned live note as Markdown with no-store cache headers", async () => {
    mocks.findFirst.mockResolvedValue({
      title: "Architecture",
      blocks: [
        { id: "b1", type: "paragraph", props: {}, content: [{ type: "text", text: "Clean design", styles: {} }], children: [] },
      ],
    });
    const response = await GET(new Request("http://localhost/api/pages/p1/export"), { params: Promise.resolve({ pageId: "p1" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      fileName: "Architecture.md",
      markdown: "# Architecture\n\nClean design\n",
    });
  });
});
