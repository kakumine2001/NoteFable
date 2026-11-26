import { mindmapSkeletons, NUNITO_FONT_FAMILY, randomElementId, type MindmapSkeleton } from "@/lib/whiteboard/mindmap/elements";

// 白板の学習用テンプレート（康奈尔笔记・年表・ベン図・比較表・思考マップ）。Excalidraw を読み込まない純粋な関数で、要素の下書き
// （convertToExcalidrawElements に regenerateIds: false で渡す）を作る。文字はエディターが翻訳して渡す（17 か国語）。
// 思考マップ以外は枠（frame）に入れて、ひとまとまりで動かせるようにする。色は思考マップと同じ Excalidraw の色見本、線の揺れなし・Nunito。

export const WHITEBOARD_TEMPLATES = ["mindmap", "cornell", "timeline", "venn", "comparison"] as const;
export type WhiteboardTemplate = (typeof WHITEBOARD_TEMPLATES)[number];

export type TemplateLabels = {
  // 枠の名前（テンプレートの名前）。
  title: string;
  mindmap: { central: string; idea: (n: number) => string };
  cornell: { header: string; cues: string; notes: string; summary: string };
  timeline: { event: (n: number) => string; date: string };
  venn: { left: string; right: string; both: string };
  comparison: { aspect: string; optionA: string; optionB: string; point: (n: number) => string };
};

const TEXT = "#1e1e1e";
const MUTED = "#868e96";
const LINE = "#ced4da";

// 図形に付かない中央ぞろえの文字（年表・ベン図）の下書きは、x が文字の中心（Excalidraw の変換がそう読み、width は測り直す）。
// ここでの width は外接矩形の見積もりにだけ使う（skeletonBounds）。
const base = { roughness: 0, strokeWidth: 1, fillStyle: "solid" as const, strokeColor: LINE, backgroundColor: "transparent" };

function box(id: string, x: number, y: number, width: number, height: number, text: string, options: { fill?: string; align?: "left" | "center"; valign?: "top" | "middle"; fontSize?: number; color?: string } = {}): MindmapSkeleton {
  return {
    ...base,
    id, type: "rectangle", x, y, width, height,
    backgroundColor: options.fill ?? "transparent",
    roundness: null,
    label: {
      text, fontSize: options.fontSize ?? 20, fontFamily: NUNITO_FONT_FAMILY,
      textAlign: options.align ?? "left", verticalAlign: options.valign ?? "top", strokeColor: options.color ?? MUTED,
    },
  };
}

function frame(id: string, name: string, children: MindmapSkeleton[], padding = 40): MindmapSkeleton {
  const bounds = skeletonBounds(children);
  return {
    id, type: "frame", name, children: children.map((child) => child.id),
    x: bounds.x - padding, y: bounds.y - padding, width: bounds.width + 2 * padding, height: bounds.height + 2 * padding,
  };
}

function cornell(labels: TemplateLabels, newId: () => string): MindmapSkeleton[] {
  const parts = [
    box(newId(), 0, 0, 900, 100, labels.cornell.header, { fill: "#f1f3f5", valign: "middle", fontSize: 24, color: TEXT }),
    box(newId(), 0, 100, 260, 760, labels.cornell.cues),
    box(newId(), 260, 100, 640, 760, labels.cornell.notes),
    box(newId(), 0, 860, 900, 200, labels.cornell.summary, { fill: "#f8f9fa" }),
  ];
  return [frame(newId(), labels.title, parts), ...parts];
}

function timeline(labels: TemplateLabels, newId: () => string): MindmapSkeleton[] {
  const parts: MindmapSkeleton[] = [{
    ...base, id: newId(), type: "arrow", x: 0, y: 120, points: [[0, 0], [1100, 0]], strokeColor: TEXT, strokeWidth: 2,
    startArrowhead: null, endArrowhead: "arrow",
  }];
  const colors = ["#1971c2", "#2f9e44", "#e8590c", "#9c36b5"];
  for (let index = 0; index < 4; index++) {
    const x = 120 + index * 260;
    parts.push(
      { ...base, id: newId(), type: "ellipse", x: x - 12, y: 108, width: 24, height: 24, strokeColor: colors[index], backgroundColor: colors[index] },
      { id: newId(), type: "text", x, y: 40, width: 200, text: labels.timeline.event(index + 1), fontSize: 20, fontFamily: NUNITO_FONT_FAMILY, textAlign: "center", strokeColor: TEXT, roughness: 0 },
      { id: newId(), type: "text", x, y: 150, width: 200, text: labels.timeline.date, fontSize: 16, fontFamily: NUNITO_FONT_FAMILY, textAlign: "center", strokeColor: MUTED, roughness: 0 },
    );
  }
  return [frame(newId(), labels.title, parts), ...parts];
}

function venn(labels: TemplateLabels, newId: () => string): MindmapSkeleton[] {
  const parts: MindmapSkeleton[] = [
    { ...base, id: newId(), type: "ellipse", x: 0, y: 0, width: 440, height: 440, strokeColor: "#1971c2", backgroundColor: "#a5d8ff", opacity: 50 },
    { ...base, id: newId(), type: "ellipse", x: 280, y: 0, width: 440, height: 440, strokeColor: "#2f9e44", backgroundColor: "#b2f2bb", opacity: 50 },
    { id: newId(), type: "text", x: 150, y: 200, width: 180, text: labels.venn.left, fontSize: 24, fontFamily: NUNITO_FONT_FAMILY, textAlign: "center", strokeColor: TEXT, roughness: 0 },
    { id: newId(), type: "text", x: 570, y: 200, width: 180, text: labels.venn.right, fontSize: 24, fontFamily: NUNITO_FONT_FAMILY, textAlign: "center", strokeColor: TEXT, roughness: 0 },
    { id: newId(), type: "text", x: 360, y: 205, width: 140, text: labels.venn.both, fontSize: 20, fontFamily: NUNITO_FONT_FAMILY, textAlign: "center", strokeColor: TEXT, roughness: 0 },
  ];
  return [frame(newId(), labels.title, parts), ...parts];
}

function comparison(labels: TemplateLabels, newId: () => string): MindmapSkeleton[] {
  const columns = [260, 320, 320];
  const header = [labels.comparison.aspect, labels.comparison.optionA, labels.comparison.optionB];
  const parts: MindmapSkeleton[] = [];
  let x = 0;
  columns.forEach((width, column) => {
    for (let row = 0; row < 4; row++) {
      const text = row === 0 ? header[column] : column === 0 ? labels.comparison.point(row) : "";
      parts.push(box(newId(), x, row * 90, width, 90, text, {
        fill: row === 0 ? "#f1f3f5" : "transparent", valign: "middle",
        color: row === 0 ? TEXT : MUTED, fontSize: row === 0 ? 22 : 18,
      }));
    }
    x += width;
  });
  return [frame(newId(), labels.title, parts), ...parts];
}

function mindmap(labels: TemplateLabels, newId: () => string): MindmapSkeleton[] {
  const root = { text: labels.mindmap.central, children: [1, 2, 3].map((n) => ({ text: labels.mindmap.idea(n), children: [] })) };
  return mindmapSkeletons(root, { direction: "right", newId }).skeletons;
}

// テンプレートの下書き。左上が (0, 0) 付近になる（エディターが画面の中央へ動かす）。
export function templateSkeletons(template: WhiteboardTemplate, labels: TemplateLabels, newId: () => string = randomElementId): MindmapSkeleton[] {
  switch (template) {
    case "mindmap": return mindmap(labels, newId);
    case "cornell": return cornell(labels, newId);
    case "timeline": return timeline(labels, newId);
    case "venn": return venn(labels, newId);
    case "comparison": return comparison(labels, newId);
  }
}

// 下書きの外接矩形（画面の中央に置くため）。
export function skeletonBounds(skeletons: readonly MindmapSkeleton[]) {
  const boxes = skeletons.map((item) => {
    const centred = item.type === "text" && item.textAlign === "center";
    const x = (item.x as number) - (centred ? (item.width as number) / 2 : 0);
    const y = item.y as number;
    const points = Array.isArray(item.points) ? item.points as [number, number][] : null;
    const width = points ? Math.max(...points.map((point) => point[0])) : (item.width as number | undefined) ?? 0;
    const height = points ? Math.max(...points.map((point) => point[1])) : (item.height as number | undefined) ?? 0;
    return { x, y, right: x + width, bottom: y + height };
  });
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  return { x: minX, y: minY, width: Math.max(...boxes.map((b) => b.right)) - minX, height: Math.max(...boxes.map((b) => b.bottom)) - minY };
}

// 下書きを (dx, dy) だけ動かす（線の点は相対なのでそのまま）。
export function moveSkeletons(skeletons: readonly MindmapSkeleton[], dx: number, dy: number): MindmapSkeleton[] {
  return skeletons.map((item) => ({ ...item, x: (item.x as number) + dx, y: (item.y as number) + dy }));
}
