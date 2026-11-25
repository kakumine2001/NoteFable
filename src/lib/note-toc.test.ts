import { describe, expect, it } from "vitest";
import { extractTocHeadings, sameTocHeadings } from "./note-toc";

describe("note table of contents helpers", () => {
  it("extracts H1-H3 headings in document order including toggles and columns", () => {
    const blocks = [
      { id: "toc", type: "tableOfContents", props: {}, children: [] },
      { id: "h1", type: "heading", props: { level: 1 }, content: [{ type: "text", text: "Overview", styles: {} }], children: [] },
      {
        id: "tog",
        type: "toggleListItem",
        props: {},
        content: [{ type: "text", text: "Details", styles: {} }],
        children: [
          { id: "h2", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Nested Section", styles: {} }], children: [] },
        ],
      },
      {
        id: "cols",
        type: "columnList",
        props: {},
        children: [
          {
            id: "col1",
            type: "column",
            props: {},
            children: [
              { id: "h3", type: "heading", props: { level: 3 }, content: [{ type: "text", text: "Subtopic", styles: {} }], children: [] },
            ],
          },
        ],
      },
    ];

    expect(extractTocHeadings(blocks)).toEqual([
      { id: "h1", level: 1, text: "Overview" },
      { id: "h2", level: 2, text: "Nested Section" },
      { id: "h3", level: 3, text: "Subtopic" },
    ]);
  });

  it("treats omitted heading level as H1 and ignores empty headings, missing IDs, and unsupported levels", () => {
    const blocks = [
      { id: "empty", type: "heading", props: { level: 1 }, content: [{ type: "text", text: "   ", styles: {} }], children: [] },
      { id: "h-default", type: "heading", props: {}, content: [{ type: "text", text: "Default H1", styles: {} }], children: [] },
      { type: "heading", props: { level: 1 }, content: [{ type: "text", text: "No ID", styles: {} }], children: [] },
      { id: "h4", type: "heading", props: { level: 4 }, content: [{ type: "text", text: "Too deep", styles: {} }], children: [] },
      { id: "ok", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Valid", styles: {} }], children: [] },
    ];
    expect(extractTocHeadings(blocks)).toEqual([
      { id: "h-default", level: 1, text: "Default H1" },
      { id: "ok", level: 2, text: "Valid" },
    ]);
  });

  it("compares heading snapshots accurately", () => {
    const a = [{ id: "h1", level: 1 as const, text: "Intro" }];
    expect(sameTocHeadings(a, [{ id: "h1", level: 1, text: "Intro" }])).toBe(true);
    expect(sameTocHeadings(a, [{ id: "h1", level: 2, text: "Intro" }])).toBe(false);
    expect(sameTocHeadings(a, [{ id: "h1", level: 1, text: "Changed" }])).toBe(false);
    expect(sameTocHeadings(a, [])).toBe(false);
  });
});
