import { describe, expect, it } from "vitest";
import {
  extractNoteWhiteboardPageIds,
  extractNoteWhiteboardRefs,
  findWhiteboardFrame,
  isPublicShareFileUrl,
  listWhiteboardFrames,
  toRenderableScene,
  validWhiteboardEmbedFrameId,
  validWhiteboardEmbedPageId,
} from "./frames";

const OWNER_FILE = "/api/pages/files?key=note-files%2Fu1%2F00000000-0000-4000-8000-000000000001.png";
const PUBLIC_FILE = "/s/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/file?page=wb1&key=note-files%2Fu1%2F00000000-0000-4000-8000-000000000001.png";

describe("whiteboard embed identifiers and public file URL guard", () => {
  it("validates pageId and frameId formats", () => {
    expect(validWhiteboardEmbedPageId("cm123_abc-9")).toBe(true);
    expect(validWhiteboardEmbedPageId("")).toBe(true);
    expect(validWhiteboardEmbedPageId("bad id")).toBe(false);
    expect(validWhiteboardEmbedPageId("a".repeat(65))).toBe(false);
    expect(validWhiteboardEmbedPageId(null)).toBe(false);

    expect(validWhiteboardEmbedFrameId("frame-1")).toBe(true);
    expect(validWhiteboardEmbedFrameId("frame:with/chars")).toBe(true);
    expect(validWhiteboardEmbedFrameId("")).toBe(true);
    expect(validWhiteboardEmbedFrameId("bad\u0000frame")).toBe(false);
    expect(validWhiteboardEmbedFrameId("f".repeat(121))).toBe(false);
    expect(validWhiteboardEmbedFrameId(123)).toBe(false);
  });

  it("allows only /s/:token/file URLs in public mode and rejects owner or external URLs", () => {
    expect(isPublicShareFileUrl(PUBLIC_FILE)).toBe(true);
    expect(isPublicShareFileUrl(OWNER_FILE)).toBe(false);
    expect(isPublicShareFileUrl("https://evil.example/s/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/file?page=wb1&key=note-files/u1/00000000-0000-4000-8000-000000000001.png")).toBe(false);
    expect(isPublicShareFileUrl("//evil.example/s/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/file?key=note-files/u1/00000000-0000-4000-8000-000000000001.png")).toBe(false);
    expect(isPublicShareFileUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isPublicShareFileUrl("/s/short/file?page=wb1&key=note-files/u1/00000000-0000-4000-8000-000000000001.png")).toBe(false);
    expect(isPublicShareFileUrl("/s/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/file?page=wb1&key=other/file.png")).toBe(false);
  });
});

describe("toRenderableScene", () => {
  it("keeps owner files only in owner mode and public share files only in public mode", () => {
    const data = {
      elements: [
        { id: "r1", type: "rectangle", x: 0, y: 0, width: 100, height: 60 },
        { id: "i-owner", type: "image", x: 10, y: 10, width: 100, height: 100, fileId: "f-owner" },
        { id: "i-public", type: "image", x: 120, y: 10, width: 100, height: 100, fileId: "f-public" },
        { id: "i-evil", type: "image", x: 240, y: 10, width: 100, height: 100, fileId: "f-evil" },
        { id: "dead", type: "rectangle", x: 0, y: 0, width: 10, height: 10, isDeleted: true },
        { id: "bad", type: "iframe", x: 0, y: 0, width: 10, height: 10 },
      ],
      files: {
        "f-owner": { id: "f-owner", mimeType: "image/png", dataURL: OWNER_FILE },
        "f-public": { id: "f-public", mimeType: "image/png", dataURL: PUBLIC_FILE },
        "f-evil": { id: "f-evil", mimeType: "image/png", dataURL: "https://evil.example/x.png" },
      },
      appState: { viewBackgroundColor: "#fdfbf7" },
    };

    const ownerScene = toRenderableScene(data, { fileUrlMode: "owner" });
    expect(ownerScene.elements.map((e) => e.id)).toEqual(["r1", "i-owner", "i-public", "i-evil"]);
    expect(Object.keys(ownerScene.files)).toEqual(["f-owner"]);
    expect(ownerScene.files["f-owner"].dataURL).toBe(OWNER_FILE);
    expect(ownerScene.appState.viewBackgroundColor).toBe("#fdfbf7");

    const publicScene = toRenderableScene(data, { fileUrlMode: "public" });
    expect(Object.keys(publicScene.files)).toEqual(["f-public"]);
    expect(publicScene.files["f-public"].dataURL).toBe(PUBLIC_FILE);
    expect(JSON.stringify(publicScene)).not.toContain("/api/pages/files");
    expect(JSON.stringify(publicScene)).not.toContain("evil.example");
  });
});

describe("listWhiteboardFrames and findWhiteboardFrame", () => {
  it("lists live non-zero frames in reading order and ignores deleted or degenerate frames", () => {
    const data = {
      elements: [
        { id: "f-bottom", type: "frame", x: 0, y: 500, width: 400, height: 300, name: "Bottom" },
        { id: "f-top-right", type: "frame", x: 500, y: 10, width: 400, height: 300, name: "  Top Right  " },
        { id: "f-top-left", type: "frame", x: 0, y: 0, width: 400, height: 300, name: "" },
        { id: "f-deleted", type: "frame", x: 0, y: -100, width: 400, height: 300, name: "Gone", isDeleted: true },
        { id: "f-empty", type: "frame", x: 0, y: 0, width: 0, height: 100, name: "Zero" },
        { id: "r1", type: "rectangle", x: 10, y: 10, width: 100, height: 80 },
      ],
    };
    const frames = listWhiteboardFrames(data);
    expect(frames).toEqual([
      { id: "f-top-left", name: null, x: 0, y: 0, width: 400, height: 300 },
      { id: "f-top-right", name: "Top Right", x: 500, y: 10, width: 400, height: 300 },
      { id: "f-bottom", name: "Bottom", x: 0, y: 500, width: 400, height: 300 },
    ]);
    const elements = toRenderableScene(data).elements;
    expect(findWhiteboardFrame(elements, "f-top-right")?.name).toBe("  Top Right  ");
    expect(findWhiteboardFrame(elements, "f-deleted")).toBeNull();
    expect(findWhiteboardFrame(elements, "missing")).toBeNull();
  });
});

describe("extractNoteWhiteboardRefs and extractNoteWhiteboardPageIds", () => {
  it("walks nested children and columns, skips empty/invalid refs, and deduplicates page IDs", () => {
    const blocks = [
      { id: "w1", type: "whiteboard", props: { pageId: "wb1", frameId: "f1" }, children: [] },
      { id: "w-empty", type: "whiteboard", props: { pageId: "", frameId: "" }, children: [] },
      {
        id: "t1",
        type: "toggleListItem",
        props: {},
        content: [],
        children: [
          { id: "w2", type: "whiteboard", props: { pageId: "wb1", frameId: "" }, children: [] },
        ],
      },
      {
        id: "cols",
        type: "columnList",
        props: {},
        children: [
          {
            id: "c1",
            type: "column",
            props: { width: 1 },
            children: [
              { id: "w3", type: "whiteboard", props: { pageId: "wb2", frameId: "f2" }, children: [] },
            ],
          },
        ],
      },
    ];
    expect(extractNoteWhiteboardRefs(blocks)).toEqual([
      { pageId: "wb1", frameId: "f1" },
      { pageId: "wb1", frameId: null },
      { pageId: "wb2", frameId: "f2" },
    ]);
    expect(extractNoteWhiteboardPageIds(blocks)).toEqual(["wb1", "wb2"]);
  });
});
