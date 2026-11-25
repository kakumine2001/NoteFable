import { layoutMindmap, type MindmapLayout, type PlacedMindmapNode } from "@/lib/whiteboard/mindmap/layout";
import { MINDMAP_DATA_KEY, type MindmapDirection, type MindmapEdgeData, type MindmapNodeData, type MindmapTreeNode } from "@/lib/whiteboard/mindmap/model";

// 配置した思考マップを、Excalidraw の要素の下書き（convertToExcalidrawElements に渡す skeleton）にする。
// 節は角丸の四角に文字を付けたもの、親子は矢じりのない矢印（両端を節に結び付けるので、節を動かすと線も付いてくる）。
// 下書きを本物の要素にするのは呼び出し側：サーバーは @excalidraw/element（diagram.ts）、エディターは @excalidraw/excalidraw。
// どちらも同じ ID を使う（regenerateIds: false）。customData の親子の印が図形の ID を指すため。

// Excalidraw の字体の番号（FONT_FAMILY.Nunito）。白板の「整洁」な既定と同じ字体にする。
export const NUNITO_FONT_FAMILY = 6;

// 枝の色（線・塗り）。Excalidraw の色見本から、明るい背景でも暗い表示（色を反転）でも読める組み合わせ。
const BRANCH_COLORS: readonly { stroke: string; fill: string }[] = [
  { stroke: "#1971c2", fill: "#d0ebff" },
  { stroke: "#2f9e44", fill: "#d3f9d8" },
  { stroke: "#e8590c", fill: "#ffe8cc" },
  { stroke: "#9c36b5", fill: "#f3d9fa" },
  { stroke: "#0c8599", fill: "#c5f6fa" },
  { stroke: "#c2255c", fill: "#ffdeeb" },
  { stroke: "#e67700", fill: "#fff3bf" },
  { stroke: "#6741d9", fill: "#e5dbff" },
];
const ROOT_COLORS = { stroke: "#1e1e1e", fill: "#f1f3f5" };
const TEXT_COLOR = "#1e1e1e";

export type MindmapSkeleton = Record<string, unknown> & { id: string; type: string };

const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// Excalidraw の要素と同じくらいの長さの、推測されにくい ID。
export function randomElementId() {
  const bytes = new Uint8Array(20);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("");
}

export function branchColors(branch: number) {
  return branch < 0 ? ROOT_COLORS : BRANCH_COLORS[branch % BRANCH_COLORS.length];
}

export function nodeSkeleton(node: Pick<PlacedMindmapNode, "x" | "y" | "width" | "height" | "depth" | "branch" | "text" | "fontSize">, id: string, data: MindmapNodeData, origin: { x: number; y: number }): MindmapSkeleton {
  const colors = branchColors(node.branch);
  return {
    id,
    type: "rectangle",
    x: origin.x + node.x,
    y: origin.y + node.y,
    width: node.width,
    height: node.height,
    strokeColor: colors.stroke,
    // 根と最初の枝は塗り、それより深い節は枠だけ（階層が見分けやすい）。
    backgroundColor: node.depth <= 1 ? colors.fill : "transparent",
    fillStyle: "solid",
    strokeWidth: node.depth <= 1 ? 2 : 1,
    roughness: 0,
    roundness: { type: 3 },
    customData: { [MINDMAP_DATA_KEY]: data },
    label: {
      text: node.text,
      fontSize: node.fontSize,
      fontFamily: NUNITO_FONT_FAMILY,
      textAlign: "center",
      verticalAlign: "middle",
      strokeColor: TEXT_COLOR,
    },
  };
}

type Box = { x: number; y: number; width: number; height: number };

// 線と節のすき間（Excalidraw が結び付いた矢印の端を図形から離す幅）。
export const EDGE_GAP = 6;

// 親の外側の辺の中央から、子の内側の辺の中央へ。中間点を子の高さに置いて、斜めに出て横から入るなめらかな曲線にする
// （中間点を 2 つにして横に出すと、Excalidraw の曲線が出口で行き過ぎて小さな輪ができる）。
// 置き直し（relayout.ts）も同じ形を使う。right は子が親の右にあるか。
export function edgeGeometry(parent: Box, child: Box, right: boolean) {
  const startX = right ? parent.x + parent.width + EDGE_GAP : parent.x - EDGE_GAP;
  const startY = parent.y + parent.height / 2;
  const endX = right ? child.x - EDGE_GAP : child.x + child.width + EDGE_GAP;
  const endY = child.y + child.height / 2;
  const dx = endX - startX;
  const dy = endY - startY;
  const points: [number, number][] = Math.abs(dy) < 1 ? [[0, 0], [dx, dy]] : [[0, 0], [dx * 0.5, dy], [dx, dy]];
  return {
    x: startX, y: startY, points, width: Math.abs(dx), height: Math.abs(dy),
    // 結び付きの位置（図形の幅・高さに対する割合）。右の子は親の右の辺から出て子の左の辺に入る。
    startFixedPoint: (right ? [1, 0.5001] : [0, 0.5001]) as [number, number],
    endFixedPoint: (right ? [0, 0.5001] : [1, 0.5001]) as [number, number],
  };
}

function edgeSkeleton(parent: PlacedMindmapNode, child: PlacedMindmapNode, ids: { edge: string; parent: string; child: string }, tree: string, origin: { x: number; y: number }): MindmapSkeleton {
  const shift = (box: Box) => ({ ...box, x: origin.x + box.x, y: origin.y + box.y });
  const geometry = edgeGeometry(shift(parent), shift(child), child.side !== "left");
  const data: MindmapEdgeData = { v: 1, role: "edge", tree, parent: ids.parent, child: ids.child };
  return edgeElementSkeleton(ids.edge, geometry, { parent: ids.parent, child: ids.child }, branchColors(child.branch).stroke, child.depth, data);
}

// 線の下書き（新しく足す節の線にも使う）。
export function edgeElementSkeleton(id: string, geometry: ReturnType<typeof edgeGeometry>, ends: { parent: string; child: string }, stroke: string, childDepth: number, data: MindmapEdgeData): MindmapSkeleton {
  return {
    id,
    type: "arrow",
    x: geometry.x,
    y: geometry.y,
    points: geometry.points,
    strokeColor: stroke,
    strokeWidth: childDepth <= 1 ? 2 : 1,
    roughness: 0,
    roundness: { type: 2 },
    startArrowhead: null,
    endArrowhead: null,
    start: { id: ends.parent },
    end: { id: ends.child },
    customData: { [MINDMAP_DATA_KEY]: data },
  };
}

// 木から、白板に置く要素の下書きを作る。origin は思考マップの左上の位置。
// 並びは線のあとに前順の節（線が節の下に描かれるよう、先に線を置く）。
export function mindmapSkeletons(root: MindmapTreeNode, { direction, origin = { x: 0, y: 0 }, newId = randomElementId }: {
  direction: MindmapDirection;
  origin?: { x: number; y: number };
  newId?: () => string;
}): { skeletons: MindmapSkeleton[]; layout: MindmapLayout; rootId: string } {
  const layout = layoutMindmap(root, direction);
  const nodeIds = layout.nodes.map(() => newId());
  const rootId = nodeIds[0];
  const nodes = layout.nodes.map((node) => nodeSkeleton(node, nodeIds[node.index], {
    v: 1,
    role: "node",
    tree: rootId,
    parent: node.parent === null ? null : nodeIds[node.parent],
    order: node.order,
    ...(node.parent === null ? { direction } : {}),
  }, origin));
  const edges = layout.nodes.filter((node) => node.parent !== null).map((node) => edgeSkeleton(
    layout.nodes[node.parent!], node, { edge: newId(), parent: nodeIds[node.parent!], child: nodeIds[node.index] }, rootId, origin,
  ));
  return { skeletons: [...edges, ...nodes], layout, rootId };
}
