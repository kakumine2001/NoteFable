import { beforeEach, describe, expect, it, vi } from "vitest";

// 公開ページの画像：ホワイトボードは本体の files が参照しているファイルだけを返す（ノートは本文のブロック）。
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), canvas: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/note-share-server", () => ({ resolvePublicShare: mocks.resolve }));
vi.mock("@/lib/prisma", () => ({ prisma: { noteCanvas: { findUnique: mocks.canvas } } }));
vi.mock("@/lib/storage", () => ({ readStoredImage: mocks.read }));
import { GET } from "./route";

const owner = "user1";
const key = `note-files/${owner}/11111111-1111-1111-1111-111111111111.png`;
const other = `note-files/${owner}/22222222-2222-2222-2222-222222222222.png`;
const fileUrl = (path: string) => `/api/pages/files?key=${encodeURIComponent(path)}&name=a.png`;
const request = (path: string) => new Request(`https://notefable.com/s/tok/file?page=board&key=${encodeURIComponent(path)}`);
const params = { params: Promise.resolve({ token: "tok" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue({ page: { id: "board", userId: owner, kind: "whiteboard", blocks: [] } });
  mocks.canvas.mockResolvedValue({ data: { elements: [{ id: "i", type: "image", fileId: "f" }], files: { f: { id: "f", mimeType: "image/png", dataURL: fileUrl(key) } } } });
  mocks.read.mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
});

describe("GET /s/:token/file for whiteboards", () => {
  it("serves an image the board refers to", async () => {
    const response = await GET(request(key), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(mocks.canvas).toHaveBeenCalledWith({ where: { noteId: "board" }, select: { data: true } });
  });

  it("refuses the owner's other files", async () => {
    expect((await GET(request(other), params)).status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("refuses everything when the board is not public", async () => {
    mocks.resolve.mockResolvedValue(null);
    expect((await GET(request(key), params)).status).toBe(404);
  });
});
