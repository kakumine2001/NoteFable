import { validateCanvasData, type CanvasData } from "@/lib/canvas-document";
import { isEmojiIcon } from "@/lib/emoji-icon";
import { MAX_NOTE_TITLE, uploadedCoverPath } from "@/lib/note-document";
import { pageKindFeatures, PAGE_KINDS, type CanvasKind, type PageKind } from "@/lib/page-kinds";
import type { NoteContent, NotePage } from "@/types/notes";

// ホワイトボード・スライドの保存（画面側）。ノートと同じ保存キュー（NoteSaveQueue）に載せ、送る形だけを変える
// （docs/architecture/notes-flow.md の「页面类型」）。このファイルは画面だけで使う（prisma を読み込まない）。

// ブラウザに残す、保存できていないホワイトボード・スライドの下書き。ノートの下書き（notefable:page-draft:v1:）とは別の名前にする
// （古い画面はホワイトボード・スライドを開くとノートの下書きを消すので、同じ名前だと新しい下書きまで消される）。
export const CANVAS_DRAFT_PREFIX = "notefable:canvas-draft:v1:";

// PATCH /api/pages/:id の本文。本体（data）は、最後に保存できた本体（saved）から変わったときだけ送る（題名だけの変更で 2 MB を送らない）。
export function canvasSaveBody(content: Pick<NoteContent, "title" | "icon" | "data">, version: number, saved: CanvasData | undefined) {
  const sendData = content.data !== undefined && content.data !== saved;
  return { title: content.title, icon: content.icon, ...(sendData ? { data: content.data } : {}), version };
}

// 保存の応答（{ version, page }。page は一覧の 1 件で本体を含まない）と送った本体から、キューが持つページを作り直す。
// 本体を送らなかったときは、それまでの本体（saved）のまま。
export function canvasSavedPage(previous: NotePage, response: { version?: unknown; page: Partial<NotePage> }, content: Pick<NoteContent, "data">, saved: CanvasData | undefined): NotePage {
  const sent = content.data !== undefined && content.data !== saved;
  const version = typeof response.version === "number" ? response.version : response.page.version ?? previous.version;
  return { ...previous, ...response.page, version, blocks: [], cover: null, coverPosition: null, data: sent ? content.data : saved };
}

// ブラウザに残した下書きを読む。壊れている・本体が保存できない形のときは捨てる（送っても断られ続けるので）。
export function parseCanvasDraft(kind: CanvasKind, cached: string, page: Pick<NotePage, "icon">): (NoteContent & { version: number }) | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(cached); } catch { return undefined; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const draft = parsed as { title?: unknown; icon?: unknown; data?: unknown; version?: unknown };
  if (!Number.isSafeInteger(draft.version) || typeof draft.title !== "string" || draft.title.length > MAX_NOTE_TITLE) return undefined;
  const icon = draft.icon === null || (typeof draft.icon === "string" && (isEmojiIcon(draft.icon) || uploadedCoverPath(draft.icon))) ? draft.icon as string | null : page.icon ?? null;
  try {
    const { data } = validateCanvasData(kind, draft.data);
    return { title: draft.title, icon, cover: null, coverPosition: null, blocks: [], data, version: draft.version as number };
  } catch {
    return undefined;
  }
}

// 新規作成の本文（POST /api/pages）。ホワイトボード・スライドは { kind, title, icon, data? }、ノートは従来どおり。
export function newPageBody(kind: PageKind, content: Pick<NoteContent, "title" | "icon" | "cover" | "coverPosition" | "blocks" | "data">, parentId: string | null) {
  const parent = parentId ? { parentId } : {};
  if (kind === "note") return { title: content.title, icon: content.icon, cover: content.cover, coverPosition: content.coverPosition, blocks: content.blocks, ...parent };
  return { kind, title: content.title, icon: content.icon, ...(content.data !== undefined ? { data: content.data } : {}), ...parent };
}

// 「新規」メニューに出す種類：エディターがある種類だけ（ノートが先頭）。ノートしか無いあいだはメニューを出さない。
export function creatablePageKinds(): PageKind[] {
  return PAGE_KINDS.filter((kind) => pageKindFeatures(kind).editor);
}
