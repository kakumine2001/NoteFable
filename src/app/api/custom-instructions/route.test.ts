import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getOrCreateAnonymousUser: mocks.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { anonymousUser: { update: mocks.update } } }));
import { GET, PUT } from "./route";

const put = (body: unknown) => PUT(new Request("http://localhost/api/custom-instructions", { method: "PUT", body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: "mine", googleSub: "g1", customInstructions: "Be brief" });
  mocks.update.mockResolvedValue({});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("reading custom instructions", () => {
  it("returns the signed-in user's own instructions without caching", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ instructions: "Be brief" });
  });

  it("refuses a guest", async () => {
    mocks.user.mockResolvedValue({ id: "guest", googleSub: null, customInstructions: "left over" });
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Sign in to use custom instructions." });
  });

  it("answers 503 when the user cannot be loaded", async () => {
    mocks.user.mockRejectedValue(new Error("db down"));
    expect((await GET()).status).toBe(503);
  });
});

describe("saving custom instructions", () => {
  it("saves trimmed text with normalized line breaks on the user's own row", async () => {
    const response = await put({ instructions: "  Answer in Japanese.\r\nKeep it short.\n" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ instructions: "Answer in Japanese.\nKeep it short." });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "mine" }, data: { customInstructions: "Answer in Japanese.\nKeep it short." } });
  });

  it.each([[""], ["   \n"], [null]])("clears them for %j", async (instructions) => {
    expect((await put({ instructions })).status).toBe(200);
    expect(mocks.update.mock.calls[0][0].data).toEqual({ customInstructions: null });
  });

  it.each([
    ["a missing field", {}],
    ["a non-string", { instructions: 5 }],
    ["text over the limit", { instructions: "a".repeat(4001) }],
    ["control characters", { instructions: "a\u0000b" }],
    ["broken JSON", "{"],
  ])("rejects %s without writing", async (_name, body) => {
    expect((await put(body)).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects an oversized body", async () => {
    expect((await put({ instructions: "a".repeat(20000) })).status).toBe(413);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("refuses a guest without writing", async () => {
    mocks.user.mockResolvedValue({ id: "guest", googleSub: null, customInstructions: null });
    expect((await put({ instructions: "Be brief" })).status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("answers 503 when the write fails", async () => {
    mocks.update.mockRejectedValue(new Error("db down"));
    const response = await put({ instructions: "Be brief" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Could not save your custom instructions. Please try again." });
  });
});
