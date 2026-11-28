import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {}, databaseSchema: "notefable" }));
import { MAX_READ_CHARS, type AdapterPage } from "@/lib/page-ai/adapter";
import { canvasTextAdapter } from "@/lib/page-ai/canvas-adapter";

const updatedAt = new Date("2026-11-24T00:00:00Z");

const page = (kind: "whiteboard" | "slides", overrides: Partial<AdapterPage> = {}): AdapterPage => ({
  id: kind === "whiteboard" ? "wb1" : "sl1",
  kind,
  title: kind === "whiteboard" ? "Architecture" : "Quarterly Review",
  icon: null,
  version: 3,
  updatedAt,
  blocks: [],
  segments: [],
  ...overrides,
});

// 子を畳んだ根（子の文字は customData の預かり分にだけある）。
const collapsedBranch = (label: string) => {
  const node = (id: string, parent: string, order: number) => ({ id, type: "rectangle", customData: { notefableMindmap: { v: 1, role: "node", tree: "n1", parent, order } } });
  const text = (containerId: string, value: string) => ({ id: `${containerId}-t`, type: "text", containerId, text: value, originalText: value });
  return [
    {
      id: "n1", type: "rectangle",
      customData: { notefableMindmap: { v: 1, role: "node", tree: "n1", parent: null, order: 0, collapsed: true, stash: [
        node("c2", "n1", 1), text("c2", "Rain"), node("c3", "c1", 0), text("c3", "Sun\nheat"), node("c1", "n1", 0), text("c1", "Evaporation"),
      ] } },
    },
    text("n1", label),
  ];
};

describe("canvasTextAdapter structured whiteboard read", () => {
  const adapter = canvasTextAdapter("whiteboard");

  it("sets needsData: true and structures frames, bound text, groups, page links, images, and arrow connections", () => {
    expect(adapter.needsData).toBe(true);
    const result = adapter.read(page("whiteboard", {
      data: {
        elements: [
          { id: "f1", type: "frame", name: "Backend" },
          { id: "r1", type: "rectangle", frameId: "f1", groupIds: ["g1"] },
          { id: "t_r1", type: "text", containerId: "r1", frameId: "f1", text: "API\nGateway", originalText: "API\nGateway" },
          { id: "s1", type: "stickynote", frameId: "f1", text: "Check limits", groupIds: ["g1", "g2"] },
          { id: "a1", type: "arrow", frameId: "f1", startBinding: { elementId: "r1" }, endBinding: { elementId: "r2" } },
          { id: "t_a1", type: "text", containerId: "a1", frameId: "f1", text: "HTTPS" },
          { id: "img1", type: "image", frameId: "f1", fileId: "secret-file-id" },
          { id: "eq1", type: "image", frameId: "f1", fileId: "f2", customData: { notefableFormula: { v: 1, latex: "\\int_0^1 x^2\\,dx" } } },
          { id: "r2", type: "ellipse", customData: { notefablePage: { id: "note_42", kind: "note" } } },
          { id: "t_r2", type: "text", containerId: "r2", text: "Design Spec" },
          { id: "d1", type: "freedraw" },
          { id: "del1", type: "rectangle", isDeleted: true },
          { id: "del_txt", type: "text", containerId: "del1", isDeleted: true, text: "Should vanish" },
        ],
      },
    }));

    expect(result).toContain("# Architecture");
    expect(result).toContain("## Frame: Backend (id: f1)");
    expect(result).toContain('- rectangle (id: r1) [group: g1]: "API / Gateway"');
    expect(result).toContain('- stickynote (id: s1) [groups: g1, g2]: "Check limits"');
    expect(result).toContain('- arrow (id: a1): r1 -> r2 "HTTPS"');
    expect(result).toContain("- image (id: img1): [Image]");
    expect(result).toContain("- image (id: eq1): [Formula] $\\int_0^1 x^2\\,dx$");
    expect(result).not.toContain("secret-file-id");
    expect(result).toContain("## Unframed");
    expect(result).toContain('- ellipse (id: r2) [page link: note note_42]: "Design Spec"');
    expect(result).toContain("- freedraw (id: d1)");
    // Bound text is merged onto container, never duplicated as an orphan text line.
    expect(result).not.toContain("(id: t_r1)");
    expect(result).not.toContain("(id: t_a1)");
    expect(result).not.toContain("(id: t_r2)");
    // Deleted elements are skipped.
    expect(result).not.toContain("del1");
    expect(result).not.toContain("Should vanish");
  });

  it("lists the text hidden in a collapsed mind map branch under its node, as a tree", () => {
    const result = adapter.read(page("whiteboard", { data: { elements: collapsedBranch("Water cycle") } }));
    expect(result).toContain([
      '- rectangle (id: n1): "Water cycle"',
      '  - hidden in collapsed branch: "Evaporation"',
      '    - hidden in collapsed branch: "Sun / heat"',
      '  - hidden in collapsed branch: "Rain"',
    ].join("\n"));
    // 白板に無い要素の ID は出さない。
    expect(result).not.toContain("c1");
  });

  it("caps the indentation of a very deep hidden branch", () => {
    const stash = Array.from({ length: 30 }, (_, index) => [
      { id: `c${index}`, type: "rectangle", customData: { notefableMindmap: { v: 1, role: "node", tree: "n1", parent: index ? `c${index - 1}` : "n1", order: 0 } } },
      { id: `c${index}-t`, type: "text", containerId: `c${index}`, originalText: `level ${index + 1}` },
    ]).flat();
    const elements = [{ id: "n1", type: "rectangle", customData: { notefableMindmap: { v: 1, role: "node", tree: "n1", parent: null, order: 0, collapsed: true, stash } } }];
    const result = adapter.read(page("whiteboard", { data: { elements } }));
    expect(result).toContain(`\n${"  ".repeat(8)}- hidden in collapsed branch: "level 30"`);
  });

  it("counts hidden branch lines against the read limit", () => {
    const hidden = Array.from({ length: 5_000 }, (_, index) => ({
      id: `h${index}`, type: "text", containerId: `c${index}`, originalText: `Hidden topic number ${index} ${"x".repeat(40)}`,
    }));
    const elements = [{ id: "n1", type: "rectangle", customData: { notefableMindmap: { v: 1, role: "node", tree: "n1", parent: null, order: 0, collapsed: true, stash: hidden } } }];
    const result = adapter.read(page("whiteboard", { data: { elements } }));
    expect(result.length).toBeLessThanOrEqual(MAX_READ_CHARS);
    expect(result).toContain("Hidden topic number 0 ");
    expect(result).toContain("[Truncated:");
  });

  it("falls back to page.segments when data is missing or malformed", () => {
    const missing = adapter.read(page("whiteboard", {
      data: null,
      segments: [{ id: "e1", text: "Alpha" }, { id: "e2", text: "Beta" }],
    }));
    expect(missing).toContain("- (id: e1) Alpha\n- (id: e2) Beta");

    const malformed = adapter.read(page("whiteboard", {
      data: { elements: "not-an-array" } as never,
      segments: [{ id: "e3", text: "Recovered" }],
    }));
    expect(malformed).toContain("- (id: e3) Recovered");
  });

  it("truncates cleanly on element/frame boundaries within MAX_READ_CHARS with an omission notice", () => {
    const elements = Array.from({ length: 120 }, (_, i) => ({
      id: `el_${i}`,
      type: "stickynote",
      text: `Note ${i}: ${"x".repeat(300)}`,
    }));
    const result = adapter.read(page("whiteboard", { data: { elements } }));
    expect(result.length).toBeLessThanOrEqual(MAX_READ_CHARS);
    expect(result).toMatch(/\[Truncated: \d+ more elements? omitted \(limit: 20000 characters\)\.\]/);
    // Clean line boundary before truncation notice (no mid-line chop on earlier entries).
    const beforeNotice = result.split("\n\n[Truncated:")[0];
    expect(beforeNotice.split("\n").every((line) => line.startsWith("# ") || line === "" || line.endsWith('"'))).toBe(true);
  });

  it("drops a dangling frame heading if none of that frame's elements fit in the budget", () => {
    const elements = [
      { id: "f1", type: "frame", name: "First" },
      ...Array.from({ length: 48 }, (_, i) => ({
        id: `a_${i}`,
        type: "stickynote",
        frameId: "f1",
        text: `A${i}: ${"a".repeat(380)}`,
      })),
      { id: "f2", type: "frame", name: "Second" },
      { id: "b_0", type: "stickynote", frameId: "f2", text: `B0: ${"b".repeat(800)}` },
    ];
    const result = adapter.read(page("whiteboard", { data: { elements } }));
    expect(result.length).toBeLessThanOrEqual(MAX_READ_CHARS);
    const beforeNotice = result.split("\n\n[Truncated:")[0];
    expect(beforeNotice.trimEnd().endsWith("## Frame: Second (id: f2)")).toBe(false);
    expect(result).toContain("1 more frame omitted");
  });

  it("prioritizes selected elements and arrow endpoints beyond MAX_READ_CHARS on large boards", () => {
    const filler = Array.from({ length: 180 }, (_, i) => ({
      id: `filler_${i}`,
      type: "text",
      text: `Filler item ${i}: ${"x".repeat(120)}`,
    }));
    const elements = [
      ...filler,
      { id: "frame_tail", type: "frame", name: "Final Phase" },
      { id: "box_start", type: "rectangle", frameId: "frame_tail" },
      { id: "box_start_lbl", type: "text", containerId: "box_start", text: "Start Service" },
      { id: "box_end", type: "rectangle", frameId: "frame_tail" },
      { id: "box_end_lbl", type: "text", containerId: "box_end", text: "End Database" },
      { id: "arrow_tail", type: "arrow", frameId: "frame_tail", startBinding: { elementId: "box_start" }, endBinding: { elementId: "box_end" } },
    ];
    const result = adapter.read(page("whiteboard", { data: { elements }, focusIds: ["arrow_tail"] }));
    expect(result.length).toBeLessThanOrEqual(MAX_READ_CHARS);
    expect(result).toContain("## Selected");
    expect(result).toContain("- arrow (id: arrow_tail): box_start -> box_end [in frame: Final Phase (frame_tail)]");
    expect(result).toContain("## Connected to selected");
    expect(result).toContain('- rectangle (id: box_start): "Start Service"');
    expect(result).toContain('- rectangle (id: box_end): "End Database"');
    expect(result).toMatch(/\[Truncated: .* omitted \(limit: 20000 characters\)\.\]/);
  });
});

describe("canvasTextAdapter structured slides read", () => {
  const adapter = canvasTextAdapter("slides");

  it("sets needsData: true and outputs theme, sections, slides, roles, math, code, tables, image alt, whiteboard embed, and notes", () => {
    expect(adapter.needsData).toBe(true);
    const result = adapter.read(page("slides", {
      data: {
        format: 1,
        theme: { id: "editorial", mode: "dark" },
        slides: [
          {
            id: "s1",
            layout: "title",
            section: "Opening",
            notes: "Greet the audience.",
            elements: [
              {
                id: "el_title",
                type: "text",
                role: "title",
                doc: {
                  type: "doc",
                  content: [
                    { type: "paragraph", content: [{ type: "text", text: "Formula " }, { type: "math_inline", attrs: { latex: "E=mc^2" } }] },
                    { type: "code_block", content: [{ type: "text", text: "const x = 1;" }] },
                  ],
                },
              },
              {
                id: "el_img",
                type: "image",
                role: "image",
                src: "/api/pages/files?key=u1/private-secret.png",
                alt: "Architecture diagram",
                generated: { prompt: "secret prompt" },
              },
            ],
          },
          {
            id: "s2",
            layout: "blank",
            hidden: true,
            elements: [
              {
                id: "el_tbl",
                type: "table",
                rows: [
                  { cells: [{ text: "Metric" }, { text: "Q4" }] },
                  { cells: [{ text: "Users" }, { text: "12k" }] },
                ],
              },
              {
                id: "el_wb",
                type: "whiteboard",
                src: "/api/pages/files?key=u1/wb.png",
                pageId: "private_wb_id",
                frameId: "fr_1",
                frameName: "System Flow",
              },
            ],
          },
        ],
      },
    }));

    expect(result).toContain("# Quarterly Review");
    expect(result).toContain("Theme: editorial (dark)");
    expect(result).toContain("Sections: Opening");
    expect(result).toContain("## Slide 1 (id: s1, layout: title, section: Opening)");
    expect(result).toContain("- text (id: el_title) [role: title]:");
    expect(result).toContain("Formula $E=mc^2$");
    expect(result).toContain("```\n  const x = 1;\n  ```");
    expect(result).toContain("- image (id: el_img) [role: image]: [Image: Architecture diagram]");
    expect(result).not.toContain("private-secret.png");
    expect(result).not.toContain("secret prompt");
    expect(result).toContain("Notes: Greet the audience.");
    expect(result).toContain("## Slide 2 (id: s2, layout: blank, section: Opening) [hidden]");
    expect(result).toContain("- table (id: el_tbl):\n  Metric | Q4\n  Users | 12k");
    expect(result).toContain("- whiteboard (id: el_wb): [Whiteboard frame: System Flow]");
    expect(result).not.toContain("private_wb_id");
  });

  it("falls back to page.segments when slides data is missing or malformed", () => {
    const result = adapter.read(page("slides", {
      data: null,
      segments: [{ id: "s1", text: "Cover" }, { id: "s2", text: "Agenda" }],
    }));
    expect(result).toContain("Slide 1 (id: s1): Cover\nSlide 2 (id: s2): Agenda");
  });

  it("truncates cleanly on slide boundaries within MAX_READ_CHARS with omitted slide count", () => {
    const slides = Array.from({ length: 60 }, (_, i) => ({
      id: `s_${i}`,
      layout: "bullets",
      notes: `Speaker notes ${i}: ${"n".repeat(450)}`,
      elements: [{
        id: `t_${i}`,
        type: "text",
        role: "title",
        doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `Slide title ${i}` }] }] },
      }],
    }));
    const result = adapter.read(page("slides", { data: { format: 1, theme: { id: "simple", mode: "light" }, slides } }));
    expect(result.length).toBeLessThanOrEqual(MAX_READ_CHARS);
    expect(result).toMatch(/\[Truncated: \d+ more slides? omitted \(limit: 20000 characters\)\.\]/);
    // Every included slide starts cleanly and retains its full Notes line (not chopped mid-slide).
    const slideHeaders = result.match(/^## Slide \d+/gm) ?? [];
    const noteLines = result.match(/^Notes: Speaker notes \d+:/gm) ?? [];
    expect(slideHeaders.length).toBeGreaterThan(0);
    expect(noteLines.length).toBe(slideHeaders.length);
  });

  it("prioritizes selected slides and elements beyond MAX_READ_CHARS on large decks while keeping true slide numbers", () => {
    const slides = Array.from({ length: 60 }, (_, i) => ({
      id: `s_${i}`,
      layout: "bullets",
      notes: `Speaker notes ${i}: ${"n".repeat(450)}`,
      elements: [{
        id: `t_${i}`,
        type: "text",
        role: "title",
        doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `Slide title ${i}` }] }] },
      }],
    }));
    const result = adapter.read(page("slides", {
      data: { format: 1, theme: { id: "simple", mode: "light" }, slides },
      focusIds: ["t_58"],
    }));
    expect(result.length).toBeLessThanOrEqual(MAX_READ_CHARS);
    expect(result).toContain("## Slide 59 (id: s_58, layout: bullets)");
    expect(result).toContain("- text (id: t_58) [role: title]: Slide title 58");
    expect(result).toMatch(/\[Truncated: \d+ more slides? omitted \(limit: 20000 characters\)\.\]/);
  });

  it("reserves read space for every selected slide even when the first selected slide has huge speaker notes", () => {
    const slides = [
      {
        id: "s_big",
        layout: "bullets",
        notes: `Huge speaker notes: ${"x".repeat(20_000)}`,
        elements: [{
          id: "t_big",
          type: "text",
          role: "title",
          doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "First selected slide" }] }] },
        }],
      },
      {
        id: "s_small",
        layout: "bullets",
        elements: [{
          id: "t_small",
          type: "text",
          role: "title",
          doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Second selected short line" }] }] },
        }],
      },
    ];
    const result = adapter.read(page("slides", {
      data: { format: 1, theme: { id: "simple", mode: "light" }, slides },
      focusIds: ["s_big", "s_small"],
    }));
    expect(result.length).toBeLessThanOrEqual(MAX_READ_CHARS);
    expect(result).toContain("## Slide 1 (id: s_big, layout: bullets)");
    expect(result).toContain("First selected slide");
    expect(result).toContain("## Slide 2 (id: s_small, layout: bullets)");
    expect(result).toContain("Second selected short line");
  });

  it("never evicts a second selected slide due to omitted-slide index reserve", () => {
    const slides = [
      {
        id: "s_sel_1",
        layout: "bullets",
        elements: [{
          id: "t_sel_1",
          type: "text",
          role: "title",
          doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `First selected body ${"A".repeat(9_200)}` }] }] },
        }],
      },
      {
        id: "s_sel_2",
        layout: "bullets",
        elements: [{
          id: "t_sel_2",
          type: "text",
          role: "title",
          doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `Second selected body ${"B".repeat(9_200)}` }] }] },
        }],
      },
      {
        id: "s_unsel_3",
        layout: "bullets",
        elements: [{
          id: "t_unsel_3",
          type: "text",
          role: "title",
          doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `Unselected slide summary ${"C".repeat(3_000)}` }] }] },
        }],
      },
    ];
    const result = adapter.read(page("slides", {
      data: { format: 1, theme: { id: "simple", mode: "light" }, slides },
      focusIds: ["s_sel_1", "s_sel_2"],
    }));
    expect(result.length).toBeLessThanOrEqual(MAX_READ_CHARS);
    expect(result).toContain("## Slide 1 (id: s_sel_1, layout: bullets)");
    expect(result).toContain("## Slide 2 (id: s_sel_2, layout: bullets)");
    expect(result).toContain("Omitted slides (stable IDs):");
    expect(result).toContain("s_unsel_3");
    const omittedSection = result.split("Omitted slides (stable IDs):")[1] ?? "";
    expect(omittedSection).not.toContain("s_sel_1");
    expect(omittedSection).not.toContain("s_sel_2");
  });

  it("keeps all 10 selected slides in view without eviction when all slides are selected", () => {
    const slides = Array.from({ length: 10 }, (_, idx) => ({
      id: `sel_${idx}`,
      layout: "bullets",
      elements: [{
        id: `t_${idx}`,
        type: "text",
        role: "title",
        doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `Slide ${idx + 1} ${"M".repeat(2_500)}` }] }] },
      }],
    }));
    const result = adapter.read(page("slides", {
      data: { format: 1, theme: { id: "simple", mode: "light" }, slides },
      focusIds: slides.map((s) => s.id),
    }));
    expect(result.length).toBeLessThanOrEqual(MAX_READ_CHARS);
    for (let idx = 0; idx < 10; idx++) {
      expect(result).toContain(`## Slide ${idx + 1} (id: sel_${idx}, layout: bullets)`);
    }
    expect(result).not.toContain("Omitted slides (stable IDs):");
  });

  it("keeps actual element content on selected slides when 100 slides have 200-char section names", () => {
    const slides = Array.from({ length: 500 }, (_, idx) => ({
      id: `s500_${idx}`,
      layout: "bullets",
      ...(idx < 100 ? { section: `Section ${idx + 1} ${"S".repeat(185)}` } : {}),
      elements: [{
        id: `t500_${idx}`,
        type: "text",
        role: "title",
        doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `ElementBody-${idx} Key point` }] }] },
      }],
    }));
    const result = adapter.read(page("slides", {
      data: { format: 1, theme: { id: "simple", mode: "light" }, slides },
      focusIds: slides.slice(0, 100).map((s) => s.id),
    }));
    expect(result.length).toBeLessThanOrEqual(MAX_READ_CHARS);
    expect(result).toContain("ElementBody-0 Key point");
    expect(result).toContain("ElementBody-99 Key point");
  });
});
