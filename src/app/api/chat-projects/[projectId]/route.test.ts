import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findProject: vi.fn(), updateProject: vi.fn(), findNotes: vi.fn(), deleteLinks: vi.fn(), createLinks: vi.fn(), lock: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getOrCreateUser: async () => ({ id: "mine" }) }));
vi.mock("@/lib/prisma", () => {
  const tx = {
    chatProject: { findFirst: mocks.findProject, updateMany: mocks.updateProject },
    notePage: { findMany: mocks.findNotes },
    chatProjectNote: { deleteMany: mocks.deleteLinks, createMany: mocks.createLinks },
    $executeRaw: mocks.lock,
  };
  return { prisma: { ...tx, $transaction: async (work: (client: unknown) => unknown) => work(tx) } };
});
import { GET, PATCH } from "./route";

const context = { params: Promise.resolve({ projectId: "p" }) };
const patch = (body: unknown) => PATCH(new Request("http://localhost/api/chat-projects/p", { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) }), context);
const summary = { id: "p", name: "Work", instructions: "Be brief", _count: { notes: 2 } };
// 検証が失敗した要求は、トランザクション内で何も書き込まない。
const wrote = () => mocks.updateProject.mock.calls.length + mocks.deleteLinks.mock.calls.length + mocks.createLinks.mock.calls.length;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findProject.mockResolvedValue(summary);
  mocks.updateProject.mockResolvedValue({ count: 1 });
  mocks.findNotes.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id })));
});

describe("reading a project's settings", () => {
  it("returns the instructions and only the live notes in the order they were chosen", async () => {
    mocks.findProject.mockResolvedValue({ id: "p", name: "Work", instructions: "Be brief", notes: [{ note: { id: "n2", title: "B", icon: "📚" } }, { note: { id: "n1", title: "A", icon: null } }] });
    const response = await GET(new Request("http://localhost/api/chat-projects/p"), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ project: { id: "p", name: "Work", instructions: "Be brief", notes: [{ id: "n2", title: "B", icon: "📚" }, { id: "n1", title: "A", icon: null }] } });
    const query = mocks.findProject.mock.calls[0][0];
    expect(query.where).toEqual({ id: "p", userId: "mine" });
    expect(query.select.notes.where).toEqual({ note: { userId: "mine", deletedAt: null } });
    expect(query.select.notes.orderBy).toEqual([{ position: "asc" }, { createdAt: "asc" }]);
  });

  it("returns 404 for a project that is not the user's", async () => {
    mocks.findProject.mockResolvedValue(null);
    expect((await GET(new Request("http://localhost/api/chat-projects/p"), context)).status).toBe(404);
  });
});

describe("saving a project's instructions and reference notes", () => {
  it("saves trimmed instructions and returns the summary", async () => {
    const response = await patch({ instructions: "  Answer in Japanese.\n" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ project: { id: "p", name: "Work", noteCount: 2, hasInstructions: true } });
    expect(mocks.updateProject).toHaveBeenCalledWith({ where: { id: "p", userId: "mine" }, data: { instructions: "Answer in Japanese." } });
    expect(mocks.deleteLinks).not.toHaveBeenCalled();
  });

  it.each([[""], ["   \n"], [null]])("clears the instructions for %j", async (instructions) => {
    expect((await patch({ instructions })).status).toBe(200);
    expect(mocks.updateProject.mock.calls[0][0].data).toEqual({ instructions: null });
  });

  it("changes name and instructions together", async () => {
    await patch({ name: " Mail ", instructions: "Polite." });
    expect(mocks.updateProject.mock.calls[0][0].data).toEqual({ name: "Mail", instructions: "Polite." });
  });

  it("accepts exactly 4000 characters and rejects 4001", async () => {
    expect((await patch({ instructions: "x".repeat(4000) })).status).toBe(200);
    mocks.updateProject.mockClear();
    expect((await patch({ instructions: "x".repeat(4001) })).status).toBe(400);
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it("accepts 4000 characters that grow when JSON-escaped", async () => {
    expect((await patch({ instructions: '"\n'.repeat(2000) })).status).toBe(200);
  });

  it.each([[5], [{}], ["a\u0000b"]])("rejects instructions %j", async (instructions) => {
    expect((await patch({ instructions })).status).toBe(400);
    expect(wrote()).toBe(0);
  });

  it("replaces the reference notes in the order given, in one locked transaction", async () => {
    const response = await patch({ noteIds: ["n2", "n1"] });
    expect(response.status).toBe(200);
    expect(mocks.lock).toHaveBeenCalledOnce();
    // 自分の生きたノートかを自分の ID で確かめる。
    expect(mocks.findNotes).toHaveBeenCalledWith({ where: { id: { in: ["n2", "n1"] }, userId: "mine", deletedAt: null }, select: { id: true } });
    expect(mocks.deleteLinks).toHaveBeenCalledWith({ where: { projectId: "p" } });
    expect(mocks.createLinks).toHaveBeenCalledWith({ data: [{ projectId: "p", noteId: "n2", position: 0 }, { projectId: "p", noteId: "n1", position: 1 }] });
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it("clears every reference note with an empty list", async () => {
    expect((await patch({ noteIds: [] })).status).toBe(200);
    expect(mocks.deleteLinks).toHaveBeenCalledWith({ where: { projectId: "p" } });
    expect(mocks.createLinks).not.toHaveBeenCalled();
    expect(mocks.findNotes).not.toHaveBeenCalled();
  });

  it("writes nothing when one of the notes is foreign, unknown or in the trash", async () => {
    // 他人・存在しない・ゴミ箱のノートは、所有と deletedAt の条件で見つからない。
    mocks.findNotes.mockResolvedValue([{ id: "n1" }]);
    const response = await patch({ name: "New name", instructions: "Hi", noteIds: ["n1", "someone-elses"] });
    expect(response.status).toBe(404);
    expect(wrote()).toBe(0);
  });

  it.each([
    [["a", "b", "c", "d", "e", "f"]],
    [["a", "a"]],
    [["a", ""]],
    [["a", 1]],
    [["x".repeat(101)]],
    ["a"],
    [null],
  ])("rejects the note list %j without touching the database", async (noteIds) => {
    expect((await patch({ noteIds })).status).toBe(400);
    expect(mocks.findNotes).not.toHaveBeenCalled();
    expect(wrote()).toBe(0);
  });

  it("allows five notes", async () => {
    expect((await patch({ noteIds: ["a", "b", "c", "d", "e"] })).status).toBe(200);
    expect(mocks.createLinks.mock.calls[0][0].data).toHaveLength(5);
  });

  it("returns 404 for another user's project and writes nothing", async () => {
    mocks.findProject.mockResolvedValue(null);
    expect((await patch({ instructions: "Hi", noteIds: ["n1"] })).status).toBe(404);
    expect(mocks.findProject.mock.calls[0][0].where).toEqual({ id: "p", userId: "mine" });
    expect(mocks.findNotes).not.toHaveBeenCalled();
    expect(wrote()).toBe(0);
  });

  it.each([[{}], [{ other: 1 }], ["not json"], ["[]"]])("rejects the request %j that changes nothing", async (body) => {
    expect((await patch(body)).status).toBe(400);
    expect(wrote()).toBe(0);
  });

  it("rejects an oversized request body", async () => {
    expect((await patch({ instructions: "x".repeat(20000) })).status).toBe(413);
  });
});
