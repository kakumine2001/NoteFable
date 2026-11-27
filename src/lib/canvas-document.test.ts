import { describe, expect, it } from "vitest";
import {
  assertCanvasFilesOwner, canvasReadableText, canvasSearchBlocks, emptyCanvasData, extractCanvasSegments, MAX_CANVAS_BYTES, MAX_CANVAS_TEXT,
  MAX_SLIDES, MAX_WHITEBOARD_ELEMENTS, parseCanvasSegments, searchableBlocks, validateCanvasData, validateCanvasPage,
} from "./canvas-document";
import { NoteValidationError } from "./note-document";
import { blockText, extractNoteChunks, walkBlocks } from "./note-text";
import { isCanvasKind, isPageKind, PAGE_KIND_FEATURES, pageKindOf } from "./page-kinds";

const OWNER = "owner1";
const fileUrl = (owner = OWNER) => `/api/pages/files?key=note-files/${owner}/123e4567-e89b-12d3-a456-426614174000.png&name=photo.png`;
const status = (run: () => unknown) => { try { run(); return 0; } catch (error) { return error instanceof NoteValidationError ? error.status : -1; } };

describe("page kinds", () => {
  it("knows the three kinds and treats missing or unknown kinds as notes (old responses and apps)", () => {
    expect(isPageKind("whiteboard")).toBe(true);
    expect(isPageKind("canvas")).toBe(false);
    expect(isCanvasKind("slides")).toBe(true);
    expect(isCanvasKind("note")).toBe(false);
    expect(pageKindOf({})).toBe("note");
    expect(pageKindOf({ kind: "board" })).toBe("note");
    expect(pageKindOf(null)).toBe("note");
    expect(pageKindOf({ kind: "slides" })).toBe("slides");
  });

  it("keeps note-only features for notes and turns on each canvas kind as its editor ships", () => {
    expect(PAGE_KIND_FEATURES.note).toEqual({ editor: true, markdownExport: true, typography: true, publicShare: true, aiEdit: true });
    // ホワイトボードのエディターと読み取り専用の公開ビュー（#152）＋ AI 編集（#153）。
    expect(PAGE_KIND_FEATURES.whiteboard).toEqual({ editor: true, markdownExport: false, typography: false, publicShare: true, aiEdit: true });
    // スライドのエディターと公開の放映ページ（#149）＋ AI 編集（#150）。
    expect(PAGE_KIND_FEATURES.slides).toEqual({ editor: true, markdownExport: false, typography: false, publicShare: true, aiEdit: true });
  });
});

describe("whiteboard and slide data", () => {
  it("starts empty", () => {
    expect(emptyCanvasData("whiteboard")).toEqual({ elements: [] });
    expect(emptyCanvasData("slides")).toEqual({ slides: [] });
    expect(validateCanvasData("whiteboard", emptyCanvasData("whiteboard")).size).toBe(15);
  });

  it("accepts an Excalidraw-like whiteboard with uploaded images, and a slide deck with notes", () => {
    const board = {
      elements: [{ id: "r1", type: "rectangle", x: 0, y: 0 }, { id: "t1", type: "text", text: "Hello", containerId: "r1" }, { id: "i1", type: "image", fileId: "f1" }],
      files: { f1: { id: "f1", mimeType: "image/png", dataURL: fileUrl() } }, appState: { viewBackgroundColor: "#fff" },
    };
    expect(validateCanvasData("whiteboard", board)).toMatchObject({ data: board, fileOwners: [OWNER] });
    const deck = { theme: { name: "light" }, slides: [{ id: "s1", layout: "title", notes: "Say hi", elements: [{ id: "e1", type: "text", content: { type: "doc", content: [{ type: "text", text: "Hi" }] } }] }] };
    expect(validateCanvasData("slides", deck).fileOwners).toEqual([]);
  });

  it("rejects wrong shapes, duplicate or missing IDs and too many items", () => {
    const bad = [
      ["whiteboard", null], ["whiteboard", []], ["whiteboard", { elements: {} }], ["whiteboard", { slides: [] }],
      ["whiteboard", { elements: [{ id: "a", type: "text" }, { id: "a", type: "text" }] }],
      ["whiteboard", { elements: [{ type: "text" }] }], ["whiteboard", { elements: [{ id: "a" }] }],
      ["whiteboard", { elements: [{ id: "a", type: "text", isDeleted: "yes" }] }],
      // 埋め込み（外部のページ・任意の HTML）と AI の枠は置けない。
      ["whiteboard", { elements: [{ id: "a", type: "iframe", customData: { generationData: { status: "done", html: "<script>alert(1)</script>" } } }] }],
      ["whiteboard", { elements: [{ id: "a", type: "embeddable", link: "https://val.town/x" }] }],
      ["whiteboard", { elements: [{ id: "a", type: "magicframe" }] }],
      ["whiteboard", { elements: [], files: { f: { dataURL: "https://example.com/x.png" } } }],
      // もう一方の種類の外枠は持てない（種類を取り違えない）。
      ["whiteboard", { elements: [], slides: [] }], ["slides", { slides: [], elements: [] }],
      ["slides", { slides: [{ id: "s" }, { id: "s" }] }], ["slides", { slides: [{ id: "s", notes: 5 }] }],
      ["slides", { slides: [{ id: "s", elements: [{ id: "e" }] }, { id: "t", elements: [{ id: "e" }] }] }],
      ["slides", { slides: Array.from({ length: MAX_SLIDES + 1 }, (_, index) => ({ id: `s${index}` })) }],
      ["whiteboard", { elements: Array.from({ length: MAX_WHITEBOARD_ELEMENTS + 1 }, (_, index) => ({ id: `e${index}`, type: "line" })) }],
    ] as const;
    for (const [kind, value] of bad) expect(status(() => validateCanvasData(kind, value)), JSON.stringify(value)?.slice(0, 80)).toBe(400);
  });

  it("rejects embedded base64 images, NUL characters and absurd nesting", () => {
    expect(() => validateCanvasData("whiteboard", { elements: [], files: { f: { dataURL: "data:image/png;base64,AAAA" } } })).toThrow("Images must be uploaded");
    expect(() => validateCanvasData("slides", { slides: [{ id: "s", elements: [{ id: "e", src: " DATA:image/jpeg;base64,/9j/" }] }] })).toThrow("Images must be uploaded");
    expect(status(() => validateCanvasData("whiteboard", { elements: [{ id: "a", type: "text", text: "bad\u0000" }] }))).toBe(400);
    // URL エンコードの画像も埋め込み。ふつうの文の "data:" は通す。
    expect(() => validateCanvasData("whiteboard", { elements: [], files: { f: { dataURL: "data:image/svg+xml,%3Csvg%3E" } } })).toThrow("Images must be uploaded");
    expect(validateCanvasData("whiteboard", { elements: [{ id: "t", type: "text", text: "data: see the chart" }] }).size).toBeGreaterThan(0);
    // 片方だけのサロゲートは jsonb に保存できないので 400（500 にしない）。
    expect(status(() => validateCanvasData("whiteboard", { elements: [{ id: "a", type: "text", text: "x\ud83d" }] }))).toBe(400);
    expect(status(() => validateCanvasData("slides", { slides: [{ id: "s", notes: "\ude00y" }] }))).toBe(400);
    let deep: Record<string, unknown> = { leaf: true };
    for (let index = 0; index < 80; index++) deep = { next: deep };
    expect(status(() => validateCanvasData("whiteboard", { elements: [], appState: deep }))).toBe(400);
    // JSON.stringify がスタックを使い切る深さでも、500 ではなく 400 で断る（深さを先に数える）。
    let veryDeep: Record<string, unknown> = { leaf: true };
    for (let index = 0; index < 20_000; index++) veryDeep = { a: veryDeep };
    expect(status(() => validateCanvasData("whiteboard", { elements: [], appState: veryDeep }))).toBe(400);
    expect(status(() => validateCanvasData("whiteboard", { elements: [{ id: "x", type: "image", link: " /api/pages/files?key=../../etc" }] }))).toBe(400);
  });

  it("refuses more than 2 MB with 413", () => {
    expect(MAX_CANVAS_BYTES.whiteboard).toBe(2 * 1024 * 1024);
    const huge = { elements: [{ id: "f", type: "freedraw", points: "x".repeat(MAX_CANVAS_BYTES.whiteboard) }] };
    expect(status(() => validateCanvasData("whiteboard", huge))).toBe(413);
  });

  it("lists the owners of referenced files so another user's files cannot be used", () => {
    const canvas = validateCanvasData("whiteboard", { elements: [], files: { a: { dataURL: fileUrl() }, b: { url: fileUrl("someoneelse") } } });
    expect(canvas.fileOwners.sort()).toEqual([OWNER, "someoneelse"]);
    // 参照しているファイルの保存先も集める（保存のたびに使用中へ戻し、ストレージの後片付けに消させない）。
    expect(canvas.filePaths.sort()).toEqual([`note-files/${OWNER}/123e4567-e89b-12d3-a456-426614174000.png`, "note-files/someoneelse/123e4567-e89b-12d3-a456-426614174000.png"]);
    expect(() => assertCanvasFilesOwner(canvas, OWNER)).toThrow("not yours");
    expect(() => assertCanvasFilesOwner({ fileOwners: [OWNER] }, OWNER)).not.toThrow();
    // ファイルの URL の形をしているのに読めないものは、壊れたデータとして断る。
    expect(status(() => validateCanvasData("whiteboard", { elements: [{ id: "x", type: "image", link: "/api/pages/files?key=../../etc" }] }))).toBe(400);
  });

  it("validates page input: title, icon, no cover, optional data", () => {
    expect(validateCanvasPage("whiteboard", { title: "  ", icon: null })).toEqual({ title: "Untitled", icon: null, fileOwners: [], filePaths: [] });
    expect(validateCanvasPage("slides", { title: "Deck", icon: "📊", data: { slides: [] } })).toMatchObject({ title: "Deck", icon: "📊", data: { slides: [] }, size: 13 });
    for (const body of [{ title: "x".repeat(201) }, { title: "x", icon: "not an emoji" }, { title: "x", cover: "gradient-mint" }, { title: "x", blocks: [] }, { title: 1 }]) {
      expect(status(() => validateCanvasPage("whiteboard", body)), JSON.stringify(body)).toBe(400);
    }
  });
});

describe("text for search, semantic search and chat", () => {
  it("collects live whiteboard text by element, folding bound text into its shape and frame names into the frame", () => {
    const data = {
      elements: [
        { id: "r1", type: "rectangle" }, { id: "t1", type: "text", text: "wrapped\ntext", originalText: "wrapped text", containerId: "r1" },
        { id: "t2", type: "text", text: "  Free   note " }, { id: "f1", type: "frame", name: "Ideas" },
        { id: "gone", type: "text", text: "deleted", isDeleted: true }, { id: "s1", type: "freedraw", points: [[0, 0], [1, 1]] },
      ],
    };
    expect(extractCanvasSegments("whiteboard", data)).toEqual([{ id: "r1", text: "wrapped text" }, { id: "t2", text: "Free note" }, { id: "f1", text: "Ideas" }]);
  });

  it("collects slide text and speaker notes by slide, including rich text", () => {
    const data = {
      slides: [
        { id: "a", elements: [{ id: "e1", type: "text", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Title" }, { type: "text", text: "here" }] }] } }], notes: "remember" },
        { id: "b", elements: [{ id: "e2", type: "image", src: fileUrl() }] },
        { id: "c", elements: [{ id: "e3", type: "text", text: "Plain" }] },
      ],
    };
    expect(extractCanvasSegments("slides", data)).toEqual([{ id: "a", text: "Title here remember", index: 0 }, { id: "c", text: "Plain", index: 2 }]);
  });

  it("never cuts an emoji in half when a long text is shortened", () => {
    const text = `${"a".repeat(7999)}😀tail`;
    const [segment] = extractCanvasSegments("whiteboard", { elements: [{ id: "t", type: "text", text }] });
    expect(segment.text).toBe("a".repeat(7999));
  });

  it("stays linear when one element or slide holds a huge number of texts", () => {
    const leaves = Array.from({ length: 150_000 }, () => ({ type: "text", text: "a" }));
    const started = Date.now();
    const [segment] = extractCanvasSegments("slides", { slides: [{ id: "s", elements: [{ id: "e", type: "text", content: leaves }] }] });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(segment.text.length).toBeLessThanOrEqual(8000);
  });

  it("caps the extracted text", () => {
    const elements = Array.from({ length: 30 }, (_, index) => ({ id: `t${index}`, type: "text", text: "x".repeat(8000) }));
    const segments = extractCanvasSegments("whiteboard", { elements });
    expect(segments.reduce((sum, segment) => sum + segment.text.length, 0)).toBeLessThanOrEqual(MAX_CANVAS_TEXT);
  });

  it("files the text of a collapsed mindmap branch under the collapsed node", () => {
    const collapsed = {
      id: "node", type: "rectangle",
      customData: { notefableMindmap: { v: 1, role: "node", tree: "node", parent: null, order: 0, collapsed: true, stash: [
        { id: "child", type: "rectangle" }, { id: "child-t", type: "text", containerId: "child", text: "hidden idea", originalText: "hidden idea" },
      ] } },
    };
    const segments = extractCanvasSegments("whiteboard", { elements: [collapsed, { id: "node-t", type: "text", containerId: "node", text: "Topic" }] });
    expect(segments.map((segment) => segment.id)).toEqual(["node"]);
    expect(segments[0].text.split(" ").sort()).toEqual(["Topic", "hidden", "idea"].sort());
  });

  it("keeps the title and every hidden topic of a large collapsed branch, split under the collapsed node", () => {
    const stash = Array.from({ length: 300 }, (_, index) => ({ id: `c${index}`, type: "text", containerId: `n${index}`, text: `topic-${index} ${"x".repeat(40)}` }));
    const collapsed = { id: "node", type: "rectangle", customData: { notefableMindmap: { v: 1, role: "node", tree: "node", parent: null, order: 0, collapsed: true, stash } } };
    // 図形は、その図形の文字より前に並ぶ。
    const segments = extractCanvasSegments("whiteboard", { elements: [collapsed, { id: "node-t", type: "text", containerId: "node", text: "Visible title" }] });
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.every((segment) => segment.id === "node" && segment.text.length <= 8_000)).toBe(true);
    expect(segments[0].text.startsWith("Visible title topic-0 ")).toBe(true);
    expect(segments.at(-1)!.text).toContain("topic-299 ");
  });

  it("turns segments into blocks the note search helpers understand, so hits point at elements or slides", () => {
    const segments = [{ id: "e1", text: "alpha" }, { id: "e2", text: "beta gamma" }];
    const blocks = canvasSearchBlocks(segments);
    expect([...walkBlocks(blocks)].map((block) => [block.id, blockText(block)])).toEqual([["e1", "alpha"], ["e2", "beta gamma"]]);
    expect(extractNoteChunks("Board", blocks)[0]).toMatchObject({ blockId: "e1", chunkText: "alpha beta gamma" });
    expect(searchableBlocks("whiteboard", [], segments)).toEqual(blocks);
    const noteBlocks = [{ id: "b" }];
    expect(searchableBlocks("note", noteBlocks, segments)).toBe(noteBlocks);
    expect(parseCanvasSegments([{ id: "a", text: "x" }, { id: 1, text: "y" }, null, "z"])).toEqual([{ id: "a", text: "x" }]);
  });

  it("reads as a bullet list (whiteboard) or numbered slides for the AI and chat context", () => {
    expect(canvasReadableText("whiteboard", [{ id: "a", text: "One" }, { id: "b", text: "Two" }])).toBe("- One\n- Two");
    expect(canvasReadableText("slides", [{ id: "a", text: "Intro" }, { id: "b", text: "End" }])).toBe("Slide 1: Intro\nSlide 2: End");
    // 文字の無いスライドがあっても、番号は実際の何枚目か。
    expect(canvasReadableText("slides", [{ id: "a", text: "Intro", index: 0 }, { id: "c", text: "End", index: 2 }])).toBe("Slide 1: Intro\nSlide 3: End");
  });

  it("validates optional slide transition strings on slide decks", () => {
    expect(() => validateCanvasData("slides", { slides: [{ id: "s1", transition: "fade", elements: [] }] })).not.toThrow();
    expect(() => validateCanvasData("slides", { slides: [{ id: "s1", transition: "slide", elements: [] }] })).not.toThrow();
    expect(status(() => validateCanvasData("slides", { slides: [{ id: "s1", transition: 123, elements: [] }] }))).toBe(400);
    expect(status(() => validateCanvasData("slides", { slides: [{ id: "s1", transition: "x".repeat(65), elements: [] }] }))).toBe(400);
  });

  it("allows literal data: URLs in slide text, code, table cells, and notes while still rejecting them in resource fields", () => {
    const quoted = "data:image/png;base64,iVBORw0KGgo=";
    const validDeck = {
      slides: [{
        id: "s1",
        notes: quoted,
        elements: [
          { id: "e1", type: "text", doc: { type: "doc", content: [{ type: "code_block", content: [{ type: "text", text: quoted }] }] } },
          { id: "e2", type: "table", rows: [{ cells: [{ text: quoted }] }] },
        ],
      }],
    };
    expect(() => validateCanvasData("slides", validDeck)).not.toThrow();
    // 実際の画像ソース・リンク URL への data: URL 埋め込みは引き続き拒否する。
    expect(() => validateCanvasData("slides", { slides: [{ id: "s1", elements: [{ id: "e1", type: "image", src: quoted }] }] })).toThrow("Images must be uploaded");
    expect(() => validateCanvasData("slides", {
      slides: [{
        id: "s1",
        elements: [{
          id: "e1",
          type: "text",
          doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "img", marks: [{ type: "link", attrs: { href: quoted } }] }] }] },
        }],
      }],
    })).toThrow("Images must be uploaded");
  });
});
