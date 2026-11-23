import type { PageKind } from "@/lib/page-kinds";

// AI の提案（ページの編集・新規作成）を画面に出す形。サーバー（page-ai/proposals.ts）が作り、チャットの途中経過（chat-activity.ts）と
// 会話の履歴（GET /api/sessions/:id/messages）で届く。ウェブ・Android・iOS の提案カードはこの形だけを見て、種類ごとの差は持たない。
// このファイルは prisma を読み込まない（画面からも使う）。

export type ProposalStatus = "pending" | "applied" | "discarded" | "undone";

// 変更の操作。ノートは replace / insert_after / delete。ほかの種類（ホワイトボード・スライド）は add / update / move / reorder も使う。
export const PROPOSAL_OPS = ["replace", "insert_after", "delete", "add", "update", "move", "reorder"] as const;
export type ProposalOp = (typeof PROPOSAL_OPS)[number];

// 変更の対象。ノートは block（read_note の番号）で表し、target は持たない。
// slide はスライドの何枚目か（1 から）、elements はホワイトボードの要素（1 つなら name にその文字、複数なら count）。
export type ProposalTarget =
  | { type: "slide"; number: number }
  | { type: "elements"; count: number; name?: string };

// カードに出す変更 1 つ。改前・改後の文字と、ホワイトボード・スライドの縮小画像（beforeImage / afterImage）は種類ごとのアダプターが作る。
export type ProposalChange = {
  op: ProposalOp;
  // ノートの read_note のブロック番号（0 はノートの先頭への挿入）。ほかの種類は 0。
  block: number;
  target?: ProposalTarget;
  // 変更前と変更後（ノートは Markdown、ほかの種類は読める文字）。挿入・追加では before、削除では after がない。
  before?: string;
  after?: string;
  // 縮小画像の URL（同じオリジンの /api/proposals/:id/image?…）。保存した画像そのものは画面に送らない。
  beforeImage?: string;
  afterImage?: string;
  // 置き換えると Markdown で表せない書式（文字色・背景色・下線・配置）が失われる。画面で警告する。
  dropsFormatting?: true;
  // 置き換え・削除すると、アップロード済みの画像やファイルがノートから外れる。画面で警告する。
  dropsMedia?: true;
};

type ProposalState = {
  // 保存済みの提案の状態。画面に届く提案だけが持つ。
  status?: ProposalStatus;
  // 適用で書いたページの ID（新規は作ったページ、編集は対象のページ）。
  appliedPageId?: string | null;
  // 対象・作るページの種類。古い応答には無い（ノートとして扱う）。
  pageKind?: PageKind;
  // AI パネルの「自動適用」で、確認なしに適用した。
  autoApplied?: boolean;
  // 元に戻せる（適用済みで、適用した版が記録されている）。実際に戻せるかは押したときにサーバーが確かめる。
  undoable?: boolean;
};

// 既存のページの編集案。proposed.blocks は画面では常に空（適用はサーバーが保存した内容だけを使う）。古いアプリは配列があることを確かめる。
export type PageEditProposal = ProposalState & {
  id: string;
  pageId: string;
  pageTitle: string;
  baseVersion: number;
  title?: { before: string; after: string };
  changes: ProposalChange[];
  proposed: { title: string; blocks: unknown[] };
};

// 新しいページの提案。content は画面に出す本文（ノートは Markdown、ほかの種類は読める文字）。
export type PageCreateProposal = ProposalState & {
  id: string;
  title: string;
  icon: string | null;
  content: string;
  // サブページとして作るときの親ページ。
  parentId?: string | null;
  parentTitle?: string;
  // ホワイトボード・スライドの縮小画像など、本文以外に見せる変更。
  changes?: ProposalChange[];
  proposed: { title: string; icon: string | null; blocks: unknown[] };
};

// エディターで選んだ範囲（AI パネルに渡す文脈）。text は引用として発言の先頭に付け、ids は要素・スライドの ID（ホワイトボード・スライド）。
export type PageSelection = { text: string; ids?: string[] };

export const MAX_SELECTION_IDS = 100;
export const MAX_SELECTION_ID_LENGTH = 120;
