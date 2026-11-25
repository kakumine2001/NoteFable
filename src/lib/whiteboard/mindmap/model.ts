// 思考マップ（マインドマップ）の木。AI の「図にする」（diagram.ts）と、今後の手で描く思考マップ・学習テンプレートが同じ木と配置を使う
// （docs/architecture/whiteboard.md の「思考マップ」）。このディレクトリーは Excalidraw を読み込まない純粋な TS（サーバー・ブラウザー・テスト共通）。

// 木の節。text は表示する文字（改行を含んでよい）。
// key は白板の上の節の図形の ID（白板から読んだ木だけが持つ）。size は図形のいまの大きさ（あれば文字から見積もらずにそれで並べる。
// 利用者が文字を編集すると Excalidraw が図形の高さを変えるため）。
export type MindmapTreeNode = { text: string; children: MindmapTreeNode[]; key?: string; size?: { width: number; height: number } };

// 枝の向き。right は根から右へ、both は根の左右に振り分ける。
export type MindmapDirection = "right" | "both";
export const MINDMAP_DIRECTIONS: readonly MindmapDirection[] = ["right", "both"];

// 白板の要素の customData に置く印のキー。節の図形と、親子をつなぐ線の両方に付ける。
// 公開リンクの見る画面では customData を落とす（public.ts）ので、この印は持ち主の白板にだけ残る。
export const MINDMAP_DATA_KEY = "notefableMindmap";

// 節の図形の印。tree は根の図形の ID、parent は親の節の図形の ID（根は null）、order は兄弟の中の順番。
// direction は根だけが持つ（木全体の枝の向き）。collapsed は子を畳んでいる節。
// 畳んだ子孫の要素（節・節の文字・線）は白板から外し、消さずに stash に入れて持つ（広げると同じ ID で戻す）。
// 白板に無いので、編集・書き出し・公開リンク・小さな地図のどこにも出ない（公開リンクは customData ごと落とす）。
export type MindmapNodeData = {
  v: 1;
  role: "node";
  tree: string;
  parent: string | null;
  order: number;
  direction?: MindmapDirection;
  collapsed?: true;
  stash?: StashedElement[];
};

// 畳んで外した要素（白板の要素そのまま）。
export type StashedElement = { id: string; type: string; [key: string]: unknown };

// 親子をつなぐ線の印。parent・child は両端の節の図形の ID。
export type MindmapEdgeData = { v: 1; role: "edge"; tree: string; parent: string; child: string };

export type MindmapData = MindmapNodeData | MindmapEdgeData;

// AI が作る木の上限（読みやすさと白板の大きさのため）。超えた分は落として、落としたことを呼び出し側に知らせる。
export const MAX_MINDMAP_NODES = 400;
export const MAX_MINDMAP_DEPTH = 10;
export const MAX_MINDMAP_TEXT = 200;

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const elementId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 120;

// 要素の customData から思考マップの印を読む。形が合わなければ null（壊れた印は普通の図形として扱う）。
export function mindmapDataOf(customData: unknown): MindmapData | null {
  if (!object(customData)) return null;
  const data = customData[MINDMAP_DATA_KEY];
  if (!object(data) || data.v !== 1 || !elementId(data.tree)) return null;
  if (data.role === "edge") {
    return elementId(data.parent) && elementId(data.child) ? { v: 1, role: "edge", tree: data.tree, parent: data.parent, child: data.child } : null;
  }
  if (data.role !== "node") return null;
  if (!(data.parent === null || elementId(data.parent))) return null;
  if (typeof data.order !== "number" || !Number.isInteger(data.order) || data.order < 0) return null;
  const stash = data.collapsed === true && Array.isArray(data.stash)
    ? data.stash.filter((item): item is StashedElement => object(item) && elementId(item.id) && typeof item.type === "string")
    : [];
  return {
    v: 1, role: "node", tree: data.tree, parent: data.parent, order: data.order,
    ...(MINDMAP_DIRECTIONS.includes(data.direction as MindmapDirection) ? { direction: data.direction as MindmapDirection } : {}),
    ...(data.collapsed === true ? { collapsed: true as const } : {}),
    ...(stash.length ? { stash } : {}),
  };
}

// 節の数（根を含む）。
export function countMindmapNodes(root: MindmapTreeNode) {
  let count = 0;
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    count++;
    stack.push(...node.children);
  }
  return count;
}

// 上限（節の数・深さ・文字数）に収める。根から幅優先で数え、入りきらない節は子ごと落とす。trimmed は何かを落としたか。
export function limitMindmapTree(root: MindmapTreeNode, { maxNodes = MAX_MINDMAP_NODES, maxDepth = MAX_MINDMAP_DEPTH, maxText = MAX_MINDMAP_TEXT } = {}) {
  let trimmed = false;
  const clipText = (text: string) => {
    const chars = Array.from(text);
    if (chars.length <= maxText) return text;
    trimmed = true;
    return `${chars.slice(0, maxText - 1).join("")}…`;
  };
  const copy: MindmapTreeNode = { text: clipText(root.text), children: [] };
  let count = 1;
  const queue: { source: MindmapTreeNode; target: MindmapTreeNode; depth: number }[] = [{ source: root, target: copy, depth: 0 }];
  while (queue.length) {
    const { source, target, depth } = queue.shift()!;
    for (const child of source.children) {
      if (depth + 1 > maxDepth || count >= maxNodes) { trimmed = true; continue; }
      const next: MindmapTreeNode = { text: clipText(child.text), children: [] };
      target.children.push(next);
      count++;
      queue.push({ source: child, target: next, depth: depth + 1 });
    }
  }
  return { root: copy, trimmed };
}
