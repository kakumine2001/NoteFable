import { describe, expect, it } from "vitest";
import {
  addMindmapChild, addMindmapSibling, bindMindmapEdges, collapsedMindmapNodes, collapseMindmapNode, deleteMindmapNodes, expandMindmapNode,
  mindmapDropTarget, mindmapSelection, readMindmapTrees, relayoutMindmap, remapMindmapDuplicates, reparentMindmapNode, setMindmapDirection, type MindmapChange, type SceneElement,
} from "@/lib/whiteboard/mindmap/editing";
import { mindmapSkeletons, type MindmapSkeleton } from "@/lib/whiteboard/mindmap/elements";
import { mindmapDataOf, type MindmapNodeData, type MindmapTreeNode } from "@/lib/whiteboard/mindmap/model";

const tree = (text: string, ...children: MindmapTreeNode[]): MindmapTreeNode => ({ text, children });

// 下書きから、Excalidraw が作るのと同じ形の要素（節には結び付いた文字、線には結び付き）を作る。
function materialize(skeletons: MindmapSkeleton[]): SceneElement[] {
  const out: SceneElement[] = [];
  for (const skeleton of skeletons) {
    const { label, start, end, ...rest } = skeleton as MindmapSkeleton & { label?: { text: string }; start?: { id: string }; end?: { id: string } };
    const element = { width: 0, height: 0, ...rest } as SceneElement;
    if (label) {
      const textId = `${skeleton.id}-t`;
      element.boundElements = [{ id: textId, type: "text" }];
      out.push(element, { id: textId, type: "text", x: element.x + 10, y: element.y + 10, width: 40, height: 20, containerId: skeleton.id, text: label.text, originalText: label.text });
      continue;
    }
    if (start && end) {
      element.startBinding = { elementId: start.id, fixedPoint: [1, 0.5], mode: "orbit" };
      element.endBinding = { elementId: end.id, fixedPoint: [0, 0.5], mode: "orbit" };
    }
    out.push(element);
  }
  return out;
}

// 差分を要素の並びに当てる（エディターの updateScene の代わり）。
function apply(elements: SceneElement[], change: MindmapChange): SceneElement[] {
  const next = elements.map((element) => (change.patches.has(element.id) ? { ...element, ...change.patches.get(element.id) } as SceneElement : element));
  const restoredIds = new Set(change.restored.map((element) => element.id));
  return [...next.filter((element) => !restoredIds.has(element.id)), ...(change.restored as SceneElement[]), ...materialize(change.added)];
}

function relayoutAll(elements: SceneElement[]) {
  let current = elements;
  for (const rootId of readMindmapTrees(current).keys()) current = apply(current, relayoutMindmap(current, rootId));
  return current;
}

let counter = 0;
const nextId = () => `n${++counter}`;

function sample() {
  counter = 0;
  const { skeletons, rootId } = mindmapSkeletons(tree("Root", tree("A", tree("a1"), tree("a2")), tree("B")), { direction: "right", newId: nextId });
  return { elements: materialize(skeletons), rootId };
}

const nodeData = (elements: SceneElement[], id: string) => mindmapDataOf(elements.find((element) => element.id === id)!.customData) as MindmapNodeData;
const textsOf = (elements: SceneElement[], root: string) => {
  const t = readMindmapTrees(elements).get(root)!;
  const walk = (id: string): unknown => {
    const node = t.nodes.get(id)!;
    const label = elements.find((element) => element.id === `${id}-t`)?.text ?? id;
    return node.children.length ? { [label]: node.children.map((child) => walk(child.id)) } : label;
  };
  return walk(root);
};
const live = (elements: SceneElement[]) => elements.filter((element) => !element.isDeleted);

describe("readMindmapTrees", () => {
  it("rebuilds the tree in sibling order and treats orphans as their own roots", () => {
    const { elements, rootId } = sample();
    expect(textsOf(elements, rootId)).toEqual({ Root: [{ A: ["a1", "a2"] }, "B"] });
    // A を（消しゴムなどで）消すと、a1・a2 はそれぞれ根になる。
    const trees = readMindmapTrees(elements.map((element) => (element.id === "n2" ? { ...element, isDeleted: true } : element)));
    expect([...trees.keys()].sort()).toEqual(["n1", "n3", "n4"]);
  });
});

describe("adding nodes", () => {
  it("adds a child at the end and a sibling right after, then lays them out without overlaps", () => {
    let { elements } = sample();
    const { rootId } = sample();
    elements = apply(elements, addMindmapChild(elements, "n2", "a3", () => "c1"));
    elements = relayoutAll(elements);
    elements = apply(elements, addMindmapSibling(elements, "n3", "a1b", () => "s1"));
    elements = relayoutAll(elements);
    expect(textsOf(elements, rootId)).toEqual({ Root: [{ A: ["a1", "a1b", "a2", "a3"] }, "B"] });
    expect(nodeData(elements, "s1")).toMatchObject({ parent: "n2", order: 1, tree: rootId });
    expect(nodeData(elements, "n4")).toMatchObject({ order: 2 });
    const boxes = live(elements).filter((element) => mindmapDataOf(element.customData)?.role === "node");
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]; const b = boxes[j];
      expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height).toBe(false);
    }
    // 新しい節にも線があり、両端が結び付いている。
    const edge = live(elements).find((element) => (mindmapDataOf(element.customData) as { child?: string } | null)?.child === "s1")!;
    expect(edge.startBinding).toMatchObject({ elementId: "n2" });
    expect(edge.endBinding).toMatchObject({ elementId: "s1" });
  });

  it("adds a child instead of a sibling on the root, and asks to edit the new node", () => {
    const { elements, rootId } = sample();
    const change = addMindmapSibling(elements, rootId, "C", () => "c2");
    expect(change.select).toBe("c2");
    expect(change.edit).toBe("c2");
    expect(nodeData(apply(elements, change), "c2")).toMatchObject({ parent: rootId, order: 2 });
  });

  it("keeps the root in place and moves bound texts with their nodes", () => {
    let { elements } = sample();
    const before = elements.find((element) => element.id === "n1")!;
    elements = apply(elements, addMindmapChild(elements, "n1", "C", () => "c3"));
    elements = relayoutAll(elements);
    const root = elements.find((element) => element.id === "n1")!;
    expect([root.x, root.y]).toEqual([before.x, before.y]);
    const node = elements.find((element) => element.id === "n2")!;
    const text = elements.find((element) => element.id === "n2-t")!;
    expect(text.x - node.x).toBe(10);
  });
});

describe("deleting nodes", () => {
  it("deletes the subtree with its texts and edges and renumbers the remaining siblings", () => {
    const { elements, rootId } = sample();
    const next = apply(elements, deleteMindmapNodes(elements, ["n3"]));
    expect(textsOf(next, rootId)).toEqual({ Root: [{ A: ["a2"] }, "B"] });
    expect(nodeData(next, "n4").order).toBe(0);
    expect(next.find((element) => element.id === "n3-t")!.isDeleted).toBe(true);
    expect(live(next).some((element) => (mindmapDataOf(element.customData) as { child?: string } | null)?.child === "n3")).toBe(false);
  });

  it("deletes the whole tree when the root is deleted", () => {
    const { elements, rootId } = sample();
    expect(live(apply(elements, deleteMindmapNodes(elements, [`${rootId}-t`])))).toEqual([]);
  });
});

describe("reparenting", () => {
  it("moves a branch under another node but never under its own descendant", () => {
    const { elements, rootId } = sample();
    expect(reparentMindmapNode(elements, "n2", "n3")).toBeNull();
    expect(reparentMindmapNode(elements, "n2", "n2")).toBeNull();
    const next = relayoutAll(apply(elements, reparentMindmapNode(elements, "n5", "n3")!));
    expect(textsOf(next, rootId)).toEqual({ Root: [{ A: [{ a1: ["B"] }, "a2"] }] });
    const edge = live(next).find((element) => (mindmapDataOf(element.customData) as { child?: string } | null)?.child === "n5")!;
    expect(edge.startBinding).toMatchObject({ elementId: "n3" });
  });
});

describe("collapsing", () => {
  it("stashes the descendants in the node and puts them back with the same ids", () => {
    const { elements, rootId } = sample();
    const collapsed = apply(elements, collapseMindmapNode(elements, "n2"));
    expect(live(collapsed).map((element) => element.id).sort()).not.toContain("n3");
    expect(textsOf(collapsed, rootId)).toEqual({ Root: ["A", "B"] });
    const data = nodeData(collapsed, "n2");
    expect(data.collapsed).toBe(true);
    expect(data.stash!.map((element) => element.id).sort()).toEqual(expect.arrayContaining(["n3", "n3-t", "n4", "n4-t"]));
    const expanded = apply(collapsed, expandMindmapNode(collapsed, "n2"));
    expect(textsOf(expanded, rootId)).toEqual({ Root: [{ A: ["a1", "a2"] }, "B"] });
    expect(nodeData(expanded, "n2").collapsed).toBeUndefined();
    expect(nodeData(expanded, "n2").stash).toBeUndefined();
  });

  it("flattens nested stashes and keeps an inner collapsed node collapsed after expanding the outer one", () => {
    counter = 0;
    const { skeletons, rootId } = mindmapSkeletons(tree("R", tree("A", tree("B", tree("C")))), { direction: "right", newId: nextId });
    let elements = materialize(skeletons);
    elements = apply(elements, collapseMindmapNode(elements, "n3")); // B を畳む（C を預ける）
    elements = apply(elements, collapseMindmapNode(elements, "n2")); // A を畳む（B と、B の預かり分）
    const outer = nodeData(elements, "n2");
    expect(outer.stash!.map((element) => element.id)).toEqual(expect.arrayContaining(["n3", "n4"]));
    // 入れ子にしない：B の写しは預かり分を持たない。
    const innerCopy = outer.stash!.find((element) => element.id === "n3")!;
    expect((mindmapDataOf(innerCopy.customData) as MindmapNodeData).stash).toBeUndefined();
    elements = apply(elements, expandMindmapNode(elements, "n2"));
    expect(textsOf(elements, rootId)).toEqual({ R: [{ A: ["B"] }] });
    expect(nodeData(elements, "n3")).toMatchObject({ collapsed: true });
    expect(nodeData(elements, "n3").stash!.map((element) => element.id)).toEqual(expect.arrayContaining(["n4", "n4-t"]));
    elements = apply(elements, expandMindmapNode(elements, "n3"));
    expect(textsOf(elements, rootId)).toEqual({ R: [{ A: [{ B: ["C"] }] }] });
  });

  it("expands a collapsed node before adding a child to it", () => {
    const { elements, rootId } = sample();
    const collapsed = apply(elements, collapseMindmapNode(elements, "n2"));
    const next = relayoutAll(apply(collapsed, addMindmapChild(collapsed, "n2", "a3", () => "c4")));
    expect(textsOf(next, rootId)).toEqual({ Root: [{ A: ["a1", "a2", "a3"] }, "B"] });
  });
});

describe("direction and selection", () => {
  it("switches the whole tree to both sides", () => {
    const { elements, rootId } = sample();
    const next = relayoutAll(apply(elements, setMindmapDirection(elements, "n3", "both")));
    expect(nodeData(next, rootId).direction).toBe("both");
    const root = next.find((element) => element.id === rootId)!;
    expect(next.find((element) => element.id === "n5")!.x).toBeLessThan(root.x);
  });

  it("describes a single selected node (or its text) and ignores mixed selections", () => {
    const { elements, rootId } = sample();
    expect(mindmapSelection(elements, ["n2", "n2-t"])).toMatchObject({ nodeId: "n2", rootId, isRoot: false, hasChildren: true, collapsed: false, side: "right" });
    expect(mindmapSelection(elements, [rootId])).toMatchObject({ isRoot: true, side: "root" });
    expect(mindmapSelection(elements, ["n2", "n3"])).toBeNull();
    expect(mindmapSelection(elements, ["n2", "free-shape"])).toBeNull();
  });
});

describe("duplicating", () => {
  it("turns a copied branch into its own tree and drops edges that lost an end", () => {
    const { elements } = sample();
    const pick = (id: string) => elements.find((element) => element.id === id)!;
    const edgeTo = (child: string) => elements.find((element) => (mindmapDataOf(element.customData) as { child?: string } | null)?.child === child)!;
    const pairs = [
      { from: pick("n2"), to: { ...pick("n2"), id: "d2" } },
      { from: pick("n3"), to: { ...pick("n3"), id: "d3" } },
      { from: edgeTo("n3"), to: { ...edgeTo("n3"), id: "e3" } },
      { from: edgeTo("n2"), to: { ...edgeTo("n2"), id: "e2" } },
    ];
    const remapped = remapMindmapDuplicates(pairs);
    expect(mindmapDataOf(remapped.get("d2")!.customData)).toMatchObject({ role: "node", tree: "d2", parent: null, direction: "right" });
    expect(mindmapDataOf(remapped.get("d3")!.customData)).toMatchObject({ role: "node", tree: "d2", parent: "d2" });
    expect(mindmapDataOf(remapped.get("e3")!.customData)).toMatchObject({ role: "edge", tree: "d2", parent: "d2", child: "d3" });
    // 根との線は親を複製していないので、ただの矢印になる。
    expect(mindmapDataOf(remapped.get("e2")!.customData)).toBeNull();
  });
});

describe("edge bindings", () => {
  it("records new edges on both end nodes so the line follows the nodes", () => {
    let { elements } = sample();
    elements = relayoutAll(apply(elements, addMindmapChild(elements, "n2", "a3", () => "c5")));
    const edge = live(elements).find((element) => (mindmapDataOf(element.customData) as { child?: string } | null)?.child === "c5")!;
    const bound = apply(elements, bindMindmapEdges(elements));
    for (const id of ["n2", "c5"]) {
      expect(bound.find((element) => element.id === id)!.boundElements).toEqual(expect.arrayContaining([{ id: edge.id, type: "arrow" }]));
    }
    // 2 回目は何も変えない。
    expect(bindMindmapEdges(bound).patches.size).toBe(0);
  });
});

describe("drop target", () => {
  it("finds the node under the dragged node's center but never the node itself or its descendants", () => {
    const { elements } = sample();
    const at = (id: string, over: string) => elements.map((element) => {
      if (element.id !== id) return element;
      const target = elements.find((item) => item.id === over)!;
      return { ...element, x: target.x + target.width / 2 - element.width / 2, y: target.y + target.height / 2 - element.height / 2 };
    });
    expect(mindmapDropTarget(at("n5", "n3"), "n5")).toBe("n3");
    expect(mindmapDropTarget(at("n2", "n3"), "n2")).toBeNull();
    expect(mindmapDropTarget(elements, "n5")).toBeNull();
  });
});

describe("collapsed nodes", () => {
  it("lists collapsed nodes with the number of hidden topics", () => {
    const { elements } = sample();
    const collapsed = apply(elements, collapseMindmapNode(elements, "n2"));
    expect(collapsedMindmapNodes(collapsed)).toEqual([expect.objectContaining({ nodeId: "n2", side: "right", hidden: 2 })]);
    expect(collapsedMindmapNodes(elements)).toEqual([]);
  });
});
