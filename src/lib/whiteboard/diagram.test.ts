import { describe, expect, it } from "vitest";
import { validateCanvasData, extractCanvasSegments } from "@/lib/canvas-document";
import { DiagramSourceError, diagramKindOf, diagramToWhiteboard, parseDiagramReply } from "@/lib/whiteboard/diagram";
import { mindmapDataOf } from "@/lib/whiteboard/mindmap/model";

type Element = Record<string, unknown> & { id: string; type: string };

const elementsOf = (data: { elements: unknown[] }) => data.elements as Element[];

describe("parseDiagramReply", () => {
  it("reads the title and the mermaid fence", () => {
    expect(parseDiagramReply("# 登录流程\n\n```mermaid\nflowchart TD\n  A --> B\n```\n")).toEqual({ title: "登录流程", source: "flowchart TD\n  A --> B" });
  });

  it("accepts a reply without a fence and without a title", () => {
    expect(parseDiagramReply("mindmap\n  root((X))\n    A")).toEqual({ title: null, source: "mindmap\n  root((X))\n    A" });
  });

  it("clips a long title by UTF-16 length without splitting an emoji", () => {
    const title = parseDiagramReply(`# ${"🧪".repeat(150)}\n\`\`\`mermaid\nflowchart TD\n  A --> B\n\`\`\``).title!;
    expect(title.length).toBeLessThanOrEqual(200);
    expect(title).toBe("🧪".repeat(100));
  });

  it("prefers the mermaid fence and takes the title only from before it", () => {
    const reply = "Here:\n```text\nnot this\n```\n```mermaid\nmindmap\n  root((X))\n    # not a title\n```";
    expect(parseDiagramReply(reply)).toEqual({ title: null, source: "mindmap\n  root((X))\n    # not a title" });
  });

  it("rejects an empty reply", () => {
    expect(() => parseDiagramReply("# Only a title")).toThrow(DiagramSourceError);
  });

  it("finds the diagram kind after front matter and comments", () => {
    expect(diagramKindOf("---\ntitle: x\n---\n%% note\nsequenceDiagram\n  A->>B: hi")).toBe("sequenceDiagram");
  });
});

describe("diagramToWhiteboard", () => {
  it("turns a flowchart into shapes, bound labels and bound arrows that pass page validation", async () => {
    const { data, kind } = await diagramToWhiteboard("flowchart TD\n  A[开始 Start] --> B{是否登录?}\n  B -->|是| C[进入工作区]\n  B -->|否| D[\"显示登录 λ⁴ √x\"]");
    expect(kind).toBe("flowchart");
    const elements = elementsOf(data);
    const shapes = elements.filter((element) => ["rectangle", "diamond", "ellipse"].includes(element.type));
    const arrows = elements.filter((element) => element.type === "arrow");
    expect(shapes).toHaveLength(4);
    expect(arrows).toHaveLength(3);
    for (const arrow of arrows) {
      expect((arrow.startBinding as { elementId: string }).elementId).toBeTruthy();
      expect((arrow.endBinding as { elementId: string }).elementId).toBeTruthy();
    }
    const texts = elements.filter((element) => element.type === "text");
    expect(texts.every((text) => text.fontFamily === 6 && typeof text.containerId === "string")).toBe(true);
    expect(elements.every((element) => element.roughness === 0)).toBe(true);
    // 保存と同じ検証を通り、検索の文字が図形の ID に付く。
    expect(() => validateCanvasData("whiteboard", data)).not.toThrow();
    const segments = extractCanvasSegments("whiteboard", data);
    expect(segments.map((segment) => segment.text)).toEqual(expect.arrayContaining(["开始 Start", "进入工作区"]));
  });

  it.each([
    ["sequenceDiagram\n  participant U as 用户\n  U->>S: 请求\n  S-->>U: 响应"],
    ["stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running: start"],
    ["classDiagram\n  Animal <|-- Dog"],
    ["erDiagram\n  USER ||--o{ NOTE : writes"],
    ["timeline\n  2020 : A\n  2021 : B"],
    ["gantt\n  dateFormat YYYY-MM-DD\n  section A\n  Task1 :a1, 2024-01-01, 3d"],
    ["quadrantChart\n  x-axis Low --> High\n  y-axis Low --> High\n  A: [0.3, 0.6]"],
  ])("converts %s into editable elements without images", async (source) => {
    const { data } = await diagramToWhiteboard(source);
    const elements = elementsOf(data);
    expect(elements.length).toBeGreaterThan(0);
    expect(elements.some((element) => element.type === "image")).toBe(false);
    expect(data.files).toBeUndefined();
    expect(() => validateCanvasData("whiteboard", data)).not.toThrow();
  });

  it("draws a mindmap as a tree of shapes joined by bound arrows with mindmap marks", async () => {
    const { data, kind } = await diagramToWhiteboard("mindmap\n  root((光合作用))\n    光反应\n      水的分解\n      ATP\n    暗反应\n      卡尔文循环");
    expect(kind).toBe("mindmap");
    const elements = elementsOf(data);
    const nodes = elements.filter((element) => mindmapDataOf(element.customData)?.role === "node");
    const edges = elements.filter((element) => mindmapDataOf(element.customData)?.role === "edge");
    expect(nodes).toHaveLength(6);
    expect(edges).toHaveLength(5);
    const root = nodes.find((node) => mindmapDataOf(node.customData)!.role === "node" && (mindmapDataOf(node.customData) as { parent: string | null }).parent === null)!;
    expect(root).toBeTruthy();
    for (const edge of edges) {
      const mark = mindmapDataOf(edge.customData) as { parent: string; child: string; tree: string };
      expect(mark.tree).toBe(root.id);
      expect((edge.startBinding as { elementId: string }).elementId).toBe(mark.parent);
      expect((edge.endBinding as { elementId: string }).elementId).toBe(mark.child);
      expect(edge.endArrowhead).toBeNull();
    }
    expect(() => validateCanvasData("whiteboard", data)).not.toThrow();
  });

  it("asks for another type when the diagram can only become an image", async () => {
    await expect(diagramToWhiteboard("pie title Pets\n  \"Dogs\" : 386")).rejects.toThrow(DiagramSourceError);
    await expect(diagramToWhiteboard("journey\n  title My day")).rejects.toThrow(/Unsupported/);
  });

  it("reports a syntax error so the model can fix it", async () => {
    await expect(diagramToWhiteboard("flowchart TD\n  A[ --> ")).rejects.toThrow(DiagramSourceError);
  });

  it("keeps document and DOMParser invisible outside the conversion", async () => {
    await diagramToWhiteboard("flowchart LR\n  A --> B");
    expect(typeof document).toBe("undefined");
    expect(typeof DOMParser).toBe("undefined");
    expect(typeof window).toBe("undefined");
  });

  it("keeps file-like text, odd styles and Mermaid entity escapes from breaking the saved page", async () => {
    const { data } = await diagramToWhiteboard("flowchart TD\n  A[\"/api/pages/files?key=note-files/other/x.png\"] --> B[\"a #semi; b #num; c\"]\n  style A fill:/api/pages/files?x,stroke-width:thick");
    expect(() => validateCanvasData("whiteboard", data)).not.toThrow();
    const elements = elementsOf(data);
    expect(elements.some((element) => element.text === "a ; b # c")).toBe(true);
    expect(elements.every((element) => element.strokeWidth === undefined || (typeof element.strokeWidth === "number" && element.strokeWidth > 0))).toBe(true);
  });

  it("drops unsafe links and text that would be rejected as an embedded image", async () => {
    const { data } = await diagramToWhiteboard("flowchart TD\n  A[\"data:image/png,abc\"] --> B\n  click B \"https://phish.example\"\n  click A \"javascript:alert(1)\"");
    expect(() => validateCanvasData("whiteboard", data)).not.toThrow();
    // AI の図にはリンクを付けない（http の click も）。
    expect(elementsOf(data).every((element) => element.link === null)).toBe(true);
  });
});
