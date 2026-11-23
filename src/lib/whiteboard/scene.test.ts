import { describe, expect, it } from "vitest";
import { validateCanvasData } from "@/lib/canvas-document";
import { fitStoredWhiteboard, pickWhiteboardAppState, sceneToStored, simplifyFreedraw, simplifyIndexes, storedSize, storedToScene, type WhiteboardElement } from "@/lib/whiteboard/scene";

const fileUrl = "/api/pages/files?key=note-files%2Fuser1%2F11111111-1111-1111-1111-111111111111.png&name=a.png";
const element = (id: string, extra: Record<string, unknown> = {}): WhiteboardElement => ({ id, type: "rectangle", x: 10.123456, y: -0.001, width: 100, height: 50, ...extra });

describe("sceneToStored", () => {
  it("drops deleted elements, rounds coordinates and keeps only the saved view settings", () => {
    const { data, pending } = sceneToStored({
      elements: [element("a"), element("b", { isDeleted: true }), { id: "f", type: "freedraw", x: 0, y: 0, points: [[0.123456, 1.987654]], pressures: [0.55555] }],
      files: {},
      appState: { viewBackgroundColor: "#fffce8", gridModeEnabled: true, scrollX: 100, zoom: { value: 2 }, selectedElementIds: { a: true } },
    });
    expect(pending).toBe(0);
    expect(data.elements.map((entry) => entry.id)).toEqual(["a", "f"]);
    expect(data.elements[0]).toMatchObject({ x: 10.12, y: 0 });
    expect(data.elements[1]).toMatchObject({ points: [[0.12, 1.99]], pressures: [0.556] });
    expect(data.appState).toEqual({ viewBackgroundColor: "#fffce8", gridModeEnabled: true });
    expect(data.files).toBeUndefined();
  });

  it("keeps uploaded images with their note-file URL and holds back images still uploading, with their labels", () => {
    const { data, pending } = sceneToStored({
      elements: [
        element("img1", { type: "image", fileId: "f1" }),
        element("img2", { type: "image", fileId: "f2" }),
        element("label", { type: "text", containerId: "img2", text: "hi" }),
        element("img3", { type: "image", fileId: "f3" }),
      ],
      files: {
        f1: { id: "f1", mimeType: "image/png", dataURL: "data:image/png;base64,AAAA" },
        f2: { id: "f2", mimeType: "image/png", dataURL: "data:image/png;base64,BBBB" },
        f3: { id: "f3", mimeType: "image/png", dataURL: fileUrl, created: 5 },
      },
      appState: {},
      uploaded: new Map([["f1", { url: fileUrl, mimeType: "image/jpeg" }]]),
    });
    expect(pending).toBe(1);
    expect(data.elements.map((entry) => entry.id)).toEqual(["img1", "img3"]);
    expect(data.files).toEqual({
      f1: { id: "f1", mimeType: "image/jpeg", dataURL: fileUrl },
      f3: { id: "f3", mimeType: "image/png", dataURL: fileUrl, created: 5 },
    });
    // サーバーの検証（埋め込み画像なし・本人のファイル）を通る形。
    expect(() => validateCanvasData("whiteboard", data)).not.toThrow();
  });

  it("never stores an embedded data: URL, even for files no element uses", () => {
    const { data } = sceneToStored({ elements: [element("a")], files: { f: { id: "f", mimeType: "image/png", dataURL: "data:image/png;base64,AAAA" } }, appState: {} });
    expect(JSON.stringify(data)).not.toContain("data:");
  });
});

describe("storedToScene", () => {
  it("filters broken elements and files and keeps note-file URLs", () => {
    const image = (id: string, fileId: string) => element(id, { type: "image", fileId });
    const scene = storedToScene({
      elements: [element("a"), { id: 3 }, element("gone", { isDeleted: true }), "x", image("i1", "ok"), image("i2", "old"), image("i3", "bad"), image("i4", "junk")],
      files: { ok: { mimeType: "image/png", dataURL: fileUrl }, old: { url: fileUrl }, bad: { dataURL: "https://evil.example/x.png" }, junk: 1, unused: { dataURL: fileUrl } },
      appState: { gridModeEnabled: false, gridSize: -1, theme: "dark" },
    });
    expect(scene.elements.map((entry) => entry.id)).toEqual(["a", "i1", "i2", "i3", "i4"]);
    // どの画像要素も使っていないファイルは入れない。
    expect(Object.keys(scene.files)).toEqual(["ok", "old"]);
    expect(scene.files.old).toMatchObject({ id: "old", mimeType: "image/png", dataURL: fileUrl });
    expect(scene.appState).toEqual({ gridModeEnabled: false });
  });

  it("drops element types NoteFable cannot place (embeds, HTML frames)", () => {
    const scene = storedToScene({ elements: [element("a"), element("e", { type: "embeddable" }), element("f", { type: "iframe" }), element("m", { type: "magicframe" }), element("s", { type: "stickynote" })] });
    expect(scene.elements.map((entry) => entry.id)).toEqual(["a", "s"]);
  });

  it("returns an empty scene for missing data", () => {
    expect(storedToScene(undefined)).toEqual({ elements: [], files: {}, appState: {} });
  });
});

describe("pickWhiteboardAppState", () => {
  it("accepts only sane values", () => {
    expect(pickWhiteboardAppState({ viewBackgroundColor: "", gridSize: 20, gridStep: 2.5, objectsSnapModeEnabled: true })).toEqual({ gridSize: 20, objectsSnapModeEnabled: true });
    expect(pickWhiteboardAppState(null)).toEqual({});
  });
});

describe("freehand simplification", () => {
  it("keeps the end points and the corners, and drops points on a straight run", () => {
    const points = [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1], [3, 2]] as const;
    expect(simplifyIndexes(points, 0.1)).toEqual([0, 3, 5]);
  });

  it("thins a stroke and its pressures together", () => {
    const stroke = { id: "s", type: "freedraw", points: [[0, 0], [1, 0.01], [2, 0], [3, 3]], pressures: [0.1, 0.2, 0.3, 0.4] };
    expect(simplifyFreedraw(stroke, 0.5)).toEqual({ ...stroke, points: [[0, 0], [2, 0], [3, 3]], pressures: [0.1, 0.3, 0.4] });
    expect(simplifyFreedraw(element("r"), 1)).toEqual(element("r"));
  });

  it("only simplifies when the board is over the budget", () => {
    const wiggle = Array.from({ length: 400 }, (_, index) => [index, (index % 2) * 0.05]);
    const data = { elements: [{ id: "s", type: "freedraw", points: wiggle }] };
    expect(fitStoredWhiteboard(data, 1_000_000)).toMatchObject({ simplified: false, data });
    const fitted = fitStoredWhiteboard(data, 600);
    expect(fitted.simplified).toBe(true);
    expect(fitted.size).toBeLessThan(storedSize(data));
    expect((fitted.data.elements[0].points as unknown[]).length).toBeLessThan(400);
  });
});
