import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { MAX_MATH_LATEX, MAX_NOTE_BYTES, readNoteRequest, topLevelJsonFields, validateNoteContent, validateNoteUpdate } from "./note-document";

const paragraph = { id: "p1", type: "paragraph", props: { textColor: "default", backgroundColor: "default", textAlignment: "left" }, content: [{ type: "text", text: "中文 日本語", styles: { bold: true } }], children: [] };

describe("page document boundary", () => {
  it("preserves CJK text, block ordering, nested lists and formatting", () => {
    const blocks = [paragraph, { id: "p2", type: "checkListItem", props: { checked: true }, content: [], children: [{ ...paragraph, id: "p3" }] }, { id: "p4", type: "codeBlock", props: { language: "javascript" }, content: [{ type: "text", text: "const a = 1;", styles: {} }], children: [] }, { id: "p5", type: "divider", props: {}, children: [] }];
    expect(validateNoteContent({ title: " 学习笔记 ", blocks })).toEqual({ title: "学习笔记", icon: null, cover: null, coverPosition: null, blocks });
  });

  it.each(["image", "file", "table", "video", "html"])("rejects unsupported or malformed %s blocks", (type) => {
    expect(() => validateNoteContent({ title: "Test", blocks: [{ ...paragraph, type }] })).toThrow("unsupported");
  });

  it("accepts toggles, toggle headings, callouts and tableOfContents", () => {
    const blocks = [
      { ...paragraph, id: "t1", type: "toggleListItem", children: [{ ...paragraph, id: "t2" }] },
      { ...paragraph, id: "t3", type: "heading", props: { level: 2, isToggleable: true } },
      { ...paragraph, id: "t4", type: "callout", props: { emoji: "💡", backgroundColor: "gray", textColor: "default" } },
      { id: "toc1", type: "tableOfContents", props: { textColor: "default", backgroundColor: "default" }, children: [] },
    ];
    expect(() => validateNoteContent({ title: "Test", blocks })).not.toThrow();
    expect(() => validateNoteContent({ title: "Test", blocks: [{ ...paragraph, type: "callout", props: { emoji: "abc" } }] })).toThrow("unsupported");
    expect(() => validateNoteContent({ title: "Test", blocks: [{ ...paragraph, props: { emoji: "💡" } }] })).toThrow("unsupported");
    expect(() => validateNoteContent({ title: "Test", blocks: [{ id: "tocBad1", type: "tableOfContents", props: {}, content: [], children: [] }] })).toThrow("unsupported");
    expect(() => validateNoteContent({ title: "Test", blocks: [{ id: "tocBad2", type: "tableOfContents", props: { textAlignment: "center" }, children: [] }] })).toThrow("unsupported");
  });

  it("validates math blocks and inline math nodes", () => {
    const blocks = [
      { id: "m1", type: "mathBlock", props: { latex: "\\int_0^1 x^2\\,dx = \\frac{1}{3}", textColor: "default", backgroundColor: "gray" }, children: [] },
      { id: "m2", type: "paragraph", props: {}, content: [
        { type: "text", text: "Euler: ", styles: {} },
        { type: "mathInline", props: { latex: "e^{i\\pi} + 1 = 0" } },
      ], children: [] },
    ];
    expect(() => validateNoteContent({ title: "Math", blocks })).not.toThrow();
    // mathBlock は content を持てない。
    expect(() => validateNoteContent({ title: "Math", blocks: [{ id: "bad1", type: "mathBlock", props: { latex: "x" }, content: [], children: [] }] })).toThrow("unsupported");
    // latex の上限と NUL 禁止。
    expect(() => validateNoteContent({ title: "Math", blocks: [{ id: "bad2", type: "mathBlock", props: { latex: "x".repeat(MAX_MATH_LATEX + 1) }, children: [] }] })).toThrow("unsupported");
    expect(() => validateNoteContent({ title: "Math", blocks: [{ id: "bad3", type: "mathBlock", props: { latex: "a\u0000b" }, children: [] }] })).toThrow("unsupported");
    // mathInline はリンクやコードブロックの中には置けない。
    expect(() => validateNoteContent({ title: "Math", blocks: [{ id: "bad4", type: "codeBlock", props: { language: "text" }, content: [{ type: "mathInline", props: { latex: "x" } }], children: [] }] })).toThrow("unsupported");
    expect(() => validateNoteContent({ title: "Math", blocks: [{ id: "bad5", type: "paragraph", props: {}, content: [{ type: "link", href: "https://example.com", content: [{ type: "mathInline", props: { latex: "x" } }] }], children: [] }] })).toThrow("unsupported");
    // mathInline に未知の props や content は不可。
    expect(() => validateNoteContent({ title: "Math", blocks: [{ id: "bad6", type: "paragraph", props: {}, content: [{ type: "mathInline", props: { latex: "x", extra: true } }], children: [] }] })).toThrow("unsupported");
    expect(() => validateNoteContent({ title: "Math", blocks: [{ id: "bad7", type: "paragraph", props: {}, content: [{ type: "mathInline", props: { latex: "x" }, content: [] }], children: [] }] })).toThrow("unsupported");
  });

  it("validates whiteboard embed blocks", () => {
    const blocks = [
      { id: "w1", type: "whiteboard", props: { pageId: "wb_123", frameId: "" }, children: [] },
      { id: "w2", type: "whiteboard", props: { pageId: "wb_123", frameId: "frame-1" }, children: [] },
      { id: "w3", type: "whiteboard", props: { pageId: "", frameId: "" }, children: [] },
    ];
    expect(() => validateNoteContent({ title: "Board note", blocks })).not.toThrow();
    // frameId without pageId is rejected.
    expect(() => validateNoteContent({ title: "Bad", blocks: [{ id: "wb1", type: "whiteboard", props: { pageId: "", frameId: "frame-1" }, children: [] }] })).toThrow("unsupported");
    // whiteboard blocks cannot carry inline content or unknown props.
    expect(() => validateNoteContent({ title: "Bad", blocks: [{ id: "wb2", type: "whiteboard", props: { pageId: "wb_123" }, content: [], children: [] }] })).toThrow("unsupported");
    expect(() => validateNoteContent({ title: "Bad", blocks: [{ id: "wb3", type: "whiteboard", props: { pageId: "wb_123", extra: "x" }, children: [] }] })).toThrow("unsupported");
    // invalid pageId or frameId characters are rejected.
    expect(() => validateNoteContent({ title: "Bad", blocks: [{ id: "wb4", type: "whiteboard", props: { pageId: "bad id" }, children: [] }] })).toThrow("unsupported");
    expect(() => validateNoteContent({ title: "Bad", blocks: [{ id: "wb5", type: "whiteboard", props: { pageId: "wb_123", frameId: "bad\u0000id" }, children: [] }] })).toThrow("unsupported");
  });

  it("validates table content", () => {
    const cell = (text: string, props: Record<string, unknown> = {}) => ({ type: "tableCell", props: { backgroundColor: "default", textColor: "default", textAlignment: "left", colspan: 1, rowspan: 1, ...props }, content: [{ type: "text", text, styles: {} }] });
    const table = (content: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id: "tb", type: "table", props: { textColor: "default" }, content: { type: "tableContent", columnWidths: [null, 120], headerRows: 1, ...content }, children: [], ...extra });
    const valid = (block: unknown) => () => validateNoteContent({ title: "Test", blocks: [block] });
    expect(valid(table({ rows: [{ cells: [cell("a"), cell("b", { colspan: 2 })] }, { cells: [[{ type: "text", text: "plain", styles: {} }], cell("d")] }] }))).not.toThrow();
    // BlockNote は見出しだけの行・列をすべて数えるので 1 を超えることがあり、行数・列数にも上限は置かない（大きさは 1 MiB で抑える）。
    expect(valid(table({ rows: [{ cells: [cell("a")] }, { cells: [cell("b")] }], headerRows: 2, headerCols: 1 }))).not.toThrow();
    expect(valid(table({ columnWidths: undefined, rows: Array.from({ length: 600 }, () => ({ cells: [cell("x"), cell("y")] })) }))).not.toThrow();
    expect(valid(table({ columnWidths: undefined, rows: [{ cells: Array.from({ length: 60 }, () => cell("x")) }] }))).not.toThrow();
    expect(valid(table({ rows: [] }))).toThrow("unsupported");
    expect(valid(table({ rows: [{ cells: [] }] }))).toThrow("unsupported");
    expect(valid(table({ rows: [{ cells: [cell("a")] }], headerRows: -1 }))).toThrow("unsupported");
    expect(valid(table({ rows: [{ cells: [cell("a")] }], headerCols: "1" }))).toThrow("unsupported");
    expect(valid(table({ rows: [{ cells: [cell("a", { colspan: 0 })] }] }))).toThrow("unsupported");
    expect(valid(table({ rows: [{ cells: [cell("a", { backgroundColor: "url(x)" })] }] }))).toThrow("unsupported");
    expect(valid(table({ rows: [{ cells: [{ ...cell("a"), content: [{ type: "link", href: "javascript:alert(1)", content: [] }] }] }] }))).toThrow("unsupported");
    expect(valid(table({ rows: [{ cells: [cell("a")] }] }, { children: [{ ...paragraph, id: "child" }] }))).toThrow("unsupported");
  });

  it("rejects script links, duplicate IDs and unsupported heading levels", () => {
    expect(() => validateNoteContent({ title: "Test", blocks: [{ ...paragraph, content: [{ type: "link", href: "javascript:alert(1)", content: paragraph.content }] }] })).toThrow();
    expect(() => validateNoteContent({ title: "Test", blocks: [paragraph, paragraph] })).toThrow();
    expect(() => validateNoteContent({ title: "Test", blocks: [{ ...paragraph, type: "heading", props: { level: 6 } }] })).toThrow();
  });

  it("requires a valid optimistic version", () => {
    expect(validateNoteUpdate({ title: "", blocks: [], version: 0 }).title).toBe("Untitled");
    expect(() => validateNoteUpdate({ title: "Test", blocks: [], version: -1 })).toThrow("version");
  });

  it("limits the bytes actually received without trusting Content-Length", async () => {
    const request = new Request("http://localhost/api/pages", { method: "POST", body: "x".repeat(MAX_NOTE_BYTES + 1) });
    await expect(readNoteRequest(request)).rejects.toMatchObject({ status: 413 });
    await expect(readNoteRequest(new Request("http://localhost/api/pages", { method: "POST", body: "{bad" }))).rejects.toThrow("Invalid JSON");
  });

  it("lets the caller pick the too-large message from the part it did read", async () => {
    const body = `{"kind":"slides","data":"${"x".repeat(200)}"}`;
    const pick = vi.fn((head: string) => (head.startsWith("{\"kind\":\"slides\"") ? "slides too large" : "other"));
    const request = new Request("http://localhost/api/pages", { method: "POST", body });
    await expect(readNoteRequest(request, 100, pick)).rejects.toMatchObject({ status: 413, message: "slides too large" });
    // 上限までの分を渡す（1 つの塊で届いた本文でも、先頭は読める）。
    expect(pick.mock.calls[0][0]).toBe(body.slice(0, 100));
    expect(await readNoteRequest(new Request("http://localhost/api/pages", { method: "POST", body: "{\"a\":1}" }), 100, pick)).toEqual({ a: 1 });
    // 文を選ぶ関数が失敗しても 413 のまま、既定の文で断る。
    const failing = () => { throw new Error("boom"); };
    await expect(readNoteRequest(new Request("http://localhost/api/pages", { method: "POST", body }), 100, failing))
      .rejects.toMatchObject({ status: 413, message: "Note content exceeds 1 MiB." });
  });
});

describe("reading top-level fields from cut-off JSON", () => {
  const kind = (text: string) => topLevelJsonFields(text).strings.get("kind") ?? null;

  it("finds keys only at the top level, even when the JSON is cut off later", () => {
    expect(kind("{\"kind\":\"whiteboard\",\"data\":{\"elements\":[{\"id\":\"a")).toBe("whiteboard");
    expect(kind(" \n{ \"title\" : \"x\" , \"kind\" : \"slides\" ")).toBe("slides");
    // 入れ子の中の同じ名前のキーは見ない。
    expect(kind("{\"data\":{\"kind\":\"slides\",\"list\":[\"kind\",{\"kind\":\"x\"}]},\"kind\":\"whiteboard\"")).toBe("whiteboard");
    const cut = topLevelJsonFields("{\"title\":\"a\",\"data\":{\"kind\":\"slides\"");
    expect([...cut.keys]).toEqual(["title", "data"]);
    expect(cut.strings.has("kind")).toBe(false);
  });

  it("keeps the last value of a repeated key, like JSON.parse", () => {
    expect(kind("{\"kind\":\"note\",\"kind\":\"slides\",\"data\":")).toBe("slides");
    expect(kind("{\"kind\":\"slides\",\"kind\":5}")).toBeNull();
  });

  it("is not fooled by escaped quotes or by values that look like the key", () => {
    expect(kind("{\"title\":\"say \\\"kind\\\":\\\"slides\\\"\",\"kind\":\"note\"}")).toBe("note");
    expect(kind("{\"title\":\"kind\",\"x\":\"slides\"}")).toBeNull();
    expect(kind("{\"kind\":5,\"other\":\"slides\"}")).toBeNull();
    expect(kind("{\"kind\":{\"a\":\"slides\"},\"b\":\"c\"}")).toBeNull();
  });

  it("gives up on cut-off values, other top-level shapes and broken strings", () => {
    expect(kind("{\"kind\":\"white")).toBeNull();
    expect(kind("{\"kind\":\"a\\")).toBeNull();
    expect(topLevelJsonFields("[\"kind\",\"slides\"]").keys.size).toBe(0);
    expect(topLevelJsonFields("").keys.size).toBe(0);
    expect(kind("{\"a\":1}{\"kind\":\"slides\"}")).toBeNull();
  });
});

describe("page icon and cover", () => {
  it("accepts one emoji icon and a preset cover, and defaults both to null", () => {
    expect(validateNoteContent({ title: "A", blocks: [] })).toMatchObject({ icon: null, cover: null, coverPosition: null });
    expect(validateNoteContent({ title: "A", icon: "📚", cover: "gradient-ocean", blocks: [] })).toMatchObject({ icon: "📚", cover: "gradient-ocean" });
    expect(validateNoteContent({ title: "A", icon: "👍🏽", blocks: [] }).icon).toBe("👍🏽");
  });

  it("rejects text icons and unknown or URL covers", () => {
    expect(() => validateNoteContent({ title: "A", icon: "hello", blocks: [] })).toThrow("emoji");
    expect(() => validateNoteContent({ title: "A", icon: "📚 x", blocks: [] })).toThrow("emoji");
    expect(() => validateNoteContent({ title: "A", icon: "📚abc", blocks: [] })).toThrow("emoji");
    expect(() => validateNoteContent({ title: "A", icon: "📚📚", blocks: [] })).toThrow("emoji");
  });

  it("accepts flags and joined emoji sequences as one icon", () => {
    for (const icon of ["🇯🇵", "👨‍👩‍👧", "🏳️‍🌈", "❤️"]) expect(validateNoteContent({ title: "A", icon, blocks: [] }).icon).toBe(icon);
    expect(() => validateNoteContent({ title: "A", cover: "https://example.com/x.png", blocks: [] })).toThrow("cover");
    expect(() => validateNoteContent({ title: "A", cover: "toString", blocks: [] })).toThrow("cover");
  });
});

describe("uploaded page covers", () => {
  const key = "upload:page-covers/cmabc123/0e111e3a-9e25-4944-ade7-b460580fa925.jpg";

  it("accepts an uploaded cover key with a 0-100 position", () => {
    expect(validateNoteContent({ title: "A", cover: key, coverPosition: 30, blocks: [] })).toMatchObject({ cover: key, coverPosition: 30 });
  });

  it("rejects path tricks, other folders and out-of-range positions", () => {
    for (const cover of ["upload:page-covers/../images/x.jpg", "upload:images/2026/01/01/0e111e3a-9e25-4944-ade7-b460580fa925.jpg", "upload:page-covers/a/b/0e111e3a-9e25-4944-ade7-b460580fa925.jpg", `${key}.exe`]) {
      expect(() => validateNoteContent({ title: "A", cover, blocks: [] })).toThrow("cover");
    }
    expect(() => validateNoteContent({ title: "A", cover: key, coverPosition: 101, blocks: [] })).toThrow("position");
    expect(() => validateNoteContent({ title: "A", cover: key, coverPosition: 1.5, blocks: [] })).toThrow("position");
  });
});

describe("note-document runtime module dependency graph", () => {
  const srcRoot = path.resolve(process.cwd(), "src");

  function resolveLocalImport(fromFile: string, specifier: string): string | null {
    let base: string | null = null;
    if (specifier.startsWith("@/")) base = path.join(srcRoot, specifier.slice(2));
    else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
    else return null;

    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      path.join(base, "index.ts"),
      path.join(base, "index.tsx"),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return path.normalize(candidate);
    }
    return null;
  }

  function runtimeImportsOf(filePath: string, cache: Map<string, string[]>): string[] {
    const cached = cache.get(filePath);
    if (cached) return cached;
    const source = fs.readFileSync(filePath, "utf8");
    const kind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const ast = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, false, kind);
    const deps = new Set<string>();

    const add = (specifier: string) => {
      const resolved = resolveLocalImport(filePath, specifier);
      if (resolved) deps.add(resolved);
    };

    for (const stmt of ast.statements) {
      if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const clause = stmt.importClause;
        // import "side-effect"
        if (!clause) {
          add(stmt.moduleSpecifier.text);
          continue;
        }
        if (clause.isTypeOnly) continue;
        // import Foo, { type Bar } from "..." has a default value binding -> runtime import.
        const hasDefault = Boolean(clause.name);
        const bindings = clause.namedBindings;
        const hasRuntimeNamed = bindings
          ? ts.isNamespaceImport(bindings) || bindings.elements.some((el) => !el.isTypeOnly)
          : false;
        if (hasDefault || hasRuntimeNamed) add(stmt.moduleSpecifier.text);
      } else if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
        if (stmt.isTypeOnly) continue;
        const clause = stmt.exportClause;
        // export * from "..." or export * as ns from "..."
        if (!clause || ts.isNamespaceExport(clause)) {
          add(stmt.moduleSpecifier.text);
          continue;
        }
        if (clause.elements.some((el) => !el.isTypeOnly)) add(stmt.moduleSpecifier.text);
      }
    }

    const list = [...deps];
    cache.set(filePath, list);
    return list;
  }

  function findRuntimeCycleFrom(
    entryFile: string,
    cache: Map<string, string[]>,
    visited = new Set<string>(),
  ): string[] | null {
    const stack: string[] = [];
    const onStack = new Map<string, number>();

    const dfs = (current: string): string[] | null => {
      const idx = onStack.get(current);
      if (idx !== undefined) return [...stack.slice(idx), current];
      if (visited.has(current)) return null;
      visited.add(current);
      onStack.set(current, stack.length);
      stack.push(current);
      for (const next of runtimeImportsOf(current, cache)) {
        const cycle = dfs(next);
        if (cycle) return cycle;
      }
      stack.pop();
      onStack.delete(current);
      return null;
    };

    return dfs(path.normalize(entryFile));
  }

  const sharedImportCache = new Map<string, string[]>();

  it("keeps note-document.ts free of runtime circular imports and decoupled from whiteboard/scene.ts", () => {
    const noteDocument = path.normalize(path.join(srcRoot, "lib/note-document.ts"));
    const whiteboardScene = path.normalize(path.join(srcRoot, "lib/whiteboard/scene.ts"));

    const cycle = findRuntimeCycleFrom(noteDocument, sharedImportCache);
    expect(cycle?.map((p) => path.relative(srcRoot, p))).toBeUndefined();

    // Collect full runtime closure of note-document.ts and verify whiteboard/scene.ts is never pulled in.
    const closure = new Set<string>();
    const queue = [noteDocument];
    while (queue.length) {
      const cur = queue.pop()!;
      for (const dep of runtimeImportsOf(cur, sharedImportCache)) {
        if (!closure.has(dep)) {
          closure.add(dep);
          queue.push(dep);
        }
      }
    }
    expect(closure.has(noteDocument)).toBe(false);
    expect(closure.has(whiteboardScene)).toBe(false);
  }, 15_000);

  it("introduces no runtime circular dependencies across whiteboard-embed and slides-embed modules", () => {
    const visited = new Set<string>();
    const entries = [
      "lib/note-document.ts",
      "lib/note-markdown.ts",
      "lib/note-text.ts",
      "lib/note-whiteboards.ts",
      "lib/note-share-server.ts",
      "lib/whiteboard/embed-id.ts",
      "lib/whiteboard/frames.ts",
      "lib/whiteboard/render-frame.ts",
      "lib/whiteboard/scene.ts",
      "lib/slides/whiteboard-embed.tsx",
      "components/note-whiteboard.tsx",
      "components/whiteboard/whiteboard-frame-picker.tsx",
      "components/whiteboard/whiteboard-thumbnail.tsx",
      "components/whiteboard/register-slides-embed.tsx",
      "components/whiteboard/public-whiteboard-embed.tsx",
      "components/whiteboard/public-whiteboard-embed-canvas.tsx",
      "components/public-note-view.tsx",
      "components/slides/slides-editor.tsx",
      "components/note-editor.tsx",
    ];
    for (const rel of entries) {
      const cycle = findRuntimeCycleFrom(path.join(srcRoot, rel), sharedImportCache, visited);
      expect(cycle?.map((p) => path.relative(srcRoot, p)), `runtime cycle from ${rel}`).toBeUndefined();
    }
  }, 15_000);
});
