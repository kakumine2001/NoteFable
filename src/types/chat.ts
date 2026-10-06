import type { ActivityStep } from "@/lib/chat-activity";

export type Session = {
  // DB 上のセッション ID。メッセージ取得・削除・選択状態に使う。
  id: string;
  // サイドバーとヘッダーに表示する会話タイトル。
  title: string;
  // セッション作成日時。API から文字列化されて届く。
  createdAt: string;
  // 一覧の並び順に使う最終更新日時。
  updatedAt: string;
};

export type Message = {
  // DB の message ID、または送信直後の楽観表示で作る一時 ID。
  id: string;
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
  // 回答前の推論要約と Web 検索の途中経過。ストリーム中だけ届き、DB には保存しない。
  activity?: ActivityStep[];
  // 送信から本文の最初の差分が届くまでの時間。「Thought for Ns」の表示に使う。
  thinkingMs?: number;
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
  // FormData に追加する元の File オブジェクト。
  file: File;
  // 画像添付の送信前プレビュー URL。
  previewUrl?: string;
};
