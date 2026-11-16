import { beforeEach, describe, expect, it, vi } from "vitest";
import { conversationToMarkdownFile } from "@/lib/answer-export";

const mocks = vi.hoisted(() => ({ session: vi.fn(), messages: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getOrCreateUser: async () => ({ id: "mine" }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { session: { findFirst: mocks.session }, message: { findMany: mocks.messages } } }));
import { GET } from "./route";

const sessionId = "chat12345678901234567890";
const context = { params: Promise.resolve({ sessionId }) };
const get = (query = "") => new Request(`https://notefable.example/api/sessions/${sessionId}/export${query}`);

describe("GET /api/sessions/:id/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ title: "Weekly: sync?" });
    mocks.messages.mockResolvedValue([
      { role: "USER", content: "Look at this", attachments: [{ id: "a1", filename: "photo.png", imageStoragePath: "x/photo.png" }, { id: "a2", filename: "notes.pdf", imageStoragePath: null }] },
      { role: "ASSISTANT", content: "Here is a picture", attachments: [{ id: "g1", filename: "image.png", imageStoragePath: "x/g1.png" }] },
    ]);
  });

  it("returns the same Markdown and file name the browser builds from the messages API", async () => {
    const response = await GET(get("?date=2026-10-16"), context);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.fileName).toBe("Weekly sync.md");
    const expected = conversationToMarkdownFile([
      { role: "USER", content: "Look at this", attachments: [{ filename: "photo.png", dataUrl: "/api/attachments/a1/image" }, { filename: "notes.pdf" }] },
      { role: "ASSISTANT", content: "Here is a picture", attachments: [], generatedImages: [{ id: "g1", dataUrl: "/api/attachments/g1/image" }] },
    ], { conversationTitle: "Weekly: sync?", conversationUrl: `https://notefable.example/?chat=${sessionId}`, savedAt: new Date(2026, 9, 16, 12) });
    expect(body.markdown).toBe(expected);
    expect(body.markdown).toContain("## You\n\nLook at this\n\n- [photo.png](<https://notefable.example/api/attachments/a1/image>)\n- notes.pdf");
    expect(body.markdown).toContain("- [Generated image 1](<https://notefable.example/api/attachments/g1/image>)");
    expect(body.markdown).toContain("on 2026-10-16.");
    expect(body.markdown).not.toContain("x/photo.png");
  });

  it("reads only the owner's chat and only USER and ASSISTANT messages, without provider context", async () => {
    await GET(get(), context);
    expect(mocks.session).toHaveBeenCalledWith({ where: { id: sessionId, userId: "mine", noteId: null }, select: { title: true } });
    const query = mocks.messages.mock.calls[0][0];
    // 表示中の枝だけを書き出す（編集・再生成で置き換えられた版は含めない）。
    expect(query.where).toEqual({ sessionId, active: true, role: { in: ["USER", "ASSISTANT"] } });
    expect(Object.keys(query.select).sort()).toEqual(["attachments", "content", "role"]);
  });

  it("returns 404 for someone else's chat without reading messages", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await GET(get(), context)).status).toBe(404);
    expect(mocks.messages).not.toHaveBeenCalled();
  });

  it("returns 404 for a chat with no saved messages", async () => {
    mocks.messages.mockResolvedValue([]);
    expect((await GET(get(), context)).status).toBe(404);
  });

  it("ignores a malformed date", async () => {
    const body = await (await GET(get("?date=2026-02-31"), context)).json();
    expect(body.markdown).toMatch(/on \d{4}-\d{2}-\d{2}\.\n$/);
  });
});
