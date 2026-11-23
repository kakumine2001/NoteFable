import { describe, expect, it } from "vitest";
import { publicWhiteboardScene, whiteboardFileKeys } from "@/lib/whiteboard/public";

const key = "note-files/user1/11111111-1111-1111-1111-111111111111.png";
const fileUrl = `/api/pages/files?key=${encodeURIComponent(key)}&name=photo.png`;
const otherKey = "note-files/user1/22222222-2222-2222-2222-222222222222.png";
const otherUrl = `/api/pages/files?key=${encodeURIComponent(otherKey)}&name=other.png`;
const image = (id: string, fileId: string, extra: Record<string, unknown> = {}) => ({ id, type: "image", fileId, ...extra });

describe("public whiteboards", () => {
  it("lists only the note files that live image elements use", () => {
    const keys = whiteboardFileKeys({
      elements: [image("i1", "a"), image("i2", "b"), image("i3", "c")],
      files: { a: { dataURL: fileUrl }, b: { url: fileUrl }, c: { dataURL: "https://evil.example/x.png" }, d: null },
    });
    expect([...keys]).toEqual([key]);
    expect(whiteboardFileKeys(null).size).toBe(0);
    expect(whiteboardFileKeys({ files: [] }).size).toBe(0);
  });

  it("does not let a public link read files of deleted images, unused files or a second URL", () => {
    const data = {
      elements: [image("gone", "a", { isDeleted: true }), image("live", "b")],
      files: {
        a: { dataURL: otherUrl },
        b: { dataURL: fileUrl, url: otherUrl },
        unused: { dataURL: otherUrl },
      },
    };
    expect([...whiteboardFileKeys(data)]).toEqual([key]);
    const scene = publicWhiteboardScene(data, "tok", "page1");
    expect(Object.keys(scene.files ?? {})).toEqual(["b"]);
    expect(JSON.stringify(scene)).not.toContain(encodeURIComponent(otherKey));
  });

  it("never shows embeds or HTML frames, and keeps only page-card data", () => {
    const scene = publicWhiteboardScene({
      elements: [
        { id: "x", type: "iframe", customData: { generationData: { status: "done", html: "<script>alert(1)</script>" } } },
        { id: "y", type: "embeddable", link: "https://val.town/x" },
        { id: "z", type: "magicframe" },
        { id: "card", type: "rectangle", link: "/app?view=pages&page=p1", customData: { notefablePage: { id: "p1", kind: "note" }, secret: "s" } },
        { id: "plain", type: "rectangle", customData: { tracking: "t" } },
      ],
    }, "tok", "page1");
    expect(scene.elements.map((element) => element.id)).toEqual(["card", "plain"]);
    expect(scene.elements[0].customData).toEqual({ notefablePage: { id: "p1", kind: "note" } });
    expect("customData" in scene.elements[1]).toBe(false);
    expect(JSON.stringify(scene)).not.toContain("script");
  });

  it("serves images through the public link and drops deleted elements", () => {
    const scene = publicWhiteboardScene({
      elements: [{ id: "i", type: "image", fileId: "a" }, { id: "x", type: "rectangle", isDeleted: true }],
      files: { a: { id: "a", mimeType: "image/png", dataURL: fileUrl } },
      appState: { viewBackgroundColor: "#ffffff", scrollX: 5 },
    }, "tok", "page1");
    expect(scene.elements.map((element) => element.id)).toEqual(["i"]);
    expect(scene.files?.a.dataURL).toBe(`/s/tok/file?page=page1&key=${encodeURIComponent(key)}&name=photo.png`);
    expect(JSON.stringify(scene)).not.toContain("/api/pages/files");
    expect(scene.appState).toEqual({ viewBackgroundColor: "#ffffff" });
  });
});
