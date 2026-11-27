import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { notePage: { findMany: mocks.findMany } },
}));

import { assertNoteWhiteboardsOwner, loadEmbeddedWhiteboardMeta } from "./note-whiteboards";

const wbBlock = (id: string, pageId: string, frameId = "") => ({
  id,
  type: "whiteboard",
  props: { pageId, frameId },
  children: [],
});

const db = { notePage: { findMany: mocks.findMany } } as unknown as Parameters<typeof assertNoteWhiteboardsOwner>[0];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assertNoteWhiteboardsOwner", () => {
  it("skips DB calls when blocks have no whiteboard embeds or only pre-existing allowed IDs", async () => {
    await assertNoteWhiteboardsOwner(db, [wbBlock("b1", "")], "u1");
    await assertNoteWhiteboardsOwner(
      db,
      [wbBlock("b2", "wb1")],
      "u1",
      { allowExistingIds: new Set(["wb1"]) },
    );
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("allows owned live whiteboards and rejects missing, trashed, non-whiteboard or other-user pages", async () => {
    mocks.findMany.mockResolvedValueOnce([{ id: "wb1" }, { id: "wb2" }]);
    await expect(
      assertNoteWhiteboardsOwner(
        db,
        [wbBlock("b1", "wb1"), wbBlock("b2", "wb2", "f1")],
        "u1",
      ),
    ).resolves.toBeUndefined();
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["wb1", "wb2"] }, userId: "u1", kind: "whiteboard", deletedAt: null },
      select: { id: true },
    });

    mocks.findMany.mockResolvedValueOnce([{ id: "wb1" }]);
    await expect(
      assertNoteWhiteboardsOwner(
        db,
        [wbBlock("b1", "wb1"), wbBlock("b2", "wb-trashed")],
        "u1",
      ),
    ).rejects.toMatchObject({ status: 400, message: "This page embeds a whiteboard that is not available." });
  });

  it("checks only newly added whiteboard IDs during PATCH while letting existing trashed embeds stay", async () => {
    mocks.findMany.mockResolvedValueOnce([{ id: "wb-new" }]);
    await assertNoteWhiteboardsOwner(
      db,
      [wbBlock("b1", "wb-old-trashed"), wbBlock("b2", "wb-new")],
      "u1",
      { allowExistingIds: new Set(["wb-old-trashed"]) },
    );
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["wb-new"] }, userId: "u1", kind: "whiteboard", deletedAt: null },
      select: { id: true },
    });
  });
});

describe("loadEmbeddedWhiteboardMeta", () => {
  it("loads live titles and frame names from NoteCanvas.segments for owned live whiteboards", async () => {
    mocks.findMany.mockResolvedValueOnce([
      {
        id: "wb1",
        title: "Architecture",
        canvas: {
          segments: [
            { id: "f1", text: "System Overview" },
            { id: "f2", text: "  API Layer  " },
          ],
        },
      },
    ]);
    const map = await loadEmbeddedWhiteboardMeta("u1", [[wbBlock("b1", "wb1", "f1")]]);
    expect(map.get("wb1")).toEqual({
      title: "Architecture",
      frames: new Map([["f1", "System Overview"], ["f2", "API Layer"]]),
    });
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["wb1"] }, userId: "u1", kind: "whiteboard", deletedAt: null },
      select: { id: true, title: true, canvas: { select: { segments: true } } },
    });
  });

  it("returns empty map without querying when no blocks embed whiteboards", async () => {
    const map = await loadEmbeddedWhiteboardMeta("u1", [[{ id: "p1", type: "paragraph", props: {}, content: [], children: [] }]]);
    expect(map.size).toBe(0);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
