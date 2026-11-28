"use client";

import { CaptureUpdateAction, convertToExcalidrawElements, newElementWith, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { Blend, CircleMinus, GitBranchPlus, ListPlus, Milestone, Network, NotebookPen, Table2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useT } from "@/components/i18n-provider";
import { msg } from "@/lib/i18n/translate";
import { composeMindmapScene, findMindmapNode, type CollapsedMindmapNode, type MindmapChange, type MindmapSceneTools, type MindmapSelection, type SceneElement } from "@/lib/whiteboard/mindmap/editing";
import type { MindmapSkeleton } from "@/lib/whiteboard/mindmap/elements";
import { mindmapNodeBox } from "@/lib/whiteboard/mindmap/layout";
import { type TemplateLabels, type WhiteboardTemplate } from "@/lib/whiteboard/templates";

// 白板の思考マップのモード（docs/architecture/whiteboard.md の「思考マップのモード」）と学習テンプレートの画面。
// 木の操作そのもの（子・兄弟を足す、消す、親を替える、畳む・広げる、置き直す）は純粋な関数（src/lib/whiteboard/mindmap/editing.ts）。
// ここはその差分を Excalidraw の場面に 1 回の updateScene で当てる（1 回の操作 = 取り消し 1 回）のと、節の上に浮かべるボタン。

type SceneElements = ExcalidrawElement[];

// 下書きを要素にする。線の結び付きは置き直し（composeMindmapScene の中）と bindMindmapEdges が付ける：変換は同じ下書きの中の図形にしか
// 結び付けられない（足した節の親は場面にある）。
function materialize(skeletons: readonly MindmapSkeleton[]): SceneElements {
  if (!skeletons.length) return [];
  const stripped = skeletons.map((skeleton) => {
    const { start: _start, end: _end, ...rest } = skeleton;
    void _start; void _end;
    return rest;
  });
  return convertToExcalidrawElements(stripped as never, { regenerateIds: false }) as SceneElements;
}

const sceneTools: MindmapSceneTools<SceneElement> = {
  update: (element, values, force) => newElementWith(element as unknown as ExcalidrawElement, values as never, force) as unknown as SceneElement,
  create: (skeletons) => materialize(skeletons) as unknown as SceneElement[],
};

// 足した節を、文字の編集を終えたときと同じ大きさ（fitMindmapNodeToText）にする。違うと、何も打たずに編集を終えても大きさが変わり、
// 「足す」の取り消しが 1 回で済まなくなる。
function fitAddedNode(elements: SceneElement[], nodeId: string) {
  const found = findMindmapNode(elements, nodeId);
  if (!found) return elements;
  const patches = fitMindmapNodeToText(elements as unknown as ExcalidrawElement[], nodeId, found.node.depth);
  if (!patches.size) return elements;
  return composeMindmapScene(elements, { patches, added: [], restored: [] }, [found.tree.root.id], sceneTools)?.elements ?? elements;
}

// 思考マップの差分を場面に当て、触れた木を置き直し、線を結び付け直す。select があればその節を選ぶ。何も変わらなければ null。
// capture が false なら自分の取り消しの記録を作らず、Excalidraw がこれから作る記録（ドラッグ・大きさの変更・文字の編集）に含める。
export function applyMindmapChange(
  api: ExcalidrawImperativeAPI, change: MindmapChange, extraRoots: Iterable<string> = [], { capture = true }: { capture?: boolean } = {},
): SceneElements | null {
  const composed = composeMindmapScene(api.getSceneElementsIncludingDeleted() as unknown as SceneElement[], change, extraRoots, sceneTools);
  if (!composed) return null;
  const next = (change.edit ? fitAddedNode(composed.elements, change.edit) : composed.elements) as unknown as SceneElements;
  const select = change.select && next.some((element) => element.id === change.select && !element.isDeleted) ? change.select : null;
  // 置き直しても何も動かない（ドラッグしても元の場所のまま・文字を変えても大きさが同じ）ときは場面に触れない（取り消しの記録を増やさない）。
  if (!composed.changed && !select) return null;
  api.updateScene({
    elements: next,
    ...(select ? { appState: { selectedElementIds: { [select]: true }, selectedGroupIds: {} } as never } : {}),
    ...(capture ? { captureUpdate: CaptureUpdateAction.IMMEDIATELY } : {}),
  });
  return next;
}

// 文字の編集を終えた節を、文字に合わせた大きさにする（幅は AI の思考マップと同じ見積もり、折り返しと高さは Excalidraw の計測）。
// 変わらなければ空。
export function fitMindmapNodeToText(elements: readonly ExcalidrawElement[], nodeId: string, depth: number) {
  const patches = new Map<string, Record<string, unknown>>();
  const container = elements.find((element) => element.id === nodeId && !element.isDeleted);
  const textId = container?.boundElements?.find((item) => item.type === "text")?.id;
  const text = textId ? elements.find((element) => element.id === textId && !element.isDeleted) : undefined;
  if (!container || !text || text.type !== "text") return patches;
  const box = mindmapNodeBox(text.originalText, depth);
  // 折り返し済みの text ではなく、元の文字（originalText）から折り返し直す。
  const [, fitted] = restoreElements([{ ...container, width: box.width }, { ...text, text: text.originalText }] as never, null, { refreshDimensions: true }) as unknown as ExcalidrawElement[];
  if (!fitted || fitted.id !== text.id || fitted.type !== "text") return patches;
  const height = Math.ceil(fitted.height + 2 * box.paddingY);
  if (Math.abs(box.width - container.width) < 1 && Math.abs(height - container.height) < 1) return patches;
  patches.set(container.id, { width: box.width, height });
  patches.set(text.id, {
    text: fitted.text, width: fitted.width, height: fitted.height,
    x: container.x + (box.width - fitted.width) / 2, y: container.y + (height - fitted.height) / 2,
  });
  return patches;
}

// 浮かべるボタンに渡す、思考マップの様子（場面の座標）。
export type MindmapOverlayModel = { selection: MindmapSelection | null; collapsed: CollapsedMindmapNode[] };

type View = { scrollX: number; scrollY: number; zoom: number };

// 選んだ節の上の小さなボタン（子を足す・兄弟を足す・畳む）と、畳んだ節の「+N」（押すと広げる）。タッチでも押せる大きさ。
// 位置は場面の座標から計算し、スクロール・拡大縮小に合わせて動かす（このコンポーネントだけが描き直す）。
export function MindmapOverlay({ api, model, editable, hidden, onAddChild, onAddSibling, onToggle }: {
  api: ExcalidrawImperativeAPI;
  model: MindmapOverlayModel;
  editable: boolean;
  // ドラッグ・大きさの変更・文字の編集の間は出さない。
  hidden: boolean;
  onAddChild: (nodeId: string) => void;
  onAddSibling: (nodeId: string) => void;
  onToggle: (nodeId: string) => void;
}) {
  const t = useT();
  const [view, setView] = useState<View>(() => {
    const state = api.getAppState();
    return { scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom.value };
  });
  useEffect(() => api.onScrollChange((scrollX, scrollY, zoom) => setView({ scrollX, scrollY, zoom: zoom.value })), [api]);
  if (hidden) return null;
  const at = (x: number, y: number) => ({ left: (x + view.scrollX) * view.zoom, top: (y + view.scrollY) * view.zoom });
  const selection = editable ? model.selection : null;
  return <>
    {model.collapsed.map((node) => {
      const left = node.side === "left" ? node.box.x : node.box.x + node.box.width;
      const position = at(left, node.box.y + node.box.height / 2);
      const label = t("Hidden topics: {count}", { count: node.hidden });
      const style = { left: position.left, top: position.top };
      const className = `whiteboard-mindmap-badge${node.side === "left" ? " is-left" : ""}`;
      return editable
        ? <button key={node.nodeId} type="button" className={className} style={style} aria-label={`${t("Expand branch")} — ${label}`} title={label} onClick={() => onToggle(node.nodeId)}>+{node.hidden}</button>
        : <span key={node.nodeId} className={className} style={style} title={label}>+{node.hidden}</span>;
    })}
    {selection && (() => {
      const top = at(selection.box.x + selection.box.width / 2, selection.box.y);
      const bottom = at(selection.box.x + selection.box.width / 2, selection.box.y + selection.box.height);
      // 上に場所が無い（題名の帯に重なる）ときは節の下に出す。
      const below = top.top < 108;
      return <div className={`whiteboard-mindmap-bar${below ? " is-below" : ""}`} role="toolbar" aria-label={t("Mind map")}
        style={{ left: top.left, top: below ? bottom.top : top.top }}>
        <MindmapButton label={t("Add child")} shortcut="Tab" onClick={() => onAddChild(selection.nodeId)}><GitBranchPlus size={16} /></MindmapButton>
        {!selection.isRoot && <MindmapButton label={t("Add sibling")} shortcut="Enter" onClick={() => onAddSibling(selection.nodeId)}><ListPlus size={16} /></MindmapButton>}
        {selection.canCollapse && <MindmapButton label={t("Collapse branch")} onClick={() => onToggle(selection.nodeId)}><CircleMinus size={16} /></MindmapButton>}
      </div>;
    })()}
  </>;
}

function MindmapButton({ label, shortcut, onClick, children }: { label: string; shortcut?: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="whiteboard-mindmap-button" aria-label={label} title={shortcut ? `${label} — ${shortcut}` : label} onClick={onClick}>{children}</button>;
}

// ---- 学習テンプレート ----

export const TEMPLATE_NAMES: Record<WhiteboardTemplate, string> = {
  mindmap: msg("Mind map"), cornell: msg("Cornell notes"), timeline: msg("Timeline"), venn: msg("Venn diagram"), comparison: msg("Comparison table"),
};

export const TEMPLATE_ICONS: Record<WhiteboardTemplate, ReactNode> = {
  mindmap: <Network size={18} aria-hidden="true" />, cornell: <NotebookPen size={18} aria-hidden="true" />, timeline: <Milestone size={18} aria-hidden="true" />,
  venn: <Blend size={18} aria-hidden="true" />, comparison: <Table2 size={18} aria-hidden="true" />,
};

// テンプレートの文字（17 か国語）。
export function templateLabels(template: WhiteboardTemplate, t: (text: string, vars?: Record<string, string | number>) => string): TemplateLabels {
  return {
    title: t(TEMPLATE_NAMES[template]),
    mindmap: { central: t("Central topic"), idea: (n) => t("Idea {n}", { n }) },
    cornell: { header: t("Topic · Date"), cues: t("Cues and questions"), notes: t("Notes"), summary: t("Summary") },
    timeline: { event: (n) => t("Event {n}", { n }), date: t("Date") },
    venn: { left: t("Option A"), right: t("Option B"), both: t("Both") },
    comparison: { aspect: t("Aspect"), optionA: t("Option A"), optionB: t("Option B"), point: (n) => t("Point {n}", { n }) },
  };
}

