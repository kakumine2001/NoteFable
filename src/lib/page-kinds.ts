import { msg } from "@/lib/i18n/translate";

// ワークスペースのページの種類（docs/architecture/notes-flow.md の「页面类型」）。
// DB の enum PageKind と API の JSON は同じ小文字の値。作った後は変えない。
// note は BlockNote の本文（NotePage.blocks）、whiteboard と slides は本体を NoteCanvas に別に置く（src/lib/canvas-document.ts）。
// このファイルは prisma を読み込まない（画面からも使う）。
export const PAGE_KINDS = ["note", "whiteboard", "slides"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];
export type CanvasKind = Exclude<PageKind, "note">;

export function isPageKind(value: unknown): value is PageKind {
  return typeof value === "string" && (PAGE_KINDS as readonly string[]).includes(value);
}

export function isCanvasKind(kind: unknown): kind is CanvasKind {
  return kind === "whiteboard" || kind === "slides";
}

// 古い応答・古い下書き・古いアプリの値には kind が無い。無い・知らない値はノートとして扱う。
export function pageKindOf(page: { kind?: unknown } | null | undefined): PageKind {
  return isPageKind(page?.kind) ? page.kind : "note";
}

export type PageKindFeatures = {
  // その種類を編集できるエディターがある（無い種類は読み取り専用の仮の画面を出す）。
  editor: boolean;
  // Markdown の書き出し（GET /api/pages/:id/export）。
  markdownExport: boolean;
  // 書体・小さい文字・全幅（ページ設定のうち本文の見た目だけに効くもの）。ロックはすべての種類で使える。
  typography: boolean;
  // 公開共有（/s/:token）。公開用の読み取りビューがある種類だけ。
  publicShare: boolean;
  // AI の編集案（propose_note_edit と適用）。
  aiEdit: boolean;
};

// 種類ごとに使える機能。ホワイトボード（#152）とスライド（#149）のエディター・公開ビュー・AI 操作ができたら、ここを true にする。
// サーバーの拒否（設定・書き出し・共有）も画面のメニューも、この表だけを見る。
export const PAGE_KIND_FEATURES: Record<PageKind, PageKindFeatures> = {
  note: { editor: true, markdownExport: true, typography: true, publicShare: true, aiEdit: true },
  // ホワイトボード（#152）：エディターと公開の読み取りビューがある。AI の操作は #153。
  whiteboard: { editor: true, markdownExport: false, typography: false, publicShare: true, aiEdit: false },
  slides: { editor: false, markdownExport: false, typography: false, publicShare: false, aiEdit: false },
};

export function pageKindFeatures(kind: PageKind): PageKindFeatures {
  return PAGE_KIND_FEATURES[kind];
}

// 種類の名前（画面の文言は t() で訳す）。
export const PAGE_KIND_LABELS: Record<PageKind, string> = {
  note: msg("Note"),
  whiteboard: msg("Whiteboard"),
  slides: msg("Slides"),
};

// 種類ごとの拒否の文（サーバーが返し、利用者の言語に訳す。src/lib/page-kind-errors.ts）。
export const NOT_A_NOTE_ERRORS: Record<CanvasKind, string> = {
  whiteboard: msg("This page is a whiteboard, not a note."),
  slides: msg("This page is a slide deck, not a note."),
};
