import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), count: vi.fn(), pageUpdateMany: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getOrCreateAnonymousUser: async () => ({ id: "mine" }) }));
vi.mock("@/lib/prisma", () => {
  const noteGroup = { aggregate: mocks.aggregate, create: mocks.create, updateMany: mocks.updateMany, deleteMany: mocks.deleteMany, count: mocks.count };
  const notePage = { updateMany: mocks.pageUpdateMany };
  return { prisma: { noteGroup, notePage, $transaction: async (fn: (tx: unknown) => unknown) => fn({ noteGroup, notePage }) } };
});
import { PUT } from "../[pageId]/group/route";
import { DELETE, PATCH } from "./[groupId]/route";
import { POST } from "./route";

const json = (body: unknown, method = "POST") => new Request("http://localhost/api/pages/groups", { method, body: JSON.stringify(body) });
const groupContext = { params: Promise.resolve({ groupId: "g1" }) };
const pageContext = { params: Promise.resolve({ pageId: "p1" }) };

describe("note groups", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("creates a group at the end of the user's list with a cleaned name", async () => {
    mocks.aggregate.mockResolvedValue({ _count: 2, _max: { position: 5 } });
    mocks.create.mockImplementation(async ({ data }) => ({ id: "g9", name: data.name, position: data.position }));
    const response = await POST(json({ name: "  Work   notes " }));
    expect(response.status).toBe(201);
    expect(mocks.create.mock.calls[0][0].data).toEqual({ userId: "mine", name: "Work notes", position: 6 });
    expect((await response.json()).group).toEqual({ id: "g9", name: "Work notes", position: 6 });
  });

  it("rejects empty, over-long and non-string names, and a 51st group", async () => {
    for (const name of ["", "   ", "x".repeat(61), 5, null]) expect((await POST(json({ name }))).status).toBe(400);
    expect((await POST(new Request("http://localhost/x", { method: "POST", body: "not json" }))).status).toBe(400);
    mocks.aggregate.mockResolvedValue({ _count: 50, _max: { position: 49 } });
    expect((await POST(json({ name: "one more" }))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("renames and deletes only the user's own group", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    expect((await PATCH(json({ name: "Ideas" }, "PATCH"), groupContext)).status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: "g1", userId: "mine" }, data: { name: "Ideas" } });
    mocks.updateMany.mockResolvedValue({ count: 0 });
    expect((await PATCH(json({ name: "Ideas" }, "PATCH"), groupContext)).status).toBe(404);

    mocks.deleteMany.mockResolvedValue({ count: 0 });
    expect((await DELETE(json({}, "DELETE"), groupContext)).status).toBe(404);
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    expect((await DELETE(json({}, "DELETE"), groupContext)).status).toBe(200);
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { id: "g1", userId: "mine" } });
  });

  it("moves a note only into the user's own group, or out of any group", async () => {
    mocks.pageUpdateMany.mockResolvedValue({ count: 1 });
    mocks.count.mockResolvedValue(0);
    expect((await PUT(json({ groupId: "someone-elses" }, "PUT"), pageContext)).status).toBe(404);
    expect(mocks.pageUpdateMany).not.toHaveBeenCalled();

    mocks.count.mockResolvedValue(1);
    expect((await PUT(json({ groupId: "g1" }, "PUT"), pageContext)).status).toBe(200);
    expect(mocks.count).toHaveBeenLastCalledWith({ where: { id: "g1", userId: "mine" } });
    expect(mocks.pageUpdateMany).toHaveBeenLastCalledWith({ where: { id: "p1", userId: "mine", deletedAt: null }, data: { groupId: "g1" } });

    expect((await PUT(json({ groupId: null }, "PUT"), pageContext)).status).toBe(200);
    expect(mocks.pageUpdateMany).toHaveBeenLastCalledWith({ where: { id: "p1", userId: "mine", deletedAt: null }, data: { groupId: null } });

    mocks.pageUpdateMany.mockResolvedValue({ count: 0 });
    expect((await PUT(json({ groupId: null }, "PUT"), pageContext)).status).toBe(404);
    expect((await PUT(json({ groupId: 7 }, "PUT"), pageContext)).status).toBe(400);
    expect((await PUT(json({}, "PUT"), pageContext)).status).toBe(400);
  });
});
