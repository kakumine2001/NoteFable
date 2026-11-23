import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "./route";

const db = vi.hoisted(() => ({ pages: vi.fn(), groups: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getOrCreateUser: async () => ({ id: "owner" }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: { notePage: { findMany: db.pages }, noteGroup: { findMany: db.groups } },
}));

beforeEach(() => {
  vi.clearAllMocks();
  db.pages.mockResolvedValue([]);
  db.groups.mockResolvedValue([]);
});

it("reads only the four most recently edited live note summaries for this user", async () => {
  const response = await GET(new Request("http://localhost/api/pages?recent=1"));
  expect(db.pages).toHaveBeenCalledWith({
    where: { userId: "owner", deletedAt: null },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 4,
    select: { id: true, kind: true, title: true, icon: true, updatedAt: true },
  });
  expect(db.groups).not.toHaveBeenCalled();
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ pages: [] });
});

it("keeps the full pages and groups response for the editor and attachment picker", async () => {
  const response = await GET(new Request("http://localhost/api/pages"));
  expect(db.pages.mock.calls[0][0]).not.toHaveProperty("take");
  expect(db.groups).toHaveBeenCalledOnce();
  expect(await response.json()).toEqual({ pages: [], groups: [] });
});
