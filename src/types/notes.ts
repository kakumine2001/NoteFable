import type { Block } from "@blocknote/core";

export const CHAT_RECENT_COUNT = 4;

// icon は絵文字 1 つ、cover は NOTE_COVERS のキーかアップロード画像のキー、coverPosition は画像カバーの縦位置（%）。未設定は null。
export type NoteContent = { title: string; icon: string | null; cover: string | null; coverPosition: number | null; blocks: Block[] };
export type NotePageSummary = {
  id: string;
  position?: number;
  title: string;
  icon: string | null;
  version: number;
  // 所属グループの ID。グループなしは null。サブページは最上位の祖先と同じグループ。
  groupId: string | null;
  // 親ページの ID（Notion のサブページ）。最上位は null。古い応答にはない。
  parentId?: string | null;
  // お気に入りに入れた時刻（ISO 文字列）。お気に入りでなければ null。
  favoritedAt?: string | null;
  // ページの表示設定（「…」メニュー）。本文の版とは別に保存される。古い応答にはない。
} & Partial<NotePageSettings> & {
  createdAt: string;
  updatedAt: string;
};
export type NotePageFont = "default" | "serif" | "mono";
export type NotePageSettings = { fullWidth: boolean; smallText: boolean; font: NotePageFont; locked: boolean };
// 一覧の 1 件から表示設定を取り出す（未設定・不明な値は既定値）。
export function pageSettingsOf(page: Partial<NotePageSettings> | undefined): NotePageSettings {
  const font = page?.font === "serif" || page?.font === "mono" ? page.font : "default";
  return { fullWidth: page?.fullWidth === true, smallText: page?.smallText === true, font, locked: page?.locked === true };
}
export type NotePage = NotePageSummary & NoteContent;
export type NoteGroupSummary = { id: string; name: string; position: number };
export type NoteSaveStatus = "saved" | "pending" | "saving" | "error" | "conflict";

// ゴミ箱のノートを復元できる日数。サーバー（復元の期限・完全削除）と画面の文言が同じ値を使うので、サーバー専用の依存を持たないここに置く。
export const TRASH_RETENTION_DAYS = 30;
// deletedAt はゴミ箱に入れた時刻、purgeAt は復元できなくなり完全に削除される時刻（ISO 文字列）。
export type NoteTrashItem = { id: string; title: string; icon: string | null; deletedAt: string; purgeAt: string };

// 履歴を残した理由。AUTO は自動保存、AI_EDIT は AI の編集案を適用する直前、RESTORE は履歴から戻す直前。
export type NoteRevisionReason = "AUTO" | "AI_EDIT" | "RESTORE";
// 一覧用（本文は含めない）。version は残した時点のノートの版、createdAt は残した時刻（ISO 文字列）。
export type NoteRevisionSummary = { id: string; reason: NoteRevisionReason; title: string; version: number; createdAt: string };
export type NoteRevisionDetail = NoteRevisionSummary & { icon: string | null; blocks: Block[] };
