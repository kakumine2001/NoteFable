import type { Prisma } from "@/generated/prisma/client";
import type { CanvasData, CanvasSegment } from "@/lib/canvas-document";
import type { ToolDefinition, ToolImage } from "@/lib/chat-tools";
import type { PageKind } from "@/lib/page-kinds";
import type { ProposalChange } from "@/lib/page-ai/types";
import type { WhiteboardMetaMap } from "@/lib/whiteboard/frames";

// AI 操控底座（docs/architecture/chat-flow.md の「AI 操控底座」）の、ページの種類ごとのアダプター。
// 枠組み（tools.ts・proposals.ts）は種類を知らず、読む・操作を提案にする・新しいページを提案する・適用する・画像にするを
// アダプターに任せる。ノートは note-adapter.ts、ホワイトボード・スライドは canvas-adapter.ts（#153・#150 で操作を足すまで読むだけ）。

export type Tx = Prisma.TransactionClient;

// read_note が 1 回に返す本文の上限（文字数）。超えた分は枠・スライド・末尾の区切りで切る。
export const MAX_READ_CHARS = 20_000;

// 枠組みがアダプターに渡すページ（持ち主を確かめ、ゴミ箱のものは除いたもの）。
export type AdapterPage = {
  id: string;
  kind: PageKind;
  title: string;
  icon: string | null;
  version: number;
  updatedAt: Date;
  // ノートの本文（BlockNote のブロック）。ホワイトボード・スライドは空配列。
  blocks: unknown;
  // ホワイトボード・スライドの本体（needsData のアダプターにだけ読む）と、保存時に取り出した文字。
  data?: CanvasData | null;
  segments?: CanvasSegment[];
  // ページの「ロック」（誤って変えないための画面の保護）。AI パネルの「自動適用」は、ロックしたページには書かない。
  locked?: boolean;
  // 今回のターンで利用者が選んだ要素・スライドの ID。大きなボード・スライドで出力上限に達するとき、選んだ対象を優先して載せる。
  focusIds?: readonly string[];
  // ノートに埋め込まれたホワイトボード（生きている自分のホワイトボードのみ）の題名と枠名。read_note で人間が読める名前を出す。
  embeddedWhiteboards?: WhiteboardMetaMap;
};

// ツールを実行するときの文脈。userId はサーバーのセッションのもので、モデルの入力からは決して取らない。
// excludeMessageIds は再生成で置き換えられる発言（チャットの添付を扱うときに外す）。
export type AdapterContext = { userId: string; sessionId: string; excludeMessageIds: string[] };

// 提案が書く内容。ノートは blocks、ホワイトボード・スライドは data（本体）。icon を持たない（undefined の）提案はアイコンを変えない。
export type ProposedContent = { title: string; icon?: string | null; blocks?: unknown[]; data?: CanvasData };

// 保存と同じ検証を通した、書ける内容。size と filePaths はホワイトボード・スライドの本体の大きさと参照しているファイル。
export type ValidatedContent = { title: string; icon?: string | null; blocks: unknown[]; data?: CanvasData; size?: number; filePaths?: string[] };

// 履歴（NoteRevision）に残す内容。
export type PageSnapshot = { title: string; icon: string | null; blocks: unknown; data?: unknown };

// 提案に付ける縮小画像（改前・改後）。change は changes の位置。画像は提案の中に保存し、画面には URL で渡す。
export type ProposalImage = { change: number; side: "before" | "after"; mimeType: ToolImage["mimeType"]; base64: string };

export type EditDraft = {
  title?: { before: string; after: string };
  changes: ProposalChange[];
  proposed: ProposedContent;
  images?: ProposalImage[];
  // 変更した要素・スライドの ID（改前/改後プレビューで対象箇所を示すため。画面の提案一覧には載せず content API だけで返す）。
  focusIds?: string[];
  // この提案のために保存したファイル（チャットの画像の写しなど）。提案を保存できなかったときに消す。
  copiedFiles?: string[];
  // 内容の変わらない編集案。モデルに作り直させる。
  unchanged?: boolean;
};

export type CreateDraft = {
  title: string;
  icon: string | null;
  // カードに出す本文（ノートは Markdown、ほかは読める文字）。
  content: string;
  parentId?: string | null;
  changes?: ProposalChange[];
  proposed: ProposedContent;
  images?: ProposalImage[];
  focusIds?: string[];
  copiedFiles?: string[];
};

// モデルが直せる誤り（引数の誤り・番号の範囲外など）。ツールのエラー結果としてモデルに返す。label は途中経過の表示。
export class AdapterError extends Error {
  constructor(message: string, readonly label?: string) {
    super(message);
  }
}

// 画像にする範囲。スライドは slideId の 1 枚、ホワイトボードは elementIds の要素を囲む範囲（空なら全体）。
export type PreviewTarget = { slideId: string | null; elementIds: string[] };

export interface PageAdapter {
  readonly kind: PageKind;
  // read_note・操作の提案のときに本体（NoteCanvas.data）を読む必要があるか。
  readonly needsData?: boolean;

  // 読む：read_note の本文（共通の見出しの後ろ）。安定した ID（ノートはブロック番号、ほかは要素・スライドの ID）と内容。
  read(page: AdapterPage): string;
  // read_note の最後に添える一文（例：このページは読むだけ）。
  readNote?(page: AdapterPage): string | undefined;

  // 操作：操作のツールと、その引数を提案にする処理。無い種類は AI からは読むだけ。
  // 版の確認は枠組みがする（引数の noteId と version）。
  readonly edit?: { tool: ToolDefinition; propose(ctx: AdapterContext, page: AdapterPage, args: unknown): Promise<EditDraft> };
  // 新しいページ：ツールと、その引数を提案にする処理。direct は確認なしに作る（ゴミ箱へ移して取り消せる）。
  readonly create?: { tool: ToolDefinition; direct?: boolean; propose(ctx: AdapterContext, args: unknown): Promise<CreateDraft> };

  // 適用：保存と同じ検証（題名・本文・アイコン・ファイルの持ち主）をして、書ける内容にする。失敗は NoteValidationError。
  validate(userId: string, content: ProposedContent): ValidatedContent;
  // 適用：参照するファイル（アイコン・画像など）を使用中にする。履歴を書く前に呼ぶ（手動の保存と同じロックの順序：ファイルの行 → ページの行）。
  claim(tx: Tx, userId: string, content: ValidatedContent, options?: { allowExistingWhiteboards?: Iterable<string> }): Promise<void>;
  // 適用：トランザクションの中で、版が target.version のときだけ書いて版を 1 進める。書けなければ false。先に claim を呼ぶ。
  // ai は AI の書き込み（ページの aiUpdatedAt を進める）。元に戻す（履歴の内容を書く）ときは false。
  // requireUnlocked が true のときは locked: false も原子的に条件へ含める（自動適用とロック操作の競合を防ぐ）。
  write(tx: Tx, target: { id: string; userId: string; version: number }, content: ValidatedContent, options: { ai: boolean; requireUnlocked?: boolean }): Promise<boolean>;
  // 適用（新規）：トランザクションの中でページを作る。parentId はサブページの親。
  createPage(tx: Tx, userId: string, content: ValidatedContent, parentId: string | null): Promise<{ id: string; version: number }>;
  // 履歴に残す、いまの内容（トランザクションの中で読む）。
  snapshot(tx: Tx, page: { id: string; title: string; icon: string | null; blocks: unknown }): Promise<PageSnapshot>;
  // 履歴の内容を、元に戻すときに書ける形にする。
  fromSnapshot(snapshot: { title: string; icon: string | null; blocks: unknown; data: unknown }): ProposedContent;

  // 予覧：ページ（の一部）を画像にする（画像を読めるモデルの preview_page で使う）。描けなければ null。
  preview?(page: AdapterPage, target: PreviewTarget): Promise<ToolImage | null>;
}
