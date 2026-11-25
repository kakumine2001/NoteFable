import { describe, expect, it } from "vitest";
import { mindmapSkeletons } from "@/lib/whiteboard/mindmap/elements";
import { defaultMindmapDirection, layoutMindmap } from "@/lib/whiteboard/mindmap/layout";
import { countMindmapNodes, limitMindmapTree, mindmapDataOf, MINDMAP_DATA_KEY, type MindmapTreeNode } from "@/lib/whiteboard/mindmap/model";
import { isMindmapSource, MindmapParseError, mindmapNodeText, parseMindmap } from "@/lib/whiteboard/mindmap/parse";
import { estimateTextWidth, wrapText } from "@/lib/whiteboard/text-measure";

const tree = (text: string, ...children: MindmapTreeNode[]): MindmapTreeNode => ({ text, children });
const texts = (node: MindmapTreeNode): unknown => (node.children.length ? { [node.text]: node.children.map(texts) } : node.text);

describe("parseMindmap", () => {
  it("builds the tree from indentation and node shapes", () => {
    const root = parseMindmap(["mindmap", "  root((中心))", "    A[四角]", "      a1", "      a2(丸角)", "    B))爆发((", "      ::icon(fa fa-book)", "      b1:::urgent", "    C{{\"f(x) = x²\"}}"].join("\n"));
    expect(texts(root)).toEqual({ 中心: [{ 四角: ["a1", "丸角"] }, { 爆发: ["b1"] }, "f(x) = x²"] });
  });

  it("skips front matter and comments and decodes entities and line breaks", () => {
    const root = parseMindmap("---\ntitle: T\n---\n%% c\nmindmap\n  Root\n    A<br/>B\n    x #quot;y#quot;");
    expect(texts(root)).toEqual({ Root: ["A\nB", "x \"y\""] });
  });

  it("treats extra top-level nodes as children of the first root", () => {
    expect(texts(parseMindmap("mindmap\n  Root\n  Other\n    child"))).toEqual({ Root: [{ Other: ["child"] }] });
  });

  it("does not mistake text with brackets for a shape", () => {
    expect(mindmapNodeText("Compute f(x) twice")).toBe("Compute f(x) twice");
    expect(mindmapNodeText("**Bold** item")).toBe("Bold item");
  });

  it("rejects other diagrams and empty mindmaps", () => {
    expect(isMindmapSource("flowchart TD\n A-->B")).toBe(false);
    expect(() => parseMindmap("flowchart TD")).toThrow(MindmapParseError);
    expect(() => parseMindmap("mindmap\n   \n")).toThrow(MindmapParseError);
  });
});

describe("limitMindmapTree", () => {
  it("drops nodes past the limits breadth-first and clips long text", () => {
    const wide = tree("root", ...Array.from({ length: 10 }, (_, index) => tree(`n${index}`, tree(`deep${index}`))));
    const { root, trimmed } = limitMindmapTree(wide, { maxNodes: 6, maxDepth: 5, maxText: 200 });
    expect(trimmed).toBe(true);
    expect(countMindmapNodes(root)).toBe(6);
    // 幅優先：最初の枝が全部入ってから、孫が入る。
    expect(root.children.map((child) => child.text)).toEqual(["n0", "n1", "n2", "n3", "n4"]);
    expect(limitMindmapTree(tree("x".repeat(10)), { maxText: 5 }).root.text).toBe("xxxx…");
    expect(limitMindmapTree(tree("a", tree("b", tree("c"))), { maxDepth: 1 }).root).toEqual(tree("a", tree("b")));
  });
});

describe("text-measure", () => {
  it("counts CJK as full width and wraps by words or characters", () => {
    expect(estimateTextWidth("中文", 20)).toBe(40);
    expect(estimateTextWidth("ab", 20)).toBeCloseTo(24);
    expect(wrapText("光合作用的暗反应", 20, 80)).toEqual(["光合作用", "的暗反应"]);
    expect(wrapText("alpha beta gamma", 10, 50)).toEqual(["alpha", "beta", "gamma"]);
    expect(wrapText("a\nb", 10, 100)).toEqual(["a", "b"]);
  });
});

describe("layoutMindmap", () => {
  const sample = tree("Root", tree("A", tree("a1"), tree("a2"), tree("a3")), tree("B", tree("b1")), tree("C"), tree("D", tree("d1"), tree("d2")));

  const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  it.each(["right", "both"] as const)("places nodes without overlaps (%s)", (direction) => {
    const { nodes } = layoutMindmap(sample, direction);
    expect(nodes).toHaveLength(countMindmapNodes(sample));
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) expect(overlaps(nodes[i], nodes[j])).toBe(false);
    expect(Math.min(...nodes.map((node) => node.x))).toBe(0);
    expect(Math.min(...nodes.map((node) => node.y))).toBe(0);
  });

  it("puts children outside their parent and keeps the order of siblings", () => {
    const { nodes } = layoutMindmap(sample, "both");
    for (const node of nodes) {
      if (node.parent === null) continue;
      const parent = nodes[node.parent];
      if (node.side === "right") expect(node.x).toBeGreaterThanOrEqual(parent.x + parent.width);
      else expect(node.x + node.width).toBeLessThanOrEqual(parent.x);
    }
    expect(nodes.some((node) => node.side === "left")).toBe(true);
    const a = nodes.filter((node) => node.parent === 1);
    expect(a.map((node) => node.text)).toEqual(["a1", "a2", "a3"]);
    expect(a[0].y).toBeLessThan(a[1].y);
  });

  it("is deterministic", () => {
    expect(layoutMindmap(sample, "both")).toEqual(layoutMindmap(sample, "both"));
  });

  it("splits to both sides only for wide trees", () => {
    expect(defaultMindmapDirection(sample)).toBe("both");
    expect(defaultMindmapDirection(tree("x", tree("a"), tree("b")))).toBe("right");
  });
});

describe("mindmapSkeletons", () => {
  it("marks nodes and edges with the tree, parents and sibling order", () => {
    let next = 0;
    const { skeletons, rootId } = mindmapSkeletons(tree("Root", tree("A", tree("a1")), tree("B")), { direction: "right", newId: () => `id${next++}` });
    const marks = skeletons.map((skeleton) => [skeleton.type, mindmapDataOf((skeleton as { customData?: unknown }).customData)]);
    expect(rootId).toBe("id0");
    expect(marks).toEqual([
      ["arrow", { v: 1, role: "edge", tree: "id0", parent: "id0", child: "id1" }],
      ["arrow", { v: 1, role: "edge", tree: "id0", parent: "id1", child: "id2" }],
      ["arrow", { v: 1, role: "edge", tree: "id0", parent: "id0", child: "id3" }],
      ["rectangle", { v: 1, role: "node", tree: "id0", parent: null, order: 0, direction: "right" }],
      ["rectangle", { v: 1, role: "node", tree: "id0", parent: "id0", order: 0 }],
      ["rectangle", { v: 1, role: "node", tree: "id0", parent: "id1", order: 0 }],
      ["rectangle", { v: 1, role: "node", tree: "id0", parent: "id0", order: 1 }],
    ]);
  });

  it("ignores malformed marks", () => {
    expect(mindmapDataOf({ [MINDMAP_DATA_KEY]: { v: 2, role: "node" } })).toBeNull();
    expect(mindmapDataOf({ [MINDMAP_DATA_KEY]: { v: 1, role: "node", tree: "t", parent: null, order: -1 } })).toBeNull();
    expect(mindmapDataOf({ [MINDMAP_DATA_KEY]: { v: 1, role: "edge", tree: "t", parent: "a" } })).toBeNull();
    expect(mindmapDataOf(null)).toBeNull();
  });
});
