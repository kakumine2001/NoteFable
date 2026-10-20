import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findSession: vi.fn(), history: vi.fn(), createMessage: vi.fn(), read: vi.fn(), write: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getOrCreateAnonymousUser: async () => ({ id: "owner" }) }));
vi.mock("@/lib/env", () => ({ optionalEnv: () => undefined, requireEnv: () => "test-key" }));
vi.mock("@/lib/storage", () => ({ readStoredImage: mocks.read, writeStoredImage: mocks.write }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  session: { findFirst: mocks.findSession, create: async () => ({ id: "new", title: "New" }), updateMany: async () => ({}), update: async () => ({}) },
  message: { findMany: mocks.history, create: mocks.createMessage },
} }));
import { POST } from "./route";

const request = (sessionId?: string) => new Request("http://localhost/api/images", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "これを画像にして", sessionId }),
});

describe("image generation conversation wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.findSession.mockResolvedValue({ id: "owned", title: "Chat" });
    mocks.history.mockResolvedValue([{ role: "USER", content: "富士山と桜", attachments: [] }]);
    mocks.read.mockResolvedValue(Buffer.from("reference"));
    mocks.write.mockResolvedValue("saved.png");
    mocks.createMessage.mockResolvedValue({ id: "saved" });
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("generated").toString("base64") }] })));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("loads only the owned conversation and sends context upstream while saving only the user's input", async () => {
    expect((await POST(request("owned"))).status).toBe(200);
    expect(mocks.findSession).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "owned", userId: "owner" } }));
    expect(mocks.history).toHaveBeenCalledWith(expect.objectContaining({ where: { sessionId: "owned", session: { userId: "owner" }, role: { in: ["USER", "ASSISTANT"] } }, take: 24 }));
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
    mocks.history.mockResolvedValue([{ role: "ASSISTANT", content: "", attachments: [{ filename: "generated-image.png", mimeType: "image/png", size: 9, extractedText: null, imageStoragePath: "old.png" }] }]);
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
    mocks.history.mockResolvedValue([{ role: "ASSISTANT", content: "", attachments: [{ filename: "poster.png", mimeType: "image/png", size: 9, extractedText: null, imageStoragePath: "poster.png" }] }]);
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

  it("makes the original upload available alongside the generated edit", async () => {
    const image = (filename: string) => ({ filename, mimeType: "image/png", size: 9, extractedText: null, imageStoragePath: filename });
    mocks.history.mockResolvedValue([
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
