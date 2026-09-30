// 画面とサーバーで共有する Notion 保存のやり取りの型。
// サーバー専用モジュール（Prisma や認証）に依存させず、クライアントからも安全に参照できるようにする。

// 画面から送る本文ブロック。ファイルは中身を送らず、メタ情報だけを送る。
export type NotionSaveBlockInput =
  | { type: "text"; text: string }
  | { type: "file"; filename: string; mimeType: string; size: number };

export type NotionSaveFileStatus = "PENDING" | "STAGED" | "UPLOADING" | "COMPLETE";

// 保存開始時にサーバーが返すファイル 1 件分の転送計画。
export type NotionSavePlanFile = {
  fileId: string;
  filename: string;
  mimeType: string;
  size: number;
  blockType: string;
  // ブラウザから Private Blob へ分けて置くチャンク数。
  chunkCount: number;
  status: NotionSaveFileStatus;
  partCount: number;
  uploadedParts: number;
};
