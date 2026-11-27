import { MAX_MATH_LATEX } from "@/lib/note-document";
import type { HitTestElement } from "@/lib/whiteboard/sketch-to-image";

// ホワイトボードの数式ラベル（KaTeX で画像化して置き、TeX ソースを customData に持つ）。
// 鍵名（notefableFormula）は保存データに残るため、公開後に変更しない。
// このモジュールは Excalidraw や DOM を読み込まない（サーバー・検索・AI 読み取り・テスト共用）。

export const FORMULA_DATA_KEY = "notefableFormula";
export const MAX_WHITEBOARD_FORMULA_LATEX = MAX_MATH_LATEX;

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export type WhiteboardFormulaData = {
  v: 1;
  latex: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// NUL と単独サロゲートを落とし、上限文字数（サロゲートペアの途中で切らない）に収める。
export function sanitizeFormulaLatex(value: string): string {
  const cleaned = value.replace(/\u0000/g, "").replace(LONE_SURROGATE, "").trim();
  if (cleaned.length <= MAX_WHITEBOARD_FORMULA_LATEX) return cleaned;
  const end = (cleaned.charCodeAt(MAX_WHITEBOARD_FORMULA_LATEX - 1) & 0xfc00) === 0xd800
    ? MAX_WHITEBOARD_FORMULA_LATEX - 1
    : MAX_WHITEBOARD_FORMULA_LATEX;
  return cleaned.slice(0, end).trimEnd();
}

export function formulaDataOf(customData: unknown): WhiteboardFormulaData | null {
  if (!isRecord(customData)) return null;
  const raw = customData[FORMULA_DATA_KEY];
  if (!isRecord(raw) || raw.v !== 1 || typeof raw.latex !== "string") return null;
  const latex = sanitizeFormulaLatex(raw.latex);
  return latex ? { v: 1, latex } : null;
}

export function makeFormulaCustomData(latex: string): { notefableFormula: WhiteboardFormulaData } | null {
  const cleaned = sanitizeFormulaLatex(latex);
  if (!cleaned) return null;
  return { notefableFormula: { v: 1, latex: cleaned } };
}

// レンダリング済み数式 PNG の論理サイズから、ホワイトボード上の表示サイズを計算する（縦横比を維持）。
export function fitFormulaDisplaySize(
  logicalWidth: number,
  logicalHeight: number,
  options?: { maxWidth?: number; minWidth?: number; minHeight?: number },
): { width: number; height: number } {
  const maxWidth = options?.maxWidth ?? 560;
  const minWidth = options?.minWidth ?? 48;
  const minHeight = options?.minHeight ?? 36;
  const safeW = Number.isFinite(logicalWidth) && logicalWidth > 0 ? logicalWidth : 120;
  const safeH = Number.isFinite(logicalHeight) && logicalHeight > 0 ? logicalHeight : 48;
  const scale = safeW > maxWidth ? maxWidth / safeW : 1;
  return {
    width: Math.max(minWidth, Math.round(safeW * scale)),
    height: Math.max(minHeight, Math.round(safeH * scale)),
  };
}

export type FormulaHitElement = HitTestElement & { locked?: boolean };

// ダブルクリックで数式を再編集できるよう、シーン座標から最前面の未ロック数式画像を探す。
export function hitTestFormulaElement(
  elements: readonly FormulaHitElement[],
  point: { x: number; y: number },
): { id: string; latex: string } | null {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index];
    if (element.isDeleted || element.locked || element.type !== "image") continue;
    const formula = formulaDataOf(element.customData);
    if (!formula) continue;
    const width = Math.abs(element.width);
    const height = Math.abs(element.height);
    if (width <= 0 || height <= 0) continue;
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    const dx = point.x - cx;
    const dy = point.y - cy;
    const angle = typeof element.angle === "number" && Number.isFinite(element.angle) ? element.angle : 0;
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;
    if (Math.abs(localX) <= width / 2 && Math.abs(localY) <= height / 2) {
      return { id: element.id, latex: formula.latex };
    }
  }
  return null;
}
