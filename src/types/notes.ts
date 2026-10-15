import type { Block } from "@blocknote/core";

// icon は絵文字 1 つ、cover は NOTE_COVERS のキーかアップロード画像のキー、coverPosition は画像カバーの縦位置（%）。未設定は null。
export type NoteContent = { title: string; icon: string | null; cover: string | null; coverPosition: number | null; blocks: Block[] };
export type NotePageSummary = {
  id: string;
  position?: number;
  title: string;
  icon: string | null;
  version: number;
  // 所属グループの ID。グループなしは null。
  groupId: string | null;
  createdAt: string;
  updatedAt: string;
};
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
