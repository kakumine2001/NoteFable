import { PAGE_KINDS, type PageKind } from "@/lib/page-kinds";
import type { PageAdapter } from "@/lib/page-ai/adapter";
import { noteAdapter } from "@/lib/page-ai/note-adapter";
import { slidesAdapter } from "@/lib/page-ai/slides-adapter";
import { whiteboardAdapter } from "@/lib/page-ai/whiteboard-adapter";

// ページの種類ごとのアダプター（ノート・ホワイトボード・スライドすべて操作可能）。
// page-kinds.ts の PAGE_KIND_FEATURES の aiEdit と必ずそろえる（registry.test.ts が検証する）。
export const PAGE_ADAPTERS: Record<PageKind, PageAdapter> = {
  note: noteAdapter,
  whiteboard: whiteboardAdapter,
  slides: slidesAdapter,
};

export function adapterFor(kind: PageKind): PageAdapter {
  return PAGE_ADAPTERS[kind];
}

export function allAdapters(): PageAdapter[] {
  return PAGE_KINDS.map(adapterFor);
}
