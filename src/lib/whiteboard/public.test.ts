import { describe, expect, it } from "vitest";
import { publicWhiteboardScene, whiteboardFileKeys } from "@/lib/whiteboard/public";

const key = "note-files/user1/11111111-1111-1111-1111-111111111111.png";
const fileUrl = `/api/pages/files?key=${encodeURIComponent(key)}&name=photo.png`;

describe("public whiteboards", () => {
  it("lists the note files the board refers to", () => {
    const keys = whiteboardFileKeys({ elements: [], files: { a: { dataURL: fileUrl }, b: { url: fileUrl }, c: { dataURL: "https://evil.example/x.png" }, d: null } });
    expect([...keys]).toEqual([key]);
    expect(whiteboardFileKeys(null).size).toBe(0);
    expect(whiteboardFileKeys({ files: [] }).size).toBe(0);
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
