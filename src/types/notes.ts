import type { Block } from "@blocknote/core";
import type { PageKind } from "@/lib/page-kinds";

export type { PageKind };

export const CHAT_RECENT_COUNT = 4;

// icon は絵文字 1 つ、cover は NOTE_COVERS のキーかアップロード画像のキー、coverPosition は画像カバーの縦位置（%）。未設定は null。
// data はホワイトボード・スライドの本体（NoteCanvas.data）。ノートには無く、ホワイトボード・スライドの blocks はいつも [] で cover は null。
export type NoteContent = { title: string; icon: string | null; cover: string | null; coverPosition: number | null; blocks: Block[]; data?: Record<string, unknown> };
export type NotePageSummary = {
  id: string;
  // ページの種類（ノート・ホワイトボード・スライド）。古い応答にはない（ノートとして扱う。pageKindOf）。
  kind?: PageKind;
  position?: number;
  title: string;
  icon: string | null;
  cover?: string | null;
  coverPosition?: number | null;
  version: number;
  // 所属グループの ID。グループなしは null。サブページは最上位の祖先と同じグループ。
  groupId: string | null;
  // 親ページの ID（Notion のサブページ）。最上位は null。古い応答にはない。
  parentId?: string | null;
  // お気に入りに入れた時刻（ISO 文字列）。お気に入りでなければ null。
  favoritedAt?: string | null;
  // ページの表示設定（「…」メニュー）。本文の版とは別に保存される。古い応答にはない。
} & Partial<NotePageSettings> & {
  // 公開共有の状態（トップバーの共有ボタンの強調表示に使う）。古い応答にはない。
  shareEnabled?: boolean;
  shareExpiresAt?: string | null;
  // AI が最後に内容を書いた時刻（ISO 文字列）。null・無しは AI が書いていない。ページのメニューに「AI の内容を報告」を出す目印。
  aiUpdatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};
export type NoteShareAncestor = {
  id: string;
  title: string;
  icon: string | null;
  token: string;
  url: string;
  expiresAt: string | null;
};
export type NoteShareState = {
  enabled: boolean;
  active: boolean;
  expired: boolean;
  token: string | null;
  url: string | null;
  includeSubpages: boolean;
  expiresAt: string | null;
  excludeFromParent: boolean;
  hasParent: boolean;
  inheritedFrom: NoteShareAncestor | null;
  inheritedUrl: string | null;
};
export function isPageShared(page: Pick<NotePageSummary, "shareEnabled" | "shareExpiresAt"> | undefined, now = Date.now()): boolean {
  if (!page?.shareEnabled) return false;
  if (!page.shareExpiresAt) return true;
  const expires = Date.parse(page.shareExpiresAt);
  return Number.isFinite(expires) && expires > now;
}
export type NotePageFont = "default" | "serif" | "mono";
export type NotePageSettings = { fullWidth: boolean; smallText: boolean; font: NotePageFont; locked: boolean };
// 一覧の 1 件から表示設定を取り出す（未設定・不明な値は既定値）。
export function pageSettingsOf(page: Partial<NotePageSettings> | undefined): NotePageSettings {
  const font = page?.font === "serif" || page?.font === "mono" ? page.font : "default";
  return { fullWidth: page?.fullWidth === true, smallText: page?.smallText === true, font, locked: page?.locked === true };
}
// data はホワイトボード・スライドの本体（GET /api/pages/:id などが返す。ノートには無い）。
export type NotePage = NotePageSummary & NoteContent & { data?: Record<string, unknown> };
export type NoteGroupSummary = { id: string; name: string; position: number };
export type NoteSaveStatus = "saved" | "pending" | "saving" | "error" | "conflict";

// ゴミ箱のノートを復元できる日数。サーバー（復元の期限・完全削除）と画面の文言が同じ値を使うので、サーバー専用の依存を持たないここに置く。
export const TRASH_RETENTION_DAYS = 30;
// deletedAt はゴミ箱に入れた時刻、purgeAt は復元できなくなり完全に削除される時刻（ISO 文字列）。
export type NoteTrashItem = { id: string; kind?: PageKind; title: string; icon: string | null; deletedAt: string; purgeAt: string };

// 履歴を残した理由。AUTO は自動保存、AI_EDIT は AI の編集案を適用する直前、RESTORE は履歴から戻す直前。
export type NoteRevisionReason = "AUTO" | "AI_EDIT" | "RESTORE";
// 一覧用（本文は含めない）。version は残した時点のノートの版、createdAt は残した時刻（ISO 文字列）。
export type NoteRevisionSummary = { id: string; reason: NoteRevisionReason; title: string; version: number; createdAt: string };
// data はホワイトボード・スライドの履歴の本体（ノートの履歴には無い）。
export type NoteRevisionDetail = NoteRevisionSummary & { icon: string | null; blocks: Block[]; data?: Record<string, unknown>; kind?: PageKind };
