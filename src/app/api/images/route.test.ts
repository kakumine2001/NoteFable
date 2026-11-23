import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findSession: vi.fn(), history: vi.fn(), createMessage: vi.fn(), read: vi.fn(), write: vi.fn(), fetch: vi.fn(), consumeUsage: vi.fn(), refundUsage: vi.fn(), room: vi.fn(), discard: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getOrCreateUser: async () => ({ id: "owner" }) }));
vi.mock("@/lib/usage-limits", async (importOriginal) => ({ ...await importOriginal<object>(), consumeUsage: mocks.consumeUsage, refundUsage: mocks.refundUsage, clientNetworkKey: () => null }));
vi.mock("@/lib/env", () => ({ optionalEnv: () => undefined, requireEnv: () => "test-key" }));
vi.mock("@/lib/storage", () => ({ readStoredImage: mocks.read, newChatImagePath: () => "images/new.png" }));
vi.mock("@/lib/stored-files", async (importOriginal) => ({
  storageLimitResponse: (await importOriginal<typeof import("@/lib/stored-files")>()).storageLimitResponse,
  assertStorageRoom: mocks.room,
  discardStoredFiles: mocks.discard,
  storeFile: async (_owner: unknown, file: { buffer: Buffer; mimeType: string }) => mocks.write(file.buffer, file.mimeType),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  session: { findFirst: mocks.findSession, create: async () => ({ id: "new", title: "New" }), updateMany: async () => ({}), update: async () => ({}) },
  // findFirst は表示中の枝の末尾（次の発言の親）。
  message: { findMany: mocks.history, create: mocks.createMessage, findFirst: async () => ({ id: "last" }) },
} }));
import { POST } from "./route";

const request = (sessionId?: string) => new Request("http://localhost/api/images", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "これを画像にして", sessionId }),
});

function setHistory(rows: object[]) {
  mocks.history.mockResolvedValue(rows);
}

describe("image generation conversation wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.consumeUsage.mockResolvedValue({ ok: true, ticket: { buckets: [{ key: "user:owner", kind: "image", day: "2026-01-01" }] } });
    mocks.refundUsage.mockResolvedValue(undefined);
    mocks.findSession.mockResolvedValue({ id: "owned", title: "Chat" });
    setHistory([{ role: "USER", content: "富士山と桜", attachments: [] }]);
    mocks.read.mockResolvedValue(Buffer.from("reference"));
    mocks.write.mockResolvedValue("saved.png");
    mocks.createMessage.mockResolvedValue({ id: "saved" });
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("generated").toString("base64") }] })));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("refuses with the storage limit before calling the provider or counting a generation", async () => {
    const { StorageLimitError } = await import("@/lib/usage-plans");
    mocks.room.mockRejectedValueOnce(new StorageLimitError("full", "member", 600, 500));
    const response = await POST(request());
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "full", code: "storage_limit", tier: "member", used: 600, limit: 500 });
    expect(mocks.consumeUsage).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("returns the image limit before calling the provider", async () => {
    mocks.consumeUsage.mockResolvedValueOnce({ ok: false, tier: "guest", message: "limit" });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "limit", code: "usage_limit", tier: "guest", kind: "image" });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.createMessage).not.toHaveBeenCalled();
    expect(mocks.refundUsage).not.toHaveBeenCalled();
  });

  it.each(["provider", "storage", "database"])("refunds when %s failure prevents image delivery", async (failure) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    if (failure === "provider") mocks.fetch.mockRejectedValue(new Error("upstream failed"));
    if (failure === "storage") mocks.write.mockRejectedValueOnce(new Error("storage failed"));
    if (failure === "database") mocks.createMessage.mockRejectedValueOnce(new Error("database failed"));
    expect((await POST(request())).status).toBe(500);
    expect(mocks.refundUsage).toHaveBeenCalledExactlyOnceWith({ buckets: [{ key: "user:owner", kind: "image", day: "2026-01-01" }] });
  });

  it("loads only the owned conversation and sends context upstream while saving only the user's input", async () => {
    expect((await POST(request("owned"))).status).toBe(200);
    expect(mocks.findSession).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "owned", userId: "owner" } }));
    expect(mocks.history).toHaveBeenCalledWith(expect.objectContaining({ where: { sessionId: "owned", active: true, session: { userId: "owner" }, role: { in: ["USER", "ASSISTANT"] } }, take: 24 }));
    // 表示中の枝の末尾に続け、生成した画像の回答はその発言の下に置く。
    expect(mocks.createMessage.mock.calls[0][0].data.parentId).toBe("last");
    expect(mocks.createMessage.mock.calls[1][0].data.parentId).toBe("saved");
    const upstream = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    // Proxy JSON escapes non-ASCII characters, so inspect its decoded request.
    expect(upstream.prompt).toContain("富士山と桜");
    expect(upstream.prompt).toContain("これを画像にして");
    expect(mocks.createMessage.mock.calls[0][0].data.content).toBe("これを画像にして");
  });

  it("rejects unowned sessions before reading history or calling the image provider", async () => {
    mocks.findSession.mockResolvedValue(null);
    expect((await POST(request("foreign"))).status).toBe(404);
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("sends the previous assistant image as an edit reference and does not duplicate it in storage", async () => {
    setHistory([{ role: "ASSISTANT", content: "", attachments: [{ filename: "generated-image.png", mimeType: "image/png", size: 9, extractedText: null, imageStoragePath: "old.png" }] }]);
    expect((await POST(request("owned"))).status).toBe(200);
    expect(mocks.fetch.mock.calls[0][0]).toMatch(/\/images\/edits$/);
    const form = mocks.fetch.mock.calls[0][1].body as FormData;
    expect(form.get("prompt")).toContain("これを画像にして");
    const reference = form.get("image") as File;
    expect(Buffer.from(await reference.arrayBuffer()).toString()).toBe("reference");
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.createMessage.mock.calls[0][0].data.attachments).toBeUndefined();
  });

  it("does not read unrelated history for a new chat", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mocks.history).not.toHaveBeenCalled();
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).prompt).toBe("これを画像にして");
    expect(mocks.fetch.mock.calls[0][0]).toMatch(/\/images\/generations$/);
  });

  it("sends both the previous poster and the new logo, storing only the newly uploaded reference", async () => {
    setHistory([{ role: "ASSISTANT", content: "", attachments: [{ filename: "poster.png", mimeType: "image/png", size: 9, extractedText: null, imageStoragePath: "poster.png" }] }]);
    const body = new FormData();
    body.set("sessionId", "owned");
    body.set("prompt", "このロゴをさっきのポスターに追加して");
    body.append("files", new File(["logo"], "logo.png", { type: "image/png" }));
    const response = await POST(new Request("http://localhost/api/images", { method: "POST", body }));
    expect(response.status).toBe(200);
    const upstream = mocks.fetch.mock.calls[0][1].body as FormData;
    const images = upstream.getAll("image") as File[];
    expect(images.map((image) => image.name)).toEqual(["poster.png", "logo.png"]);
    expect(Buffer.from(await images[0].arrayBuffer()).toString()).toBe("reference");
    expect(Buffer.from(await images[1].arrayBuffer()).toString()).toBe("logo");
    expect(upstream.get("prompt")).toContain('"image":2,"source":"current upload","upload":1,"filename":"logo.png"');
    expect(mocks.write).toHaveBeenCalledTimes(2);
    expect(mocks.createMessage.mock.calls[0][0].data.attachments.create).toHaveLength(1);
    expect(mocks.createMessage.mock.calls[0][0].data.attachments.create[0].filename).toBe("logo.png");
  });

  it("stores an uploaded reference before paying for the generation and deletes it when the generation fails", async () => {
    const order: string[] = [];
    mocks.write.mockImplementation(async () => { order.push("store"); return "logo-saved.png"; });
    mocks.consumeUsage.mockImplementation(async () => { order.push("usage"); return { ok: true, ticket: { buckets: [] } }; });
    mocks.fetch.mockResolvedValue(new Response("upstream failed", { status: 500 }));
    const body = new FormData();
    body.set("sessionId", "owned");
    body.set("prompt", "このロゴを使って");
    body.append("files", new File(["logo"], "logo.png", { type: "image/png" }));
    const response = await POST(new Request("http://localhost/api/images", { method: "POST", body }));
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(order).toEqual(["store", "usage"]);
    expect(mocks.discard).toHaveBeenCalledWith(["logo-saved.png"]);
    expect(mocks.createMessage).not.toHaveBeenCalled();
  });

  it("deletes a stored reference when the generation limit is reached", async () => {
    mocks.write.mockResolvedValue("logo-saved.png");
    mocks.consumeUsage.mockResolvedValueOnce({ ok: false, tier: "guest", message: "limit" });
    const body = new FormData();
    body.set("sessionId", "owned");
    body.set("prompt", "このロゴを使って");
    body.append("files", new File(["logo"], "logo.png", { type: "image/png" }));
    expect((await POST(new Request("http://localhost/api/images", { method: "POST", body }))).status).toBe(429);
    expect(mocks.discard).toHaveBeenCalledWith(["logo-saved.png"]);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("makes the original upload available alongside the generated edit", async () => {
    const image = (filename: string) => ({ filename, mimeType: "image/png", size: 9, extractedText: null, imageStoragePath: filename });
    setHistory([
      { role: "ASSISTANT", content: "", attachments: [image("edited.png")] },
      { role: "USER", content: "元の写真", attachments: [image("original.png")] },
    ]);
    mocks.read.mockImplementation(async (path: string) => Buffer.from(path));
    const response = await POST(new Request("http://localhost/api/images", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "元の写真に戻って露出だけ調整", sessionId: "owned" }) }));
    expect(response.status).toBe(200);
    const upstream = mocks.fetch.mock.calls[0][1].body as FormData;
    expect((upstream.getAll("image") as File[]).map((file) => file.name)).toEqual(["original.png", "edited.png"]);
    expect(upstream.get("prompt")).toContain('"image":1,"source":"history","turn":1,"attachment":1,"role":"USER","filename":"original.png"');
    expect(upstream.get("prompt")).toContain('"image":2,"source":"history","turn":2,"attachment":1,"role":"ASSISTANT","filename":"edited.png"');
  });
});
