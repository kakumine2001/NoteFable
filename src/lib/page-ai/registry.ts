import { PAGE_KINDS, type PageKind } from "@/lib/page-kinds";
import type { PageAdapter } from "@/lib/page-ai/adapter";
import { canvasTextAdapter } from "@/lib/page-ai/canvas-adapter";
import { noteAdapter } from "@/lib/page-ai/note-adapter";

// ページの種類ごとのアダプター。#153（ホワイトボード）・#150（スライド）は、ここで読むだけのアダプターを操作できるものに替える。
// 替えたら page-kinds.ts の PAGE_KIND_FEATURES の aiEdit も true にする（テストが両方をそろえて見る）。
export const PAGE_ADAPTERS: Record<PageKind, PageAdapter> = {
  note: noteAdapter,
  whiteboard: canvasTextAdapter("whiteboard"),
  slides: canvasTextAdapter("slides"),
};

export function adapterFor(kind: PageKind): PageAdapter {
  return PAGE_ADAPTERS[kind];
}

export function allAdapters(): PageAdapter[] {
  return PAGE_KINDS.map(adapterFor);
}
