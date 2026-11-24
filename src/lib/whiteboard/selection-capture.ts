import { isSelectionId, MAX_SELECTION_IDS } from "@/lib/page-ai/types";

// 選区を AI へ送る PNG の長辺上限（D5）。モデル入力の解像度上限に収め、帯域とトークンを抑える。
export const MAX_SELECTION_IMAGE_SIDE = 1568;
const MAX_CAPTURE_PIXELS = 16_000_000;

export type WhiteboardSelectableElement = {
  id: string;
  type: string;
  isDeleted?: boolean;
  frameId?: string | null;
  containerId?: string | null;
  name?: string | null;
  text?: string;
  originalText?: string;
};

// 選んでいる要素から、AI に渡す ID・文字・書き出し対象の要素一覧を組み立てる。
// 枠（frame）を選んだときは枠内の要素も含め、図形・矢印に付いた文字（containerId）も一緒に含める。
export function expandWhiteboardSelection<T extends WhiteboardSelectableElement>(
  elements: readonly T[],
  selectedIds: ReadonlySet<string>,
): { elements: T[]; ids: string[]; text: string } {
  const live = elements.filter((element) => element.isDeleted !== true);
  const liveById = new Map(live.map((element) => [element.id, element]));

  // ユーザーが直接選んだ生きている要素。
  const directIds: string[] = [];
  const included = new Set<string>();
  for (const element of live) {
    if (!selectedIds.has(element.id)) continue;
    included.add(element.id);
    directIds.push(element.id);
  }
  if (!included.size) return { elements: [], ids: [], text: "" };

  // 枠が選ばれていたら、その枠に入っている要素を含める。
  const selectedFrameIds = new Set<string>();
  for (const id of included) {
    const element = liveById.get(id);
    if (element?.type === "frame") selectedFrameIds.add(id);
  }
  if (selectedFrameIds.size) {
    for (const element of live) {
      if (typeof element.frameId === "string" && selectedFrameIds.has(element.frameId)) {
        included.add(element.id);
      }
    }
  }

  // 文字要素が直接選ばれていてコンテナがある場合はコンテナも含め、逆にコンテナが含まれていれば付随する文字も含める。
  for (const id of [...included]) {
    const element = liveById.get(id);
    if (element?.type === "text" && typeof element.containerId === "string" && liveById.has(element.containerId)) {
      included.add(element.containerId);
    }
  }
  for (const element of live) {
    if (element.type === "text" && typeof element.containerId === "string" && included.has(element.containerId)) {
      included.add(element.id);
    }
  }

  const expanded = live.filter((element) => included.has(element.id));

  // read_note と揃う ID 一覧（バインド文字が直接選ばれた場合は親コンテナの ID へ寄せ、重複・不正形式・上限超えを省く）。
  const ids: string[] = [];
  const seenIds = new Set<string>();
  for (const id of directIds) {
    const element = liveById.get(id);
    const canonicalId = element?.type === "text" && typeof element.containerId === "string"
      && liveById.has(element.containerId) && liveById.get(element.containerId)?.type !== "frame"
      ? element.containerId
      : id;
    if (isSelectionId(canonicalId) && !seenIds.has(canonicalId)) {
      seenIds.add(canonicalId);
      ids.push(canonicalId);
      if (ids.length >= MAX_SELECTION_IDS) break;
    }
  }

  // 枠の名前・テキスト・付箋・図形や矢印に付いた文字を順序通りに集める。
  const lines: string[] = [];
  const seenText = new Set<string>();
  for (const element of expanded) {
    const raw = element.type === "frame"
      ? (typeof element.name === "string" ? element.name : "")
      : element.type === "text" || element.type === "stickynote"
        ? (typeof element.originalText === "string" && element.originalText.trim()
          ? element.originalText
          : typeof element.text === "string" ? element.text : "")
        : "";
    const trimmed = raw.trim();
    if (trimmed && !seenText.has(trimmed)) {
      seenText.add(trimmed);
      lines.push(trimmed);
    }
  }

  return { elements: expanded, ids, text: lines.join("\n") };
}

// 長辺が maxSide を超えない書き出し倍率（小さい図形は鮮明に見えるよう preferred まで拡大可）。
export function selectionImageScale(width: number, height: number, maxSide = MAX_SELECTION_IMAGE_SIDE, preferred = 2): number {
  const safeW = Math.max(1, width);
  const safeH = Math.max(1, height);
  return Math.min(preferred, maxSide / Math.max(safeW, safeH), Math.sqrt(MAX_CAPTURE_PIXELS / (safeW * safeH)));
}

// canvas 出力後に長辺が maxSide を超えていた場合の縮小後サイズ（1px 以上を保証）。
export function clampImageDimensions(width: number, height: number, maxSide = MAX_SELECTION_IMAGE_SIDE): { width: number; height: number; scaled: boolean } {
  const safeW = Math.max(1, Math.round(width));
  const safeH = Math.max(1, Math.round(height));
  const longest = Math.max(safeW, safeH);
  if (longest <= maxSide) return { width: safeW, height: safeH, scaled: false };
  const ratio = maxSide / longest;
  return {
    width: Math.max(1, Math.floor(safeW * ratio)),
    height: Math.max(1, Math.floor(safeH * ratio)),
    scaled: true,
  };
}
