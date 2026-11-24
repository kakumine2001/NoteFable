import { pageKindFeatures, type PageKind } from "@/lib/page-kinds";

const preloaded = new Set<PageKind>();

// サイドバーやホームでページ行にポインターを乗せた時点で、その種類のエディター本体（JS チャンク）も先読みする。
// 初回にホワイトボード（Excalidraw）やスライドを開く時の「Loading editor…」待ちを短くする。
export function preloadPageEditor(kind: PageKind) {
  if (typeof window === "undefined" || preloaded.has(kind)) return;
  if (!pageKindFeatures(kind).editor) return;
  preloaded.add(kind);
  const loader = kind === "whiteboard"
    ? () => import("@/components/whiteboard/whiteboard-canvas")
    : kind === "slides"
      ? () => import("@/components/slides/slides-editor")
      : () => import("@/components/note-editor");
  void loader().catch(() => { preloaded.delete(kind); });
}
