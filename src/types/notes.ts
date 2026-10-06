import type { Block } from "@blocknote/core";

// icon は絵文字 1 つ、cover は NOTE_COVERS のキーかアップロード画像のキー、coverPosition は画像カバーの縦位置（%）。未設定は null。
export type NoteContent = { title: string; icon: string | null; cover: string | null; coverPosition: number | null; blocks: Block[] };
export type NotePageSummary = {
  id: string;
  title: string;
  icon: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type NotePage = NotePageSummary & NoteContent;
export type NoteSaveStatus = "saved" | "pending" | "saving" | "error" | "conflict";
