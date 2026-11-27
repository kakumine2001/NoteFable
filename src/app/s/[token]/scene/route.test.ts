import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolvePublicShare: vi.fn(),
  resolvePublicShareCards: vi.fn(),
  readCanvasDataForShare: vi.fn(),
}));
vi.mock("@/lib/note-share-server", () => ({
  resolvePublicShare: mocks.resolvePublicShare,
  resolvePublicShareCards: mocks.resolvePublicShareCards,
}));
vi.mock("@/lib/canvas-store", () => ({
  readCanvasDataForShare: mocks.readCanvasDataForShare,
}));
import { GET } from "./route";

const params = { params: Promise.resolve({ token: "tok1234567890" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolvePublicShare.mockResolvedValue({
    token: "tok1234567890",
    root: { id: "root", kind: "note", userId: "owner", title: "Root", icon: null, shareIncludeSubpages: true, shareExpiresAt: null },
    page: { id: "board", kind: "whiteboard", userId: "owner" },
    breadcrumbs: [],
    children: [],
  });
});

describe("GET /s/:token/scene", () => {
  it("returns live titles and summaries for in-tree cards and redacts out-of-tree cards", async () => {
    mocks.readCanvasDataForShare.mockResolvedValue({
      elements: [
        {
          id: "c-in",
          type: "rectangle",
          width: 280,
          height: 72,
          link: "/app?view=pages&page=inTreePage",
          boundElements: [{ id: "t-in", type: "text" }],
          customData: { notefablePage: { id: "inTreePage", kind: "note" } },
        },
        { id: "t-in", type: "text", containerId: "c-in", text: "📄 Old Title", originalText: "📄 Old Title", fontSize: 18 },
        {
          id: "c-out",
          type: "rectangle",
          width: 280,
          height: 72,
          link: "/app?view=pages&page=secretPrivateId",
          boundElements: [{ id: "t-out", type: "text" }],
          customData: { notefablePage: { id: "secretPrivateId", kind: "note" } },
        },
        { id: "t-out", type: "text", containerId: "c-out", text: "🔒 Top Secret Salary Plan", originalText: "🔒 Top Secret Salary Plan", fontSize: 18 },
      ],
    });
    mocks.resolvePublicShareCards.mockResolvedValue({
      inTreePage: {
        id: "inTreePage",
        kind: "note",
        title: "Fresh Public Title",
        icon: "📘",
        iconUrl: null,
        summary: "Public note summary text.",
      },
    });

    const response = await GET(new Request("https://notefable.com/s/tok1234567890/scene?page=board&lang=en"), params);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(mocks.resolvePublicShareCards).toHaveBeenCalledWith(
      "tok1234567890",
      expect.objectContaining({ id: "root", userId: "owner" }),
      ["inTreePage", "secretPrivateId"],
    );

    expect(json.cards).toEqual({
      inTreePage: {
        id: "inTreePage",
        kind: "note",
        title: "Fresh Public Title",
        icon: "📘",
        iconUrl: null,
        summary: "Public note summary text.",
      },
    });

    const serializedScene = JSON.stringify(json.scene);
    expect(serializedScene).toContain("Fresh Public Title");
    // 要約は白板 scene JSON に書き込まない（cards マップの表示専用）。
    expect(serializedScene).not.toContain("Public note summary text.");
    // ツリー外カードの題名・ID・リンクは一切漏らさない。
    expect(serializedScene).not.toContain("Top Secret Salary Plan");
    expect(serializedScene).not.toContain("secretPrivateId");

    const outCard = json.scene.elements.find((el: { id: string }) => el.id === "c-out");
    const outText = json.scene.elements.find((el: { id: string }) => el.id === "t-out");
    expect(outCard.link).toBeNull();
    expect(outCard.customData).toBeUndefined();
    expect(outText.originalText).toBe("This page is not available");
  });

  it("returns 404 when share is unavailable or not a whiteboard", async () => {
    mocks.resolvePublicShare.mockResolvedValue(null);
    const response = await GET(new Request("https://notefable.com/s/tok1234567890/scene"), params);
    expect(response.status).toBe(404);
  });
});
