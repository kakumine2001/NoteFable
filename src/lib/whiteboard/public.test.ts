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

  it("keeps collapsed mind map branches out of public scenes", () => {
    const stash = [{ id: "hidden", type: "rectangle", customData: { notefableMindmap: { v: 1, role: "node", tree: "root", parent: "root", order: 0 } } }, { id: "hidden-t", type: "text", text: "secret" }];
    const scene = publicWhiteboardScene({
      elements: [{ id: "root", type: "rectangle", customData: { notefableMindmap: { v: 1, role: "node", tree: "root", parent: null, order: 0, collapsed: true, stash } } }],
    }, "token", "page");
    expect(JSON.stringify(scene)).not.toContain("secret");
    expect(scene.elements[0].customData).toBeUndefined();
  });

  it("strips customData.generated from AI-generated whiteboard images on public shares", () => {
    const scene = publicWhiteboardScene({
      elements: [
        image("ai", "a", { customData: { generated: { prompt: "Private internal prompt text" } } }),
      ],
      files: { a: { id: "a", mimeType: "image/png", dataURL: fileUrl } },
    }, "tok", "page1");
    expect(scene.elements).toHaveLength(1);
    expect(scene.elements[0].customData).toBeUndefined();
    expect(JSON.stringify(scene)).not.toContain("Private internal prompt text");
    expect(JSON.stringify(scene)).not.toContain("generated");
  });

  it("updates in-tree page cards and redacts out-of-tree cards when cards map is provided", () => {
    const scene = publicWhiteboardScene({
      elements: [
        {
          id: "card-in",
          type: "rectangle",
          width: 280,
          height: 72,
          link: "/app?view=pages&page=in1",
          boundElements: [{ id: "text-in", type: "text" }],
          customData: { notefablePage: { id: "in1", kind: "note" } },
        },
        { id: "text-in", type: "text", containerId: "card-in", text: "📄 Stale Title", originalText: "📄 Stale Title", fontSize: 18 },
        {
          id: "card-out",
          type: "rectangle",
          x: 400,
          y: 100,
          width: 280,
          height: 60,
          link: "/app?view=pages&page=priv1",
          boundElements: [{ id: "text-out", type: "text" }],
          customData: { notefablePage: { id: "priv1", kind: "note" } },
        },
        { id: "text-out", type: "text", containerId: "card-out", x: 414, y: 120, height: 22, text: "📄 Secret Title", originalText: "📄 Secret Title", fontSize: 18 },
        image("eq1", "a", { customData: { notefableFormula: { v: 1, latex: "a^2 + b^2 = c^2" } } }),
      ],
      files: { a: { id: "a", mimeType: "image/png", dataURL: fileUrl } },
    }, "tok", "page1", {
      cards: {
        in1: { id: "in1", kind: "note", title: "Live Shared Title", icon: "📘", summary: "Do not embed summary in scene" },
      },
      untitled: "Untitled",
      unavailableLabel: "This page is not available",
    });

    const inCard = scene.elements.find((e) => e.id === "card-in")!;
    const inText = scene.elements.find((e) => e.id === "text-in")!;
    const outCard = scene.elements.find((e) => e.id === "card-out")!;
    const outText = scene.elements.find((e) => e.id === "text-out")!;
    const eqEl = scene.elements.find((e) => e.id === "eq1")!;

    expect(inCard.customData).toEqual({ notefablePage: { id: "in1", kind: "note" } });
    expect(inCard.link).toBe("/app?view=pages&page=in1");
    expect(inText.originalText).toBe("📘 Live Shared Title");

    expect(outCard.customData).toBeUndefined();
    expect(outCard.link).toBeNull();
    expect(outText.originalText).toBe("This page is not available");
    expect(typeof outText.height === "number" && outText.height >= 45).toBe(true);
    expect(typeof outCard.height === "number" && outCard.height >= (outText.height as number) + 24).toBe(true);
    expect(outText.y).toBe(100 + ((outCard.height as number) - (outText.height as number)) / 2);
    expect(JSON.stringify(scene)).not.toContain("Secret Title");
    expect(JSON.stringify(scene)).not.toContain("priv1");
    expect(JSON.stringify(scene)).not.toContain("Do not embed summary in scene");

    // Formula image stays visible via public file URL; internal customData is stripped.
    expect(eqEl.fileId).toBe("a");
    expect(eqEl.customData).toBeUndefined();
    expect(scene.files?.a.dataURL).toBe(`/s/tok/file?page=page1&key=${encodeURIComponent(key)}&name=photo.png`);
  });

  it("honors removed or retargeted page-card links on public shares instead of restoring stale metadata", () => {
    const scene = publicWhiteboardScene({
      elements: [
        // リンクが外されたカード（元ページがツリー内でも link を復活させない）
        {
          id: "unlinked-in",
          type: "rectangle",
          width: 280,
          height: 70,
          link: null,
          boundElements: [{ id: "unlinked-in-t", type: "text" }],
          customData: { notefablePage: { id: "in1", kind: "note" } },
        },
        { id: "unlinked-in-t", type: "text", containerId: "unlinked-in", text: "Custom Note", originalText: "Custom Note", fontSize: 18 },
        // 外部 URL に変えられたカード（外部リンクを保ち、notefablePage を外す）
        {
          id: "ext-card",
          type: "rectangle",
          width: 280,
          height: 70,
          link: "https://example.com/docs",
          boundElements: [{ id: "ext-card-t", type: "text" }],
          customData: { notefablePage: { id: "in1", kind: "note" } },
        },
        { id: "ext-card-t", type: "text", containerId: "ext-card", text: "Docs", originalText: "Docs", fontSize: 18 },
        // 別の公開ページへ付け替えられたカード（新しい link 先へ追従）
        {
          id: "retargeted",
          type: "rectangle",
          width: 280,
          height: 70,
          link: "/app?view=pages&page=in2",
          boundElements: [{ id: "retargeted-t", type: "text" }],
          customData: { notefablePage: { id: "in1", kind: "note" } },
        },
        { id: "retargeted-t", type: "text", containerId: "retargeted", text: "Old Target", originalText: "Old Target", fontSize: 18 },
      ],
    }, "tok", "page1", {
      cards: {
        in1: { id: "in1", kind: "note", title: "Original In-Tree", icon: "📘", summary: "" },
        in2: { id: "in2", kind: "whiteboard", title: "New In-Tree Target", icon: "🧩", summary: "" },
      },
      untitled: "Untitled",
      unavailableLabel: "This page is not available",
    });

    const unlinked = scene.elements.find((e) => e.id === "unlinked-in")!;
    const ext = scene.elements.find((e) => e.id === "ext-card")!;
    const retargeted = scene.elements.find((e) => e.id === "retargeted")!;
    const retargetedText = scene.elements.find((e) => e.id === "retargeted-t")!;

    expect(unlinked.link).toBeNull();
    expect(unlinked.customData).toBeUndefined();
    expect(ext.link).toBe("https://example.com/docs");
    expect(ext.customData).toBeUndefined();
    expect(retargeted.link).toBe("/app?view=pages&page=in2");
    expect(retargeted.customData).toEqual({ notefablePage: { id: "in2", kind: "whiteboard" } });
    expect(retargetedText.originalText).toBe("🧩 New In-Tree Target");
  });
});
