import { estimateTextWidth, wrapText } from "@/lib/whiteboard/text-measure";
import type { MindmapDirection, MindmapTreeNode } from "@/lib/whiteboard/mindmap/model";

// 思考マップの配置。同じ木からは、サーバーでもブラウザーでも同じ位置になる（文字の幅は計測せず text-measure.ts で見積もる）。
// 節は文字に合わせた角丸の四角。子は親の外側（右の枝は右、左の枝は左）に縦に並べ、親は子の並びの縦の中央に置く。
// both では根の子を、上から順に、左右の高さがなるべくそろうところで右（前半）と左（後半）に分ける。

export type MindmapSide = "root" | "right" | "left";

export type PlacedMindmapNode = {
  // 木を前順（親 → 子）にたどった番号。0 が根。
  index: number;
  parent: number | null;
  // 兄弟の中の順番。
  order: number;
  depth: number;
  side: MindmapSide;
  // 根の何番目の子の枝か（色分けに使う）。根は -1。
  branch: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  // 折り返した後の文字（改行を含む）。
  text: string;
  // 木の節の key（白板から読んだ木では節の図形の ID）。
  key?: string;
};

export type MindmapLayout = { nodes: PlacedMindmapNode[]; direction: MindmapDirection };

export const MINDMAP_FONT_SIZES = [28, 20, 17] as const;
const LINE_HEIGHT = 1.25;
const MAX_TEXT_WIDTH = [360, 280, 240] as const;
const PADDING_X = [28, 18, 14] as const;
const PADDING_Y = [18, 12, 9] as const;
const MIN_WIDTH = [120, 72, 56] as const;
// 親と子の横の間と、兄弟の縦の間。
const LEVEL_GAP = [96, 64, 48] as const;
const SIBLING_GAP = [28, 18, 12] as const;

const pick = <T,>(values: readonly T[], depth: number) => values[Math.min(depth, values.length - 1)];

// 深さごとの字の大きさ（新しく足す節の文字に使う）。
export function mindmapFontSize(depth: number) {
  return pick(MINDMAP_FONT_SIZES, depth);
}

type Box = { node: MindmapTreeNode; width: number; height: number; fontSize: number; text: string; children: Box[]; depth: number; subtree: number };

function measure(node: MindmapTreeNode, depth: number): Box {
  const fontSize = pick(MINDMAP_FONT_SIZES, depth);
  // 白板の上の節は、いまの大きさのまま並べる（文字は図形の中で Excalidraw が折り返している）。
  if (node.size) return { node, width: node.size.width, height: node.size.height, fontSize, text: node.text, children: [], depth, subtree: node.size.height };
  const lines = wrapText(node.text, fontSize, pick(MAX_TEXT_WIDTH, depth));
  const text = lines.join("\n");
  const width = Math.max(pick(MIN_WIDTH, depth), Math.ceil(estimateTextWidth(text, fontSize) + 2 * pick(PADDING_X, depth)));
  const height = Math.ceil(lines.length * fontSize * LINE_HEIGHT + 2 * pick(PADDING_Y, depth));
  return { node, width, height, fontSize, text, children: [], depth, subtree: height };
}

// 深い木でもスタックを使い切らないよう、再帰しないで大きさを測る。
function measureTree(root: MindmapTreeNode): Box {
  const rootBox = measure(root, 0);
  const order: Box[] = [];
  const stack = [rootBox];
  while (stack.length) {
    const box = stack.pop()!;
    order.push(box);
    box.children = box.node.children.map((child) => measure(child, box.depth + 1));
    stack.push(...box.children);
  }
  // 子から先に、部分木の高さ（子の並びの高さと自分の高さの大きい方）を決める。
  for (let index = order.length - 1; index >= 0; index--) {
    const box = order[index];
    if (!box.children.length) continue;
    const gap = pick(SIBLING_GAP, box.depth + 1);
    const stacked = box.children.reduce((sum, child) => sum + child.subtree, 0) + gap * (box.children.length - 1);
    box.subtree = Math.max(box.height, stacked);
  }
  return rootBox;
}

// both で右に置く根の子の数。上から足して、右の高さが全体の半分に最も近くなるところで切る（最低 1 つは右）。
function rightCount(children: Box[]) {
  if (children.length <= 1) return children.length;
  const total = children.reduce((sum, child) => sum + child.subtree, 0);
  let best = 1;
  let bestDiff = Infinity;
  let sum = 0;
  for (let count = 1; count < children.length; count++) {
    sum += children[count - 1].subtree;
    const diff = Math.abs(total / 2 - sum);
    if (diff < bestDiff) { bestDiff = diff; best = count; }
  }
  return best;
}

export function layoutMindmap(root: MindmapTreeNode, direction: MindmapDirection = "right"): MindmapLayout {
  const rootBox = measureTree(root);
  const nodes: PlacedMindmapNode[] = [];
  const place = (box: Box, x: number, y: number, parent: number | null, order: number, side: MindmapSide, branch: number) => {
    const index = nodes.length;
    nodes.push({
      index, parent, order, depth: box.depth, side, branch, x, y, width: box.width, height: box.height, fontSize: box.fontSize, text: box.text,
      ...(box.node.key === undefined ? {} : { key: box.node.key }),
    });
    return index;
  };
  // 子の並び（top から下へ）を、親の外側に置く。部分木の中央に子の箱を合わせる。
  const placeChildren = (children: Box[], parent: { index: number; x: number; width: number; centerY: number; depth: number }, side: "right" | "left", branchOf: (order: number) => number, firstOrder = 0) => {
    if (!children.length) return;
    const gap = pick(SIBLING_GAP, parent.depth + 1);
    const levelGap = pick(LEVEL_GAP, parent.depth);
    const stacked = children.reduce((sum, child) => sum + child.subtree, 0) + gap * (children.length - 1);
    let top = parent.centerY - stacked / 2;
    children.forEach((child, offset) => {
      const order = firstOrder + offset;
      const centerY = top + child.subtree / 2;
      const x = side === "right" ? parent.x + parent.width + levelGap : parent.x - levelGap - child.width;
      const y = centerY - child.height / 2;
      const branch = branchOf(order);
      const index = place(child, x, y, parent.index, order, side, branch);
      placeChildren(child.children, { index, x, width: child.width, centerY, depth: child.depth }, side, () => branch);
      top += child.subtree + gap;
    });
  };
  const rootIndex = place(rootBox, 0, 0, null, 0, "root", -1);
  const rootCenter = { index: rootIndex, x: 0, width: rootBox.width, centerY: rootBox.height / 2, depth: 0 };
  const split = direction === "both" ? rightCount(rootBox.children) : rootBox.children.length;
  placeChildren(rootBox.children.slice(0, split), rootCenter, "right", (order) => order);
  placeChildren(rootBox.children.slice(split), rootCenter, "left", (order) => order, split);
  // 左上が (0, 0) になるように動かす（白板に置くときの基準）。
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  for (const node of nodes) {
    node.x = Math.round((node.x - minX) * 100) / 100;
    node.y = Math.round((node.y - minY) * 100) / 100;
  }
  // 番号を前順に並べ直す（place は前順に呼ばれているので、そのまま）。
  return { nodes, direction };
}

// 根の子が多い木は左右に振り分けた方が見やすい（AI が作る思考マップの既定）。
export function defaultMindmapDirection(root: MindmapTreeNode): MindmapDirection {
  return root.children.length >= 4 ? "both" : "right";
}
