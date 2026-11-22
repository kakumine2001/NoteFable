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
      select: { title: true, blocks: true },
    });
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
