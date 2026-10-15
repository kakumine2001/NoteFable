import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), findMany: vi.fn(), findProject: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getOrCreateAnonymousUser: async () => ({ id: "mine" }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { session: { create: mocks.create, findMany: mocks.findMany }, chatProject: { findFirst: mocks.findProject } } }));
import { GET, POST } from "./route";

function post(body?: unknown) {
  return new Request("http://localhost/api/sessions", { method: "POST", ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
}

describe("creating a chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ id: "s1", title: "New chat", icon: null });
  });

  it("creates an empty chat without a body, as before", async () => {
    expect((await POST(post())).status).toBe(201);
    expect(mocks.create.mock.calls[0][0].data).toEqual({ userId: "mine", title: "New chat", icon: null });
  });

  it("saves the icon picked before the first message together with the chat", async () => {
    expect((await POST(post({ icon: "📚" }))).status).toBe(201);
    expect(mocks.create.mock.calls[0][0].data).toEqual({ userId: "mine", title: "New chat", icon: "📚" });
  });

  it.each([["🇯🇵"], ["👨‍👩‍👧"], ["👍🏽"], ["🗂️"]])("accepts the multi-codepoint emoji %s", async (icon) => {
    expect((await POST(post({ icon }))).status).toBe(201);
    expect(mocks.create.mock.calls[0][0].data.icon).toBe(icon);
  });

  it("treats a null icon or an unrelated body as no icon", async () => {
    await POST(post({ icon: null }));
    await POST(post({ other: 1 }));
    await POST(post("not json"));
    expect(mocks.create.mock.calls.map(([arg]) => arg.data.icon)).toEqual([null, null, null]);
  });

  it.each([["abc"], ["📚📚"], [""], [5]])("rejects %j as an icon without creating a chat", async (icon) => {
    expect((await POST(post({ icon }))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("creating a chat inside a project", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ id: "s1", title: "New chat", icon: null, projectId: "p1" });
    mocks.findProject.mockResolvedValue({ id: "p1" });
  });

  it("creates the chat in the project after checking that the project is the user's", async () => {
    const response = await POST(post({ icon: "📚", projectId: "p1" }));
    expect(response.status).toBe(201);
    expect((await response.json()).session.projectId).toBe("p1");
    expect(mocks.findProject).toHaveBeenCalledWith({ where: { id: "p1", userId: "mine" }, select: { id: true } });
    expect(mocks.create.mock.calls[0][0].data).toEqual({ userId: "mine", title: "New chat", icon: "📚", projectId: "p1" });
  });

  it("rejects a project that is foreign or missing with a clear message and creates nothing", async () => {
    mocks.findProject.mockResolvedValue(null);
    const response = await POST(post({ projectId: "someone-elses" }));
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Project not found.");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([[5], [""], [{}]])("rejects %j as a project ID without any lookup", async (projectId) => {
    expect((await POST(post({ projectId }))).status).toBe(400);
    expect(mocks.findProject).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not look up a project when none is given", async () => {
    await POST(post({ projectId: null }));
    await POST(post({ icon: "📚" }));
    expect(mocks.findProject).not.toHaveBeenCalled();
    expect(mocks.create.mock.calls.map(([arg]) => "projectId" in arg.data)).toEqual([false, false]);
  });
});

describe("listing chats", () => {
  it("leaves out the conversations that belong to a note's AI assistant", async () => {
    mocks.findMany.mockResolvedValue([]);
    expect((await GET()).status).toBe(200);
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({ userId: "mine", noteId: null });
  });
});
