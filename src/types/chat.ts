import type { ActivityStep } from "@/lib/chat-activity";
import type { MessageVersions } from "@/lib/chat-branches";
import type { PageKind } from "@/lib/page-kinds";

// 回答に紐付いて保存された AI の提案（ノートの編集・新規作成）。
export type StoredProposal = Extract<ActivityStep, { kind: "proposal" | "create_proposal" }>;

// チャットプロジェクトの共通指示の最大文字数と、参照できるノートの最大件数。クライアントとサーバーで同じ値を使う。
export const MAX_PROJECT_INSTRUCTIONS = 4000;
export const MAX_PROJECT_NOTES = 5;
// 利用者のカスタム指示（すべてのチャット共通）の最大文字数。検証はプロジェクトの共通指示と同じものを使うので、同じ値にする。
export const MAX_CUSTOM_INSTRUCTIONS = MAX_PROJECT_INSTRUCTIONS;
// チャットの 1 回の発言に添付できるノートの数。クライアントとサーバーで同じ値を使う。
export const MAX_MESSAGE_NOTES = 5;
// 発言に添付したノート。表示用のタイトルとアイコンは、履歴を読むたびにノートから取り直す。kind はページの種類（古い応答には無い）。
export type AttachedPage = { id: string; kind?: PageKind; title: string; icon: string | null };

export function toggleAttachedPage(list: AttachedPage[], page: AttachedPage): AttachedPage[] {
  if (list.some((item) => item.id === page.id)) return list.filter((item) => item.id !== page.id);
  return list.length < MAX_MESSAGE_NOTES ? [...list, page] : list;
}

// サイドバー用の一覧と PATCH / POST の応答。noteCount はゴミ箱に入っていないノートだけを数える。
export type ChatProjectSummary = { id: string; name: string; noteCount: number; hasInstructions: boolean };
// 設定画面用の詳細。notes は選んだ順（position の昇順）で、ゴミ箱のノートは含まない。
export type ChatProjectDetail = {
  id: string;
  name: string;
  instructions: string | null;
  notes: { id: string; kind?: PageKind; title: string; icon: string | null }[];
};

export type Session = {
  // DB 上のセッション ID。メッセージ取得・削除・選択状態に使う。
  id: string;
  // サイドバーとヘッダーに表示する会話タイトル。
  title: string;
  // 会話のアイコン（単一の絵文字）。null は既定のチャットアイコン。
  icon?: string | null;
  pinned?: boolean;
  position?: number;
  projectId?: string | null;
  // セッション作成日時。API から文字列化されて届く。
  createdAt: string;
  // 一覧の並び順に使う最終更新日時。
  updatedAt: string;
};

export type Message = {
  // 429 のローカル表示だけに付ける。保存された AI 本文を翻訳対象にしない。
  usageLimit?: "chat" | "image";
  // ファイル置き場の容量が足りずに断られた送信（本文はサーバーの文で、表示時に訳す）。
  storageLimit?: boolean;
  // DB の message ID、または送信直後の楽観表示で作る一時 ID。
  id: string;
  // 楽観表示からサーバー保存済み ID へ差し替えた後も React のコンポーネント実体を維持するためのキー（画面専用）。
  renderKey?: string;
  // USER は右側の吹き出し、ASSISTANT は Markdown 表示として描画する。
  role: "USER" | "ASSISTANT";
  // メッセージ本文。画像生成アシスタントでは空文字になることがある。
  content: string;
  // このメッセージ生成時に選択されていたモデル ID。
  model?: string | null;
  // このメッセージ生成時に選択されていた推論強度。
  reasoningEffort?: string | null;
  // アシスタントが生成した画像。通常添付とは別に大きく表示する。
  generatedImages?: {
    // 画像添付 ID、またはストリーミング中のローカル ID。
    id: string;
    // 表示用 URL。生成中は data URL、履歴では画像取得 API の URL になる。
    dataUrl: string;
    // 画像の MIME type。現在は主に image/png。
    mimeType: string;
  }[];
  // 画像生成中だけローカル表示に使う占位状態。DB からは返らない。
  isGeneratingImage?: boolean;
  // 画像生成モードのターンであることを失敗後も保持する（失敗してもテキストチャット用モデル名を出さない）。
  isImageTurn?: boolean;
  // 送信の失敗を本文に書いた、画面だけのメッセージ。回答ではないので、コピーや保存の操作は出さない。DB からは返らない。
  failed?: boolean;
  // 回答前の推論要約・Web 検索・ツールの途中経過。ストリーム中に届き、回答と一緒に DB へ保存される。
  activity?: ActivityStep[];
  // 保存済みの提案。再読み込み後も適用・破棄できる。ストリーム中の提案は activity に入る。
  proposals?: StoredProposal[];
  // 送信から本文の最初の差分が届くまでの時間。「Thought for Ns」の表示に使う。
  thinkingMs?: number;
  // 利用者がこの発言に添付したノート。ゴミ箱に入ったノートは返らない。
  pages?: AttachedPage[];
  // 編集・再生成でできた別の版があるときの位置と、前後の版の ID。版が 1 つだけなら無い。
  versions?: MessageVersions;
  // ユーザー添付、または生成画像以外のアシスタント添付。
  attachments?: {
    // 添付 ID。送信前はローカル ID、保存後は DB ID。
    id: string;
    // 表示するファイル名。
    filename: string;
    // ファイル種別。画像プレビュー判定に使う。
    mimeType: string;
    // ファイルサイズ。API から返されるメタ情報。
    size: number;
    // サーバー保存済み画像を表示する API URL。
    dataUrl?: string;
    // 送信前だけ使うブラウザ object URL。
    previewUrl?: string;
  }[];
};

export type ImageGenerationResult = {
  // 完成時に返るセッション ID。新規チャット生成時の切り替えに使う。
  sessionId?: string;
  // 完成画像のデータ。
  image?: {
    // 表示用の base64 data URL。
    dataUrl?: string;
    // 画像 MIME type。
    mimeType?: string;
  };
  // エラー時のメッセージ。
  error?: string;
};

export type UploadFile = {
  // 送信前 UI で添付を識別するローカル ID。
  id: string;
  // 私有ストレージへ直接アップロードする元の File オブジェクト。
  file: File;
  // 画像添付の送信前プレビュー URL。
  previewUrl?: string;
};
