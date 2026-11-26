import { branchColors, edgeElementSkeleton, edgeGeometry, nodeSkeleton, randomElementId, type MindmapSkeleton } from "@/lib/whiteboard/mindmap/elements";
import { layoutMindmap, mindmapFontSize, type PlacedMindmapNode } from "@/lib/whiteboard/mindmap/layout";
import { MINDMAP_DATA_KEY, mindmapDataOf, type MindmapDirection, type MindmapEdgeData, type MindmapNodeData, type MindmapTreeNode, type StashedElement } from "@/lib/whiteboard/mindmap/model";
import { WHITEBOARD_ELEMENT_TYPES } from "@/lib/whiteboard/scene";

// 白板の上の思考マップを編集する（思考マップのモード：子・兄弟を足す、消す、親を替える、畳む・広げる、向きを替える、置き直す）。
// Excalidraw を読み込まない純粋な関数で、白板の要素の並びを受け取り、変える要素の差分（patches）と、新しく足す要素の下書き（added）・
// 畳みから戻す要素（restored）を返す。エディターはそれを 1 回の updateScene にまとめる（1 回の操作 = 取り消し 1 回）。
// 節の印・線の印・畳んだ子孫の預け方は model.ts。

export type SceneElement = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  customData?: Record<string, unknown> | null;
  containerId?: string | null;
  boundElements?: readonly { id: string; type: string }[] | null;
  locked?: boolean;
  text?: string;
  originalText?: string;
  strokeColor?: string;
  [key: string]: unknown;
};

export type MindmapChange = {
  // 要素ごとの差分（そのまま newElementWith に渡す）。
  patches: Map<string, Record<string, unknown>>;
  // 新しく足す要素の下書き（convertToExcalidrawElements に regenerateIds: false で渡す）。
  added: MindmapSkeleton[];
  // 畳みから戻す要素（預けていた要素そのもの）。
  restored: StashedElement[];
  // 操作の後に選ぶ節（足した節など）と、文字の編集を始める節。
  select?: string;
  edit?: string;
};

const emptyChange = (): MindmapChange => ({ patches: new Map(), added: [], restored: [] });

function patch(change: MindmapChange, id: string, values: Record<string, unknown>) {
  change.patches.set(id, { ...(change.patches.get(id) ?? {}), ...values });
}

const live = (element: SceneElement) => element.isDeleted !== true;

function withMark(element: SceneElement, data: MindmapNodeData | MindmapEdgeData | null) {
  const customData = { ...(element.customData ?? {}) };
  if (data) customData[MINDMAP_DATA_KEY] = data;
  else delete customData[MINDMAP_DATA_KEY];
  return Object.keys(customData).length ? customData : null;
}

// ---- 白板から木を読む ----

export type SceneNode = {
  id: string;
  element: SceneElement;
  data: MindmapNodeData;
  parent: SceneNode | null;
  children: SceneNode[];
  depth: number;
};

export type SceneTree = { root: SceneNode; nodes: Map<string, SceneNode>; direction: MindmapDirection };

// 白板の上の思考マップの木。親が見つからない（消された・別の木）節や、親をたどると輪になる節は、それぞれ独立した木の根として扱う。
// 子は印の順番（order）、同じなら上から。
export function readMindmapTrees(elements: readonly SceneElement[]): Map<string, SceneTree> {
  const nodes = new Map<string, SceneNode>();
  for (const element of elements) {
    if (!live(element)) continue;
    const data = mindmapDataOf(element.customData);
    if (data?.role !== "node") continue;
    nodes.set(element.id, { id: element.id, element, data, parent: null, children: [], depth: 0 });
  }
  const parentOf = (node: SceneNode) => (node.data.parent ? nodes.get(node.data.parent) : undefined);
  // 親をたどると輪に入るか。調べた節は覚えておく（深い木でも 1 回ずつしかたどらない）。
  const loops = new Map<string, boolean>();
  for (const node of nodes.values()) {
    const path = new Set<string>();
    let cursor: SceneNode | undefined = node;
    while (cursor && !loops.has(cursor.id) && !path.has(cursor.id)) {
      path.add(cursor.id);
      cursor = parentOf(cursor);
    }
    const looping = cursor ? loops.get(cursor.id) ?? true : false;
    for (const id of path) loops.set(id, looping);
  }
  for (const node of nodes.values()) {
    // 親の印が正（木の ID は置き直すときに親に合わせて直す）。輪になるなら親を付けない。
    const parent = parentOf(node);
    if (!parent || loops.get(node.id)) continue;
    node.parent = parent;
    parent.children.push(node);
  }
  const trees = new Map<string, SceneTree>();
  for (const node of nodes.values()) {
    node.children.sort((a, b) => a.data.order - b.data.order || a.element.y - b.element.y);
    if (node.parent) continue;
    const treeNodes = new Map<string, SceneNode>();
    const stack: SceneNode[] = [node];
    while (stack.length) {
      const current = stack.pop()!;
      treeNodes.set(current.id, current);
      for (const child of current.children) {
        child.depth = current.depth + 1;
        stack.push(child);
      }
    }
    trees.set(node.id, { root: node, nodes: treeNodes, direction: node.data.direction ?? "right" });
  }
  return trees;
}

// 要素（節・節の文字）の ID から、属する節と木を引く関数。たくさんの ID を引くときは 1 回作って使い回す
// （1 回引くたびに要素の並びをたどると、大きな白板で止まる）。思考マップが無い白板では何も作らない。
export function mindmapFinder(elements: readonly SceneElement[], trees = readMindmapTrees(elements)) {
  if (!trees.size) return () => null;
  const byId = new Map(elements.map((element) => [element.id, element]));
  const located = new Map<string, { tree: SceneTree; node: SceneNode }>();
  for (const tree of trees.values()) {
    for (const node of tree.nodes.values()) located.set(node.id, { tree, node });
  }
  return (elementId: string) => {
    const element = byId.get(elementId);
    const nodeId = element?.type === "text" && element.containerId ? element.containerId : elementId;
    return located.get(nodeId) ?? null;
  };
}

// その要素（節・節の文字）が属する節と木。
export function findMindmapNode(elements: readonly SceneElement[], elementId: string, trees = readMindmapTrees(elements)) {
  return mindmapFinder(elements, trees)(elementId);
}

function textOf(byId: ReadonlyMap<string, SceneElement>, node: SceneElement) {
  const bound = node.boundElements?.find((item) => item.type === "text");
  const text = bound ? byId.get(bound.id) : undefined;
  return typeof text?.originalText === "string" ? text.originalText : typeof text?.text === "string" ? text.text : "";
}

function boundTextId(node: SceneElement) {
  return node.boundElements?.find((item) => item.type === "text")?.id ?? null;
}

function descendants(node: SceneNode): SceneNode[] {
  const out: SceneNode[] = [];
  const stack = [...node.children];
  while (stack.length) {
    const current = stack.pop()!;
    out.push(current);
    stack.push(...current.children);
  }
  return out;
}

function edgesOf(elements: readonly SceneElement[]) {
  const edges: { element: SceneElement; data: MindmapEdgeData }[] = [];
  for (const element of elements) {
    if (!live(element)) continue;
    const data = mindmapDataOf(element.customData);
    if (data?.role === "edge") edges.push({ element, data });
  }
  return edges;
}

// ---- 置き直す ----

// 木を、いまの節の大きさで並べ直す。根は動かさない。節・節の文字・線を動かし、印の食い違い（木の ID・兄弟の順番）を直す。
// 線が消されていたら作り直し、片方の端が無い線は消す。変わらないなら空の差分。
export function relayoutMindmap(elements: readonly SceneElement[], rootId: string, change: MindmapChange = emptyChange()): MindmapChange {
  return relayoutMindmaps(elements, [rootId], change);
}

type SceneEdge = { element: SceneElement; data: MindmapEdgeData };

// いくつもの木をまとめて置き直す（白板を木の数だけたどり直さない）。
export function relayoutMindmaps(elements: readonly SceneElement[], rootIds: Iterable<string>, change: MindmapChange = emptyChange()): MindmapChange {
  const trees = readMindmapTrees(elements);
  const targets = [...new Set(rootIds)].filter((id) => trees.has(id));
  if (!targets.length) return change;
  const byId = new Map(elements.map((element) => [element.id, element]));
  const rootOfNode = new Map<string, string>();
  for (const [rootId, tree] of trees) {
    for (const id of tree.nodes.keys()) rootOfNode.set(id, rootId);
  }
  // 線を、子ごと（動かす相手）と、関係する木ごと（余りの後始末）に引けるようにする。
  const edgeOfChild = new Map<string, SceneEdge>();
  const edgesOfRoot = new Map<string, Set<SceneEdge>>();
  for (const edge of edgesOf(elements)) {
    if (!edgeOfChild.has(edge.data.child)) edgeOfChild.set(edge.data.child, edge);
    for (const rootId of [edge.data.tree, rootOfNode.get(edge.data.child), rootOfNode.get(edge.data.parent)]) {
      if (!rootId) continue;
      const set = edgesOfRoot.get(rootId);
      if (set) set.add(edge);
      else edgesOfRoot.set(rootId, new Set([edge]));
    }
  }
  for (const rootId of targets) relayoutTree(trees.get(rootId)!, byId, edgeOfChild, edgesOfRoot.get(rootId) ?? [], change);
  return change;
}

function relayoutTree(
  tree: SceneTree, byId: ReadonlyMap<string, SceneElement>, edgeOfChild: ReadonlyMap<string, SceneEdge>,
  treeEdges: Iterable<SceneEdge>, change: MindmapChange,
) {
  const rootId = tree.root.id;
  const toTree = (node: SceneNode): MindmapTreeNode => ({
    text: textOf(byId, node.element), key: node.id, size: { width: node.element.width, height: node.element.height },
    children: node.children.map(toTree),
  });
  const layout = layoutMindmap(toTree(tree.root), tree.direction);
  const byKey = new Map(layout.nodes.map((placed) => [placed.key!, placed]));
  const rootPlaced = byKey.get(rootId)!;
  const offset = { x: tree.root.element.x - rootPlaced.x, y: tree.root.element.y - rootPlaced.y };
  const target = (placed: PlacedMindmapNode) => ({ x: placed.x + offset.x, y: placed.y + offset.y, width: placed.width, height: placed.height });
  const orderOf = new Map<string, number>();
  for (const node of tree.nodes.values()) node.children.forEach((child, index) => orderOf.set(child.id, index));

  for (const node of tree.nodes.values()) {
    const placed = byKey.get(node.id)!;
    const box = target(placed);
    const dx = box.x - node.element.x;
    const dy = box.y - node.element.y;
    if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) {
      patch(change, node.id, { x: box.x, y: box.y });
      const textId = boundTextId(node.element);
      const text = textId ? byId.get(textId) : undefined;
      if (text) patch(change, text.id, { x: text.x + dx, y: text.y + dy });
    }
    // 印を木に合わせる（木の ID・親・兄弟の順番）。
    const order = orderOf.get(node.id) ?? 0;
    const parentId = node.parent?.id ?? null;
    if (node.data.tree !== rootId || node.data.parent !== parentId || node.data.order !== order) {
      const data: MindmapNodeData = { ...node.data, tree: rootId, parent: parentId, order };
      if (parentId) delete data.direction;
      patch(change, node.id, { customData: withMark(node.element, data) });
    }
  }

  // 線：子ごとに 1 本。無ければ作り、余り・端の無いものは消す。
  const used = new Set<string>();
  for (const node of tree.nodes.values()) {
    if (!node.parent) continue;
    const parentBox = target(byKey.get(node.parent.id)!);
    const childPlaced = byKey.get(node.id)!;
    const geometry = edgeGeometry(parentBox, target(childPlaced), childPlaced.side !== "left");
    const data: MindmapEdgeData = { v: 1, role: "edge", tree: rootId, parent: node.parent.id, child: node.id };
    const existing = edgeOfChild.get(node.id);
    if (!existing) {
      change.added.push(edgeElementSkeleton(randomElementId(), geometry, { parent: node.parent.id, child: node.id }, colorOf(tree, node), node.depth, data));
      continue;
    }
    used.add(existing.element.id);
    const startBinding = { ...(existing.element.startBinding as Record<string, unknown> | null ?? {}), elementId: node.parent.id, fixedPoint: geometry.startFixedPoint, mode: "orbit" };
    const endBinding = { ...(existing.element.endBinding as Record<string, unknown> | null ?? {}), elementId: node.id, fixedPoint: geometry.endFixedPoint, mode: "orbit" };
    const moved = Math.abs(existing.element.x - geometry.x) >= 0.5 || Math.abs(existing.element.y - geometry.y) >= 0.5
      || JSON.stringify(existing.element.points) !== JSON.stringify(geometry.points)
      || (existing.element.startBinding as { elementId?: string } | null)?.elementId !== node.parent.id
      || (existing.element.endBinding as { elementId?: string } | null)?.elementId !== node.id;
    if (moved) {
      patch(change, existing.element.id, {
        x: geometry.x, y: geometry.y, points: geometry.points, width: geometry.width, height: geometry.height, startBinding, endBinding,
      });
    }
    if (existing.data.tree !== rootId || existing.data.parent !== node.parent.id) patch(change, existing.element.id, { customData: withMark(existing.element, data) });
  }
  for (const { element, data } of treeEdges) {
    if (used.has(element.id)) continue;
    // この木の線で、どの子にも使われなかったもの（子か親が消された・別の線と重複）は消す。
    const ends = [...new Set([data.child, data.parent])].filter((id) => {
      const end = byId.get(id);
      return !!end && live(end);
    });
    if (ends.length < 2 || tree.nodes.has(data.child)) patch(change, element.id, { isDeleted: true });
  }
}

// 根の子（最初の枝）の色。深い節は最初の枝の色を受け継ぐ。
function colorOf(tree: SceneTree, node: SceneNode) {
  let first = node;
  while (first.parent && first.parent !== tree.root) first = first.parent;
  if (first === tree.root) return branchColors(-1).stroke;
  return typeof first.element.strokeColor === "string" ? first.element.strokeColor : branchColors(tree.root.children.indexOf(first)).stroke;
}

// ---- 足す ----

function newNode(tree: SceneTree, parent: SceneNode, order: number, text: string, newId: () => string, change: MindmapChange) {
  const id = newId();
  const depth = parent.depth + 1;
  // 新しい最初の枝は、まだ使っていない色。深い節は最初の枝の色。
  const branch = depth === 1 ? parent.children.length : -2;
  const width = depth === 1 ? 120 : 96;
  const height = depth === 1 ? 49 : 44;
  const skeleton = nodeSkeleton(
    { x: parent.element.x + parent.element.width + 64, y: parent.element.y, width, height, depth, branch: Math.max(branch, 0), text, fontSize: mindmapFontSize(depth) },
    id, { v: 1, role: "node", tree: tree.root.id, parent: parent.id, order }, { x: 0, y: 0 },
  );
  if (depth > 1) {
    const color = colorOf(tree, parent);
    skeleton.strokeColor = color;
  }
  change.added.push(skeleton);
  change.select = id;
  change.edit = id;
  return id;
}

// 子を足す（いちばん下に）。畳んでいれば先に広げる。
export function addMindmapChild(elements: readonly SceneElement[], nodeId: string, text: string, newId: () => string = randomElementId): MindmapChange {
  const found = findMindmapNode(elements, nodeId);
  if (!found) return emptyChange();
  const change = found.node.data.collapsed ? expandMindmapNode(elements, found.node.id) : emptyChange();
  newNode(found.tree, found.node, found.node.children.length + countStashedChildren(found.node), text, newId, change);
  return change;
}

function countStashedChildren(node: SceneNode) {
  return (node.data.stash ?? []).filter((element) => mindmapDataOf(element.customData)?.role === "node" && (mindmapDataOf(element.customData) as MindmapNodeData).parent === node.id).length;
}

// 兄弟を足す（すぐ下に）。根では子を足す。
export function addMindmapSibling(elements: readonly SceneElement[], nodeId: string, text: string, newId: () => string = randomElementId): MindmapChange {
  const found = findMindmapNode(elements, nodeId);
  if (!found) return emptyChange();
  const parent = found.node.parent;
  if (!parent) return addMindmapChild(elements, nodeId, text, newId);
  const change = emptyChange();
  const order = parent.children.indexOf(found.node) + 1;
  // 後ろの兄弟を 1 つずつ下げる。
  parent.children.slice(order).forEach((sibling, index) => {
    patch(change, sibling.id, { customData: withMark(sibling.element, { ...sibling.data, order: order + 1 + index }) });
  });
  newNode(found.tree, parent, order, text, newId, change);
  return change;
}

// ---- 消す ----

// 選んだ節とその子孫（節の文字・線・畳んで預けた分も）を消す。根を選んだら木ごと。残った兄弟の順番を詰める。
// ロックした節は消さない：その節から下の枝は残り、親が消えればロックした節を根にした別の思考マップになる。
// 節の文字と線は節に付いて消える（節の無い文字・線は残せない）。
export function deleteMindmapNodes(elements: readonly SceneElement[], ids: readonly string[]): MindmapChange {
  const change = emptyChange();
  const trees = readMindmapTrees(elements);
  const find = mindmapFinder(elements, trees);
  const doomed = new Set<string>();
  for (const id of ids) {
    const found = find(id);
    if (!found || found.node.element.locked || doomed.has(found.node.id)) continue;
    const stack = [found.node];
    while (stack.length) {
      const node = stack.pop()!;
      doomed.add(node.id);
      for (const child of node.children) {
        if (!child.element.locked && !doomed.has(child.id)) stack.push(child);
      }
    }
  }
  if (!doomed.size) return change;
  for (const element of elements) {
    if (!live(element)) continue;
    if (doomed.has(element.id)) { patch(change, element.id, { isDeleted: true }); continue; }
    if (element.type === "text" && element.containerId && doomed.has(element.containerId)) { patch(change, element.id, { isDeleted: true }); continue; }
    const data = mindmapDataOf(element.customData);
    if (data?.role === "edge" && (doomed.has(data.child) || doomed.has(data.parent))) patch(change, element.id, { isDeleted: true });
  }
  for (const tree of trees.values()) {
    for (const node of tree.nodes.values()) {
      if (doomed.has(node.id)) continue;
      // 親が消えて残る節（ロックした節）は、自分を根にする。
      if (node.parent && doomed.has(node.parent.id)) {
        patch(change, node.id, { customData: withMark(node.element, { ...node.data, tree: node.id, parent: null, order: 0, direction: "right" }) });
      }
      // 残る兄弟の順番を詰める。
      const remaining = node.children.filter((child) => !doomed.has(child.id));
      if (remaining.length === node.children.length) continue;
      remaining.forEach((child, index) => {
        if (child.data.order !== index) patch(change, child.id, { customData: withMark(child.element, { ...child.data, order: index }) });
      });
    }
  }
  return change;
}

// 消す操作に、思考マップの節が含まれるか（含まれれば deleteMindmapNodes で子孫ごと消す）。
export function includesMindmapNode(elements: readonly SceneElement[], ids: readonly string[]) {
  const find = mindmapFinder(elements);
  return ids.some((id) => find(id) !== null);
}

// ---- 親を替える ----

// 節を別の節の子（いちばん下）にする。自分や自分の子孫の下には付けない（輪になる）。別の木の節の下にも付けられる（木ごと移る）。
export function reparentMindmapNode(elements: readonly SceneElement[], nodeId: string, newParentId: string): MindmapChange | null {
  const find = mindmapFinder(elements);
  const found = find(nodeId);
  const target = find(newParentId);
  if (!found || !target || found.node.id === target.node.id) return null;
  if (descendants(found.node).some((node) => node.id === target.node.id)) return null;
  if (found.node.parent?.id === target.node.id) return null;
  const change = target.node.data.collapsed ? expandMindmapNode(elements, target.node.id) : emptyChange();
  const order = target.node.children.length + countStashedChildren(target.node);
  const data: MindmapNodeData = { ...found.node.data, parent: target.node.id, order, tree: target.tree.root.id };
  delete data.direction;
  patch(change, found.node.id, { customData: withMark(found.node.element, data) });
  // 子孫の木の ID を新しい木に。
  for (const node of descendants(found.node)) {
    patch(change, node.id, { customData: withMark(node.element, { ...node.data, tree: target.tree.root.id }) });
  }
  // 元の兄弟の順番を詰める。
  if (found.node.parent) {
    found.node.parent.children.filter((child) => child !== found.node).forEach((child, index) => {
      if (child.data.order !== index) patch(change, child.id, { customData: withMark(child.element, { ...child.data, order: index }) });
    });
  }
  return change;
}

// ---- 畳む・広げる ----

// 畳むと白板から外す要素：子孫の節・節の文字・子孫への線。
function hiddenByCollapse(elements: readonly SceneElement[], node: SceneNode) {
  const hiddenIds = new Set(descendants(node).map((item) => item.id));
  return elements.filter((element) => {
    if (!live(element)) return false;
    if (hiddenIds.has(element.id)) return true;
    if (element.type === "text" && !!element.containerId && hiddenIds.has(element.containerId)) return true;
    const data = mindmapDataOf(element.customData);
    return data?.role === "edge" && hiddenIds.has(data.child);
  });
}

// 畳めるのは、子がある節で、隠す中にロックした要素が無いとき（ロックした要素は隠さない。一部だけ隠すと親子が切れるので、全体を畳まない）。
function collapsible(node: SceneNode, hidden: readonly SceneElement[]) {
  return !node.data.collapsed && node.children.length > 0 && !hidden.some((element) => element.locked);
}

// 子孫を白板から外して、この節に預ける。子孫の中で畳んであった節の預かり分も、この節にまとめる（入れ子にしない：JSON を深くしない）。
export function collapseMindmapNode(elements: readonly SceneElement[], nodeId: string): MindmapChange {
  const change = emptyChange();
  const found = findMindmapNode(elements, nodeId);
  if (!found) return change;
  const hidden = hiddenByCollapse(elements, found.node);
  if (!collapsible(found.node, hidden)) return change;
  const stash: StashedElement[] = [];
  for (const element of hidden) {
    const data = mindmapDataOf(element.customData);
    let copy: StashedElement = { ...(element as StashedElement) };
    // 入れ子の預かり分を外に出す（畳んだ印は残す）。
    if (data?.role === "node" && data.stash?.length) {
      for (const item of data.stash) stash.push(item);
      const { stash: _nested, ...rest } = data;
      void _nested;
      copy = { ...copy, customData: withMark(element, rest) };
    }
    stash.push(copy);
    patch(change, element.id, { isDeleted: true });
  }
  patch(change, found.node.id, { customData: withMark(found.node.element, { ...found.node.data, collapsed: true, stash }) });
  return change;
}

// 預けた子孫を白板に戻す。まだ畳んである子孫の下の分は、その節に預け直す。
export function expandMindmapNode(elements: readonly SceneElement[], nodeId: string): MindmapChange {
  const change = emptyChange();
  const found = findMindmapNode(elements, nodeId);
  if (!found || !found.node.data.collapsed) return change;
  const stash = found.node.data.stash ?? [];
  // 預かり分の節の親と、畳んであるかを調べる。
  const marks = new Map<string, MindmapNodeData>();
  for (const element of stash) {
    const data = mindmapDataOf(element.customData);
    if (data?.role === "node") marks.set(element.id, data);
  }
  // その節を隠している、いちばん近い畳んだ祖先（この節より下）。無ければ null（戻す）。
  const holderOf = (id: string): string | null => {
    let cursor = marks.get(id)?.parent ?? null;
    let holder: string | null = null;
    const seen = new Set<string>();
    while (cursor && cursor !== nodeId && marks.has(cursor) && !seen.has(cursor)) {
      seen.add(cursor);
      if (marks.get(cursor)!.collapsed) holder = cursor;
      cursor = marks.get(cursor)!.parent;
    }
    return holder;
  };
  const restashed = new Map<string, StashedElement[]>();
  const restored: StashedElement[] = [];
  for (const element of stash) {
    const data = mindmapDataOf(element.customData);
    const owner = data?.role === "node" ? element.id
      : data?.role === "edge" ? data.child
        : element.type === "text" && typeof element.containerId === "string" ? element.containerId : null;
    const holder = owner ? holderOf(owner) : null;
    if (holder) {
      if (!restashed.has(holder)) restashed.set(holder, []);
      restashed.get(holder)!.push(element);
    } else {
      restored.push({ ...element, isDeleted: false });
    }
  }
  // まだ畳んである子孫に、その下の分を預け直す。
  change.restored = restored.map((element) => {
    const items = restashed.get(element.id);
    if (!items) return element;
    const data = mindmapDataOf(element.customData) as MindmapNodeData;
    return { ...element, customData: withMark(element as SceneElement, { ...data, collapsed: true, stash: items }) };
  });
  const { collapsed: _collapsed, stash: _stash, ...rest } = found.node.data;
  void _collapsed; void _stash;
  patch(change, found.node.id, { customData: withMark(found.node.element, rest) });
  return change;
}

// ---- 向き ----

export function setMindmapDirection(elements: readonly SceneElement[], nodeId: string, direction: MindmapDirection): MindmapChange {
  const change = emptyChange();
  const found = findMindmapNode(elements, nodeId);
  if (!found) return change;
  const root = found.tree.root;
  if ((root.data.direction ?? "right") === direction) return change;
  patch(change, root.id, { customData: withMark(root.element, { ...root.data, direction }) });
  return change;
}

// ---- 複製 ----

// 複製（Ctrl+D・コピー & 貼り付け・Alt ドラッグ）した要素の印を付け直す。prev → next は元の要素と複製の対応。
// 親も一緒に複製した節は新しい親に付け、親を複製しなかった節は新しい木の根になる。両端を複製した線だけが線として残る。
// 畳んで預けた子孫は、元の ID のまま 2 つの場所に入らないよう、複製では捨てる（複製は見えている分だけ）。
export function remapMindmapDuplicates(pairs: readonly { from: SceneElement; to: SceneElement }[]): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  const idMap = new Map(pairs.map(({ from, to }) => [from.id, to.id]));
  const nodeData = new Map<string, MindmapNodeData>();
  for (const { from } of pairs) {
    const data = mindmapDataOf(from.customData);
    if (data?.role === "node") nodeData.set(from.id, data);
  }
  // 複製の中での根（親を複製しなかった節）を、子孫に伝える。
  const roots = new Map<string, string>();
  const rootOf = (id: string): string => {
    let cursor = id;
    const path = new Set<string>();
    while (!roots.has(cursor) && !path.has(cursor)) {
      path.add(cursor);
      const parent = nodeData.get(cursor)?.parent;
      if (!parent || !nodeData.has(parent)) break;
      cursor = parent;
    }
    const root = roots.get(cursor) ?? cursor;
    for (const item of path) roots.set(item, root);
    return root;
  };
  for (const { from, to } of pairs) {
    const data = mindmapDataOf(from.customData);
    if (!data) continue;
    if (data.role === "node") {
      const root = rootOf(from.id);
      const parentCopied = data.parent !== null && nodeData.has(data.parent);
      const next: MindmapNodeData = {
        v: 1, role: "node", tree: idMap.get(root)!, parent: parentCopied ? idMap.get(data.parent!)! : null, order: parentCopied ? data.order : 0,
        ...(parentCopied ? {} : { direction: data.direction ?? "right" }),
      };
      result.set(to.id, { customData: withMark(to, next) });
    } else {
      const copied = nodeData.has(data.parent) && nodeData.has(data.child);
      result.set(to.id, {
        customData: withMark(to, copied ? { v: 1, role: "edge", tree: idMap.get(rootOf(data.child))!, parent: idMap.get(data.parent)!, child: idMap.get(data.child)! } : null),
      });
    }
  }
  return result;
}

// Excalidraw の onDuplicate に返す並び。Excalidraw は返した並びから次の場面を作る（返さなかった要素は消える）ので、
// 複製していない要素も含めて nextElements の全部を返し、思考マップの複製だけ印を付け直す。複製に思考マップが無ければ null。
export function remapMindmapDuplicateScene<T extends { id: string }>(
  nextElements: readonly T[], pairs: readonly { from: SceneElement; to: SceneElement }[],
): T[] | null {
  if (!pairs.some(({ from }) => mindmapDataOf(from.customData))) return null;
  const patches = remapMindmapDuplicates(pairs);
  return nextElements.map((element) => {
    const values = patches.get(element.id);
    return values ? { ...element, ...values } : element;
  });
}

// ---- 選択 ----

export type MindmapSelection = {
  nodeId: string;
  rootId: string;
  isRoot: boolean;
  hasChildren: boolean;
  // 畳める（子があり、隠す中にロックした要素が無い）。
  canCollapse: boolean;
  collapsed: boolean;
  direction: MindmapDirection;
  // 節の場所（場面の座標）。浮かぶボタンを置くのに使う。
  box: { x: number; y: number; width: number; height: number };
  side: "root" | "right" | "left";
};

// ちょうど 1 つの節（または節の文字）を選んでいるときの、その節の様子。
export function mindmapSelection(elements: readonly SceneElement[], selectedIds: readonly string[]): MindmapSelection | null {
  const find = mindmapFinder(elements);
  const nodeIds = new Set<string>();
  for (const id of selectedIds) {
    const found = find(id);
    if (!found) return null;
    nodeIds.add(found.node.id);
  }
  if (nodeIds.size !== 1) return null;
  const { node, tree } = find([...nodeIds][0])!;
  const rootCenter = tree.root.element.x + tree.root.element.width / 2;
  const center = node.element.x + node.element.width / 2;
  return {
    nodeId: node.id, rootId: tree.root.id, isRoot: !node.parent,
    hasChildren: node.children.length > 0 || !!node.data.stash?.length, canCollapse: collapsible(node, hiddenByCollapse(elements, node)),
    collapsed: !!node.data.collapsed, direction: tree.direction,
    box: { x: node.element.x, y: node.element.y, width: node.element.width, height: node.element.height },
    side: !node.parent ? "root" : center < rootCenter ? "left" : "right",
  };
}

// 一緒に置き直す木の根（変更で触れた節の木）。
export function mindmapRootsOf(elements: readonly SceneElement[], ids: Iterable<string>) {
  const find = mindmapFinder(elements);
  const roots = new Set<string>();
  for (const id of ids) {
    const found = find(id);
    if (found) roots.add(found.tree.root.id);
  }
  return roots;
}

// ---- 線の結び付き ----

// 線の両端の節が、その線を boundElements に持つようにする（節を動かすと線が付いてくる）。
// エディターで足した線・畳みから戻した線は、節の側の記録が無い（線の結び付きは置き直しが付ける）。
export function bindMindmapEdges(elements: readonly SceneElement[], change: MindmapChange = emptyChange()): MindmapChange {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const missing = new Map<string, string[]>();
  const boundIds = new Map<string, Set<string>>();
  const isBound = (node: SceneElement, id: string) => {
    let set = boundIds.get(node.id);
    if (!set) boundIds.set(node.id, set = new Set(node.boundElements?.map((item) => item.id)));
    return set.has(id);
  };
  for (const { element, data } of edgesOf(elements)) {
    for (const end of [data.parent, data.child]) {
      const node = byId.get(end);
      if (!node || !live(node) || isBound(node, element.id)) continue;
      if (!missing.has(end)) missing.set(end, []);
      missing.get(end)!.push(element.id);
    }
  }
  for (const [id, arrows] of missing) {
    const node = byId.get(id)!;
    patch(change, id, { boundElements: [...(node.boundElements ?? []), ...arrows.map((arrow) => ({ id: arrow, type: "arrow" }))] });
  }
  return change;
}

// ---- 差分を場面に当てる ----

// 要素を並びに入れる。同じ ID があれば置き換え（畳んだときに消した要素）、思考マップの線は親の節の前（節の下に描く）、それ以外は最後。
export function insertMindmapElements<T extends { id: string; customData?: unknown }>(list: readonly T[], items: readonly T[]): T[] {
  if (!items.length) return [...list];
  // 途中への差し込みが何千もあっても止まらないよう、前後をつないだ並びにする。
  type Link = { element: T; prev: Link | null; next: Link | null };
  const ends: { head: Link | null; tail: Link | null } = { head: null, tail: null };
  const byId = new Map<string, Link>();
  const insert = (element: T, before: Link | undefined) => {
    const prev = before ? before.prev : ends.tail;
    const link: Link = { element, prev, next: before ?? null };
    if (prev) prev.next = link;
    else ends.head = link;
    if (before) before.prev = link;
    else ends.tail = link;
    byId.set(element.id, link);
  };
  for (const element of list) insert(element, undefined);
  for (const item of items) {
    const existing = byId.get(item.id);
    if (existing) { existing.element = item; continue; }
    const data = mindmapDataOf(item.customData);
    insert(item, data?.role === "edge" ? byId.get(data.parent) : undefined);
  }
  const out: T[] = [];
  for (let link = ends.head; link; link = link.next) out.push(link.element);
  return out;
}

// 要素を作る・変える手段（エディターは Excalidraw の convertToExcalidrawElements と newElementWith）。
export type MindmapSceneTools<T> = {
  // force は値が同じでも版（version）を上げる。
  update: (element: T, values: Record<string, unknown>, force?: boolean) => T;
  create: (skeletons: readonly MindmapSkeleton[]) => T[];
};

// 差分を要素の並び（消した要素を含む）に当て、触れた木と extraRoots の木を置き直し、線を結び付ける。何もすることが無ければ null。
// changed は要素が変わったか。
export function composeMindmapScene<T extends SceneElement>(
  before: readonly T[], change: MindmapChange, extraRoots: Iterable<string>, { update, create }: MindmapSceneTools<T>,
): { elements: T[]; changed: boolean } | null {
  const touched = [...change.patches.keys(), ...change.added.map((item) => item.id), ...change.restored.map((item) => item.id)];
  const requested = [...extraRoots];
  if (!touched.length && !requested.length) return null;
  const patchAll = (elements: T[], patches: MindmapChange["patches"]) => patches.size
    ? elements.map((element) => {
      const values = patches.get(element.id);
      return values ? update(element, values) : element;
    })
    : elements;
  let next = patchAll([...before], change.patches);
  // 畳みから戻す要素は、畳んだときに消した写し（同じ ID）より新しい版にする（取り消しの記録は版が上がった要素だけを変化と見る）。
  // 白板に置ける種類の要素だけを戻す（預かり分は持ち主の本体の中にあるが、保存の検証は通っていない）。
  const current = new Map(next.map((element) => [element.id, element]));
  next = insertMindmapElements(next, change.restored.filter((item) => WHITEBOARD_ELEMENT_TYPES.has(item.type)).map((item) => {
    const version = Math.max(typeof item.version === "number" ? item.version : 1, Number(current.get(item.id)?.version ?? 0));
    return update({ ...item, version } as unknown as T, { isDeleted: false }, true);
  }));
  next = insertMindmapElements(next, create(change.added));
  let changed = touched.length > 0;
  const roots = new Set([...requested, ...mindmapRootsOf(before, touched), ...mindmapRootsOf(next, touched)]);
  const layout = relayoutMindmaps(next, roots);
  if (layout.patches.size || layout.added.length) changed = true;
  next = insertMindmapElements(patchAll(next, layout.patches), create(layout.added));
  // 置き直しが足した線は、まだ両端の節に結び付いていない（下書きからの変換では、場面にある図形に結び付けられない）。
  // もう 1 回置き直して結び付ける（そうしないと、直後に節を動かすと線が残る）。
  if (layout.added.length) next = patchAll(next, relayoutMindmaps(next, roots).patches);
  const bindings = bindMindmapEdges(next).patches;
  if (bindings.size) changed = true;
  return { elements: patchAll(next, bindings), changed };
}

// ---- ドラッグで親を替える ----

// ドラッグを終えた節の中心の下にある、別の節（自分と子孫は除く。重なっていれば小さい方）。無ければ null。
export function mindmapDropTarget(elements: readonly SceneElement[], nodeId: string): string | null {
  const trees = readMindmapTrees(elements);
  const found = findMindmapNode(elements, nodeId, trees);
  if (!found) return null;
  const { element } = found.node;
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const excluded = new Set([found.node.id, ...descendants(found.node).map((node) => node.id)]);
  let best: { id: string; area: number } | null = null;
  for (const tree of trees.values()) {
    for (const node of tree.nodes.values()) {
      if (excluded.has(node.id)) continue;
      const box = node.element;
      if (cx < box.x || cx > box.x + box.width || cy < box.y || cy > box.y + box.height) continue;
      const area = box.width * box.height;
      if (!best || area < best.area) best = { id: node.id, area };
    }
  }
  return best?.id ?? null;
}

// ---- 畳んである節 ----

export type CollapsedMindmapNode = {
  nodeId: string;
  box: { x: number; y: number; width: number; height: number };
  side: "root" | "right" | "left";
  // 畳んで隠している節の数。
  hidden: number;
};

// 畳んである節（白板の上に「+N」の印を出して、押すと広げる）。
export function collapsedMindmapNodes(elements: readonly SceneElement[]): CollapsedMindmapNode[] {
  const out: CollapsedMindmapNode[] = [];
  for (const tree of readMindmapTrees(elements).values()) {
    const rootCenter = tree.root.element.x + tree.root.element.width / 2;
    for (const node of tree.nodes.values()) {
      if (!node.data.collapsed) continue;
      const hidden = (node.data.stash ?? []).filter((element) => mindmapDataOf(element.customData)?.role === "node").length;
      if (!hidden) continue;
      const { x, y, width, height } = node.element;
      out.push({ nodeId: node.id, box: { x, y, width, height }, side: !node.parent ? "root" : x + width / 2 < rootCenter ? "left" : "right", hidden });
    }
  }
  return out;
}
