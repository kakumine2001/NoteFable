import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ switchVersion: vi.fn(), fork: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getOrCreateUser: async () => ({ id: "user" }) }));
vi.mock("@/lib/chat-branch-store", () => ({ switchMessageVersion: mocks.switchVersion, forkSession: mocks.fork }));

import { POST as switchVersion } from "./route";
import { POST as branch } from "../branch/route";

const context = { params: Promise.resolve({ sessionId: "session" }) };
const post = (body: unknown) => new Request("http://localhost/api", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

describe("POST /api/sessions/:id/versions", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "error").mockImplementation(() => {}); });

  it("switches to the requested version as the current user", async () => {
    mocks.switchVersion.mockResolvedValue(true);
    const response = await switchVersion(post({ messageId: " a1 " }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.switchVersion).toHaveBeenCalledExactlyOnceWith("user", "session", "a1");
  });

  it("rejects a missing or oversized id without touching the chat", async () => {
    for (const body of [{}, { messageId: 3 }, { messageId: "" }, { messageId: "x".repeat(65) }, "not json"]) {
      expect((await switchVersion(post(body), context)).status).toBe(400);
    }
    expect(mocks.switchVersion).not.toHaveBeenCalled();
  });

  it("answers 404 for a chat or message that is not the user's, and 503 when the switch fails", async () => {
    mocks.switchVersion.mockResolvedValueOnce(false);
    expect((await switchVersion(post({ messageId: "a1" }), context)).status).toBe(404);
    mocks.switchVersion.mockRejectedValueOnce(new Error("db down"));
    expect((await switchVersion(post({ messageId: "a1" }), context)).status).toBe(503);
  });
});

describe("POST /api/sessions/:id/branch", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "error").mockImplementation(() => {}); });

  it("copies the chat up to the message under a cleaned-up title", async () => {
    mocks.fork.mockResolvedValue({ id: "new", title: "Branch · Chat" });
    const response = await branch(post({ messageId: "a1", title: "  Branch ·\n Chat  " }), context);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ session: { id: "new", title: "Branch · Chat" } });
    expect(mocks.fork).toHaveBeenCalledExactlyOnceWith("user", "session", "a1", "Branch · Chat");
  });

  it("cuts a title that became too long instead of refusing it", async () => {
    mocks.fork.mockResolvedValue({ id: "new" });
    await branch(post({ messageId: "a1", title: `Branch · ${"長".repeat(200)}` }), context);
    expect(mocks.fork.mock.calls[0][3]).toHaveLength(120);
  });

  it("requires a message and a title, and reports a missing chat or message", async () => {
    expect((await branch(post({ title: "x" }), context)).status).toBe(400);
    expect((await branch(post({ messageId: "a1", title: "   " }), context)).status).toBe(400);
    expect(mocks.fork).not.toHaveBeenCalled();
    mocks.fork.mockResolvedValueOnce(null);
    expect((await branch(post({ messageId: "a1", title: "x" }), context)).status).toBe(404);
    mocks.fork.mockRejectedValueOnce(new Error("db down"));
    expect((await branch(post({ messageId: "a1", title: "x" }), context)).status).toBe(503);
  });
});
