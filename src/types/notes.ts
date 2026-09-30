import type { Block } from "@blocknote/core";

export type NoteContent = { title: string; blocks: Block[] };
export type NotePageSummary = {
  id: string;
  title: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type NotePage = NotePageSummary & NoteContent;
export type NoteSaveStatus = "saved" | "pending" | "saving" | "error" | "conflict";
