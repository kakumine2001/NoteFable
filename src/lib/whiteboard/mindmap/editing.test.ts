import { duplicateElements, reconcileDuplicatedElements } from "@excalidraw/element";
import { describe, expect, it } from "vitest";
import {
  addMindmapChild, addMindmapSibling, bindMindmapEdges, collapsedMindmapNodes, collapseMindmapNode, composeMindmapScene, deleteMindmapNodes, expandMindmapNode,
  includesMindmapNode, insertMindmapElements, mindmapDropTarget, mindmapRootsOf, mindmapSelection, readMindmapTrees, relayoutMindmap, remapMindmapDuplicates,
  remapMindmapDuplicateScene, reparentMindmapNode, setMindmapDirection, type MindmapChange, type MindmapSceneTools, type SceneElement,
} from "@/lib/whiteboard/mindmap/editing";
import { mindmapSkeletons, type MindmapSkeleton } from "@/lib/whiteboard/mindmap/elements";
import { mindmapDataOf, mindmapStashOutline, type MindmapNodeData, type MindmapTreeNode } from "@/lib/whiteboard/mindmap/model";

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

// エディターと同じ手順（composeMindmapScene）で差分を当てる。update は newElementWith と同じく、変わるときだけ版を上げる。
// create は Excalidraw の変換と同じく、下書きの start / end を結び付けに使わない（エディターは外して渡す）。
const tools: MindmapSceneTools<SceneElement> = {
  update: (element, values, force) => {
    const changed = Object.entries(values).some(([key, value]) => element[key] !== value || (typeof value === "object" && value !== null));
    return changed || force ? { ...element, ...values, version: Number(element.version ?? 1) + 1 } : element;
  },
  create: (skeletons) => materialize(skeletons.map((skeleton) => ({ ...skeleton, start: undefined, end: undefined }))).map((element) => ({
    ...element, version: 1, ...(element.type === "arrow" ? { startBinding: null, endBinding: null } : {}),
  })),
};
const compose = (elements: SceneElement[], change: MindmapChange, roots: Iterable<string> = []) => composeMindmapScene(elements, change, roots, tools)!.elements;
const edgeOf = (elements: SceneElement[], child: string) => live(elements).find((element) => (mindmapDataOf(element.customData) as { child?: string } | null)?.child === child)!;
const lock = (elements: SceneElement[], ...ids: string[]) => elements.map((element) => (ids.includes(element.id) ? { ...element, locked: true } : element));
const liveIds = (elements: SceneElement[]) => live(elements).map((element) => element.id);

describe("composing a change into the scene", () => {
  it("binds the connectors it creates in the same step, on both the arrow and the nodes", () => {
    const { elements } = sample();
    const next = compose(elements, addMindmapChild(elements, "n2", "a3", () => "c6"));
    const edge = edgeOf(next, "c6");
    expect(edge.startBinding).toMatchObject({ elementId: "n2" });
    expect(edge.endBinding).toMatchObject({ elementId: "c6" });
    for (const id of ["n2", "c6"]) {
      expect(next.find((element) => element.id === id)!.boundElements).toEqual(expect.arrayContaining([{ id: edge.id, type: "arrow" }]));
    }
    // もう 1 回置き直しても何も変わらない。
    expect(relayoutMindmap(next, "n1").patches.size).toBe(0);
  });

  it("restores collapsed elements as newer versions than the deleted copies, so undo records them", () => {
    const { elements } = sample();
    const versioned = elements.map((element) => ({ ...element, version: 3, isDeleted: false }));
    const collapsed = compose(versioned, collapseMindmapNode(versioned, "n2"));
    const expanded = compose(collapsed, expandMindmapNode(collapsed, "n2"));
    for (const id of ["n3", "n4", "n3-t"]) {
      const before = collapsed.find((element) => element.id === id)!;
      const after = expanded.find((element) => element.id === id)!;
      expect(before.isDeleted).toBe(true);
      expect(after.isDeleted).toBe(false);
      expect(Number(after.version)).toBeGreaterThan(Number(before.version));
    }
    expect(expanded).toHaveLength(versioned.length);
  });

  it("puts new connectors below their parent node", () => {
    const list = [{ id: "a" }, { id: "p" }];
    const edge = { id: "e", customData: { notefableMindmap: { v: 1, role: "edge", tree: "p", parent: "p", child: "c" } } };
    expect(insertMindmapElements<{ id: string; customData?: unknown }>(list, [{ id: "c" }, edge, { id: "a", customData: null }]).map((item) => item.id)).toEqual(["a", "e", "p", "c"]);
  });
});

describe("duplicating on the board (Excalidraw onDuplicate)", () => {
  it("returns every element of the next scene, so nothing but the copies changes", () => {
    const { elements } = sample();
    const free = { id: "free", type: "rectangle", x: 0, y: 900, width: 10, height: 10 };
    const board = [...elements, free].map((element) => ({
      version: 1, versionNonce: 1, isDeleted: false, locked: false, angle: 0, groupIds: [], frameId: null, boundElements: null, containerId: null, ...element,
    }));
    const copied = new Map(board.filter((element) => element.id === "n3" || element.id === "n3-t").map((element) => [element.id, element]));
    const duplication = duplicateElements({ type: "in-place", elements: board as never, idsOfElementsToDuplicate: copied as never, appState: { editingGroupId: null, selectedGroupIds: {} }, randomizeSeed: true });
    const pairs = [...duplication.duplicateIdToOrigId].map(([duplicateId, originalId]) => ({
      from: duplication.origElementsMap.get(originalId) as unknown as SceneElement,
      to: duplication.duplicateElementsMap.get(duplicateId) as unknown as SceneElement,
    }));
    const returned = remapMindmapDuplicateScene(duplication.elementsWithDuplicates as unknown as SceneElement[], pairs)!;
    const result = reconcileDuplicatedElements(returned as never, duplication.elementsWithDuplicates, duplication.duplicatedElements);
    const ids = result.elements.map((element) => element.id);
    expect(ids).toEqual(expect.arrayContaining(board.map((element) => element.id)));
    expect(ids).toHaveLength(board.length + 2);
    const copy = result.duplicatedElements.find((element) => element.type === "rectangle")!;
    expect(mindmapDataOf(copy.customData)).toMatchObject({ role: "node", tree: copy.id, parent: null });
    expect(mindmapDataOf(result.elements.find((element) => element.id === "n3")!.customData)).toMatchObject({ parent: "n2" });
  });

  it("leaves duplication to Excalidraw when no mind map element is copied", () => {
    const shape = { id: "free", type: "rectangle", x: 0, y: 0, width: 10, height: 10 };
    expect(remapMindmapDuplicateScene([shape], [{ from: shape, to: { ...shape, id: "copy" } }])).toBeNull();
  });
});

describe("locked elements", () => {
  it("keeps a locked branch when its ancestor is deleted, as its own mind map", () => {
    const { elements, rootId } = sample();
    const locked = lock(elements, "n3");
    const next = compose(locked, deleteMindmapNodes(locked, ["n2"]));
    expect(liveIds(next)).toEqual(expect.arrayContaining([rootId, "n3", "n3-t", "n5"]));
    expect(liveIds(next)).not.toContain("n2");
    expect(liveIds(next)).not.toContain("n4");
    expect(nodeData(next, "n3")).toMatchObject({ parent: null, tree: "n3", direction: "right" });
    // ロックした節は動かさない。
    expect(next.find((element) => element.id === "n3")).toMatchObject({ x: locked.find((element) => element.id === "n3")!.x, y: locked.find((element) => element.id === "n3")!.y });
    expect(edgeOf(next, "n3")).toBeUndefined();
    expect(textsOf(next, rootId)).toEqual({ Root: ["B"] });
  });

  it("deletes nothing when the selected node itself is locked", () => {
    const { elements } = sample();
    expect(deleteMindmapNodes(lock(elements, "n3"), ["n3"]).patches.size).toBe(0);
  });

  it("does not collapse a branch that holds a locked element", () => {
    const { elements, rootId } = sample();
    for (const id of ["n4", "n3-t", edgeOf(elements, "n3").id]) {
      const locked = lock(elements, id);
      expect(collapseMindmapNode(locked, "n2").patches.size).toBe(0);
      expect(mindmapSelection(locked, ["n2"])).toMatchObject({ hasChildren: true, canCollapse: false });
      expect(mindmapSelection(locked, [rootId])).toMatchObject({ canCollapse: false });
    }
    // 節自身がロックされていても、隠すのは子孫だけ。
    expect(mindmapSelection(lock(elements, "n2"), ["n2"])).toMatchObject({ canCollapse: true });
  });
});

describe("large boards", () => {
  // 節 5,000 + 節の文字 5,000 + 線 4,999 + ふつうの図形 5,000 = 約 20,000 要素。
  function bigBoard() {
    const leaves = Array.from({ length: 4_899 }, (_, index) => tree(`leaf ${index}`));
    const branches = Array.from({ length: 100 }, (_, index) => tree(`branch ${index}`, ...leaves.slice(index * 49, index * 49 + 49)));
    counter = 0;
    const { skeletons, rootId } = mindmapSkeletons(tree("Root", ...branches), { direction: "right", newId: nextId });
    const shapes = Array.from({ length: 5_000 }, (_, index) => ({ id: `s${index}`, type: "rectangle", x: index, y: -1000, width: 10, height: 10 }));
    return { elements: [...materialize(skeletons), ...shapes] as SceneElement[], rootId, shapes };
  }

  it("selects, finds, lays out, collapses, expands and deletes about 20,000 elements quickly", () => {
    const { elements, rootId, shapes } = bigBoard();
    expect(elements.length).toBeGreaterThan(19_000);
    const ids = elements.map((element) => element.id);
    const started = Date.now();
    expect(includesMindmapNode(elements, shapes.map((shape) => shape.id))).toBe(false);
    expect([...mindmapRootsOf(elements, ids)]).toEqual([rootId]);
    expect(mindmapSelection(elements, [rootId])).toMatchObject({ canCollapse: true });
    let current = compose(elements, { patches: new Map(), added: [], restored: [] }, [rootId]);
    current = compose(current, collapseMindmapNode(current, rootId));
    current = compose(current, expandMindmapNode(current, rootId));
    expect(live(current)).toHaveLength(elements.length);
    current = compose(current, deleteMindmapNodes(current, ids));
    expect(live(current)).toHaveLength(shapes.length);
    // 2 乗の処理があると数十秒かかる。遅い CI でも余裕のある上限にする。
    expect(Date.now() - started).toBeLessThan(8_000);
  }, 20_000);

  it("does nothing costly on a board without mind map marks", () => {
    const shapes = Array.from({ length: 20_000 }, (_, index) => ({ id: `s${index}`, type: "rectangle", x: index, y: 0, width: 10, height: 10 }));
    const ids = shapes.map((shape) => shape.id);
    const started = Date.now();
    expect(includesMindmapNode(shapes, ids)).toBe(false);
    expect(mindmapSelection(shapes, ids)).toBeNull();
    expect(mindmapRootsOf(shapes, ids).size).toBe(0);
    expect(deleteMindmapNodes(shapes, ids).patches.size).toBe(0);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

// 節（結び付いた文字ごと）を切り取って貼る・複製する：Excalidraw と同じく、複製した要素は新しい ID、預かり分は customData のまま渡る。
function duplicateNode(elements: SceneElement[], id: string, copyId: string, newId: () => string) {
  const pick = (elementId: string) => elements.find((element) => element.id === elementId)!;
  const pairs = [
    { from: pick(id), to: { ...pick(id), id: copyId, boundElements: [{ id: `${copyId}-t`, type: "text" }] } },
    { from: pick(`${id}-t`), to: { ...pick(`${id}-t`), id: `${copyId}-t`, containerId: copyId } },
  ];
  const patches = remapMindmapDuplicates(pairs, newId);
  return pairs.map(({ to }) => ({ ...to, ...(patches.get(to.id) ?? {}), isDeleted: false }) as SceneElement);
}

describe("moving or copying a collapsed node", () => {
  // R > A > B > C。B を畳んでから A を畳む（A の預かり分に B と C がある）。
  function collapsedTwice() {
    counter = 0;
    const { skeletons } = mindmapSkeletons(tree("R", tree("A", tree("B", tree("C")))), { direction: "right", newId: nextId });
    let elements = materialize(skeletons);
    elements = compose(elements, collapseMindmapNode(elements, "n3"));
    return compose(elements, collapseMindmapNode(elements, "n2"));
  }

  it("keeps the hidden branch through cut, paste and expand", () => {
    const elements = collapsedTwice();
    let n = 0;
    // 切り取り：元は消え、貼った節だけが預かり分を持つ。
    const pasted = duplicateNode(elements, "n2", "p", () => `new${++n}`);
    expect(collapsedMindmapNodes(pasted)).toEqual([expect.objectContaining({ nodeId: "p", hidden: 2 })]);
    const outer = compose(pasted, expandMindmapNode(pasted, "p"));
    expect(collapsedMindmapNodes(outer)).toEqual([expect.objectContaining({ hidden: 1 })]);
    const all = compose(outer, expandMindmapNode(outer, collapsedMindmapNodes(outer)[0].nodeId));
    const trees = readMindmapTrees(all);
    expect([...trees.keys()]).toEqual(["p"]);
    expect(trees.get("p")!.nodes.size).toBe(3);
    expect(live(all).filter((element) => element.type === "text").map((element) => element.originalText).sort()).toEqual(["A", "B", "C"]);
    // 元の ID はどこにも残らず、線は新しい節どうしを結ぶ。
    expect(JSON.stringify(all)).not.toMatch(/"n[0-9]+(-t)?"/);
    const edges = live(all).filter((element) => element.type === "arrow");
    expect(edges).toHaveLength(2);
    for (const edge of edges) {
      const data = mindmapDataOf(edge.customData) as { parent: string; child: string; tree: string };
      expect(data.tree).toBe("p");
      expect(edge.startBinding).toMatchObject({ elementId: data.parent });
      expect(edge.endBinding).toMatchObject({ elementId: data.child });
    }
  });

  it("gives every copy its own ids for the hidden elements", () => {
    const elements = collapsedTwice();
    let n = 0;
    const newId = () => `new${++n}`;
    const ids = ["p", "q"].flatMap((copy) => nodeData(duplicateNode(elements, "n2", copy, newId), copy).stash!.map((element) => element.id));
    const originals = nodeData(elements, "n2").stash!.map((element) => element.id);
    expect(new Set([...ids, ...originals]).size).toBe(ids.length + originals.length);
  });
});

describe("labelled connectors", () => {
  // 子 child への線に文字を付ける。
  const label = (elements: SceneElement[], child: string) => {
    const edge = edgeOf(elements, child);
    return [
      ...elements.map((element) => (element.id === edge.id ? { ...element, boundElements: [{ id: `label-${child}`, type: "text" }] } : element)),
      { id: `label-${child}`, type: "text", x: 0, y: 0, width: 10, height: 10, containerId: edge.id, text: `why ${child}`, originalText: `why ${child}` },
    ] as SceneElement[];
  };
  const labels = (elements: SceneElement[]) => liveIds(elements).filter((id) => id.startsWith("label-")).sort();

  it("hides the label with its branch and brings it back on expand, level by level", () => {
    counter = 0;
    const { skeletons } = mindmapSkeletons(tree("R", tree("A", tree("B", tree("C")))), { direction: "right", newId: nextId });
    let elements = label(label(materialize(skeletons), "n3"), "n4");
    elements = compose(elements, collapseMindmapNode(elements, "n3"));
    expect(labels(elements)).toEqual(["label-n3"]);
    elements = compose(elements, collapseMindmapNode(elements, "n2"));
    expect(labels(elements)).toEqual([]);
    expect(mindmapStashOutline("n2", elements.find((element) => element.id === "n2")!.customData).map((line) => `${line.depth} ${line.text}`).sort())
      .toEqual(["1 B", "1 why n3", "2 C", "2 why n4"]);
    elements = compose(elements, expandMindmapNode(elements, "n2"));
    // B はまだ畳んであるので、C への線の文字は B に預け直す。
    expect(labels(elements)).toEqual(["label-n3"]);
    elements = compose(elements, expandMindmapNode(elements, "n3"));
    expect(labels(elements)).toEqual(["label-n3", "label-n4"]);
  });

  it("deletes the label with the branch, and with a connector the layout removes", () => {
    const labelled = label(label(sample().elements, "n2"), "n3");
    expect(labels(compose(labelled, deleteMindmapNodes(labelled, ["n2"])))).toEqual([]);
    // 節を（消しゴムなどで）消した後の置き直し。
    const erased = labelled.map((element) => (element.id === "n3" ? { ...element, isDeleted: true } : element));
    expect(labels(compose(erased, { patches: new Map(), added: [], restored: [] }, ["n1"]))).toEqual(["label-n2"]);
  });
});

describe("frames", () => {
  const frame = (id: string, x: number, y: number, width: number, height: number) => ({ id, type: "frame", x, y, width, height }) as SceneElement;
  const none = (): MindmapChange => ({ patches: new Map(), added: [], restored: [] });
  // 根の枠に収まる節はその枠、はみ出る節は枠の外。文字は節に、線は両端の節にそろう。
  function expectFrames(elements: SceneElement[], box: SceneElement) {
    const of = (id: string) => elements.find((element) => element.id === id)!.frameId ?? null;
    for (const node of live(elements).filter((element) => mindmapDataOf(element.customData)?.role === "node")) {
      const fits = node.x >= box.x && node.y >= box.y && node.x + node.width <= box.x + box.width && node.y + node.height <= box.y + box.height;
      const root = (mindmapDataOf(node.customData) as MindmapNodeData).parent === null;
      expect(of(node.id), node.id).toBe(root || fits ? box.id : null);
      expect(of(`${node.id}-t`), `${node.id}-t`).toBe(of(node.id));
    }
    for (const edge of live(elements).filter((element) => element.type === "arrow")) {
      const data = mindmapDataOf(edge.customData) as { parent: string; child: string };
      expect(of(edge.id)).toBe(of(data.parent) === of(data.child) ? of(data.child) : null);
    }
  }
  // 置き直し済みの木と、それがちょうど入る枠。
  function framed() {
    const { elements, rootId } = sample();
    const placed = compose(elements, none(), [rootId]);
    const parts = placed.filter((element) => element.type !== "arrow");
    const x = Math.min(...parts.map((element) => element.x)) - 10;
    const y = Math.min(...parts.map((element) => element.y)) - 10;
    const box = frame("F", x, y, Math.max(...parts.map((element) => element.x + element.width)) - x + 10, Math.max(...parts.map((element) => element.y + element.height)) - y + 10);
    return { box, rootId, elements: [...placed.map((element) => ({ ...element, frameId: "F" }) as SceneElement), box] };
  }

  it("takes nodes that no longer fit out of the frame, and puts new ones that fit into it", () => {
    const { elements, box } = framed();
    let next = elements;
    for (const id of ["c1", "c2", "c3", "c4"]) next = compose(next, addMindmapChild(next, "n1", id, () => id));
    expectFrames(next, box);
    expect(live(next).some((element) => element.type === "rectangle" && element.frameId === null)).toBe(true);
    // 大きな枠なら、足した節も線も枠に入る。
    const big = elements.map((element) => (element.id === "F" ? frame("F", box.x - 2000, box.y - 2000, 4000, 4000) : element));
    const grown = compose(big, addMindmapChild(big, "n2", "a3", () => "c5"));
    expect(grown.find((element) => element.id === "c5")!.frameId).toBe("F");
    expect(edgeOf(grown, "c5").frameId).toBe("F");
  });

  it("returns a node dropped on another frame to the root's frame", () => {
    const { elements, box, rootId } = framed();
    // Excalidraw がほかの枠の上で離した節にその枠の ID を付けた状態（置き直しで元の場所に戻る）。
    const dropped = [
      ...elements.map((element) => (element.id === "n5" || element.id === "n5-t" ? { ...element, x: 5000, y: 5000, frameId: "G" } : element)),
      frame("G", 4900, 4900, 600, 600),
    ];
    const next = compose(dropped, none(), [rootId]);
    expect(next.find((element) => element.id === "n5")!.frameId).toBe("F");
    expectFrames(next, box);
    // 位置が変わらなくても、枠の ID の食い違いだけで直す。
    const stale = next.map((element) => (element.id === "n5" ? { ...element, frameId: "G" } : element));
    expect(compose(stale, none(), [rootId]).find((element) => element.id === "n5")!.frameId).toBe("F");
  });

  it("does not restore hidden elements into a frame the mind map has left", () => {
    const { elements, rootId } = framed();
    const collapsed = compose(elements, collapseMindmapNode(elements, "n2"));
    const moved = collapsed.map((element) => (element.isDeleted || element.type === "frame" ? element : { ...element, x: element.x + 3000, frameId: null }));
    const expanded = compose(moved, expandMindmapNode(moved, "n2"));
    expect(live(expanded).filter((element) => element.type !== "frame" && element.frameId)).toEqual([]);
    expect(readMindmapTrees(expanded).get(rootId)!.nodes.size).toBe(5);
  });
});
