// スライドのエディターで、キー操作・コピーが「枚」と「要素」のどちらに効くかを決める（純粋な関数。テストあり）。
// 縮小図の一覧（帯・総覧）を操作しているときは枚に効き、見えていない（または今の枚の）要素の選択には決して効かない。

export const SLIDE_LIST_SELECTOR = ".slides-filmstrip, .slides-grid";

export type EditorView = "slide" | "grid";

// 総覧を見ているか、フォーカスが縮小図の一覧の中にあるか。
export function inSlideList(view: EditorView, target: unknown): boolean {
  if (view === "grid") return true;
  if (typeof target !== "object" || target === null) return false;
  const closest = (target as { closest?: unknown }).closest;
  return typeof closest === "function" && Boolean((closest as (selector: string) => unknown).call(target, SLIDE_LIST_SELECTOR));
}

// slides: 縮小図の一覧（選んだ枚に効く）。elements: スライドの面で要素を選んでいる。stage: スライドの面で何も選んでいない。
export type EditorKeyScope = "slides" | "elements" | "stage";

export function editorKeyScope(view: EditorView, target: unknown, selectedElementCount: number): EditorKeyScope {
  if (inSlideList(view, target)) return "slides";
  return selectedElementCount > 0 ? "elements" : "stage";
}

// コピー・切り取りで写すもの。枚の文脈（縮小図の一覧・枚の右クリックのメニュー）では枚だけ、スライドの面では要素だけ。
export function clipboardSource(slideContext: boolean, selectedElementCount: number, selectedSlideCount: number): "elements" | "slides" | null {
  if (slideContext) return selectedSlideCount > 0 ? "slides" : null;
  return selectedElementCount > 0 ? "elements" : null;
}
