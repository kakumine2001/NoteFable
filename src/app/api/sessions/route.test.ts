import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getOrCreateAnonymousUser: async () => ({ id: "mine" }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { session: { create: mocks.create, findMany: vi.fn() } } }));
import { POST } from "./route";

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
