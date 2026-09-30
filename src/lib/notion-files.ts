// Notion へ添付できるファイルの判定と分割計画をまとめた純粋関数群。
// 画面側の事前チェックとサーバー側の検証で同じ判定を使い、結果がずれないようにする。

// ブラウザから Private Blob への一時保管と、Notion への分割転送で共通の 1 単位。
// Notion の推奨パートサイズ（10 MB）に合わせ、1 単位が 1 パートに対応するようにする。
export const NOTION_TRANSFER_CHUNK_BYTES = 10 * 1024 * 1024;
// これ以下は分割せず単一転送（single_part）にする。
export const NOTION_SINGLE_PART_MAX_BYTES = 20 * 1024 * 1024;
// Notion の multi_part が受け付ける 1 ファイルの上限。
export const NOTION_MAX_FILE_BYTES = 5 * 1024 * 1024 * 1024;
// 無料ワークスペースの上限。API から取得できなかった場合のフォールバックに使う。
export const NOTION_FREE_PLAN_MAX_FILE_BYTES = 5 * 1024 * 1024;
// 1 回の保存で扱う添付数と合計サイズの上限。合計は一時保管領域の保護が目的。
export const NOTION_MAX_DRAFT_FILES = 20;
export const NOTION_MAX_DRAFT_TOTAL_BYTES = 5 * 1024 * 1024 * 1024;
// multi_part の part_number は 1〜1000。5 GiB を 10 MiB で割っても 512 なので収まる。
export const NOTION_MAX_PART_COUNT = 1000;

// Notion 公式の対応形式（https://developers.notion.com/guides/data-apis/working-with-files-and-media）。
// audio / document / image / video の拡張子を 1 つの集合にまとめ、ブロック種別だけ別に判定する。
const NOTION_AUDIO_EXTENSIONS = [
  "aac", "adts", "mid", "midi", "mp3", "mpga", "m4a", "m4b", "mp4",
  "oga", "ogg", "opus", "wav", "wma", "weba", "flac",
];

const NOTION_DOCUMENT_EXTENSIONS = [
  "pdf", "txt", "csv", "json", "js", "ts", "tsx", "py",
  "doc", "docx", "dot", "dotx",
  "xls", "xlsx", "xlt", "xltx",
  "ppt", "pptx", "pot", "potx",
  "rtf", "md", "html", "epub", "xml", "css",
  "odt", "ods", "odp", "ics", "yaml", "yml", "tsv",
  "zip", "gz", "tar", "7z", "bz2", "rar",
];

const NOTION_IMAGE_EXTENSIONS = [
  "gif", "heic", "jpeg", "jpg", "png", "svg", "tif", "tiff",
  "webp", "ico", "bmp", "avif", "apng",
];

const NOTION_VIDEO_EXTENSIONS = [
  "amv", "asf", "wmv", "avi", "f4v", "flv", "gifv", "m4v", "mp4",
  "mkv", "webm", "mov", "qt", "mpeg", "ogv", "3gp", "3g2",
];

const IMAGE_EXTENSION_SET = new Set(NOTION_IMAGE_EXTENSIONS);

const SUPPORTED_EXTENSION_SET = new Set([
  ...NOTION_AUDIO_EXTENSIONS,
  ...NOTION_DOCUMENT_EXTENSIONS,
  ...NOTION_IMAGE_EXTENSIONS,
  ...NOTION_VIDEO_EXTENSIONS,
]);

export type NotionUploadPlan = {
  mode: "single_part" | "multi_part";
  partCount: number;
};

// 拡張子は小文字で比較する。拡張子がないファイルは Notion 側で形式を判定できないため非対応にする。
export function getFileExtension(filename: string) {
  const match = /\.([A-Za-z0-9]+)$/.exec(filename.trim());
  return match ? match[1].toLowerCase() : "";
}

export function isSupportedNotionFilename(filename: string) {
  return SUPPORTED_EXTENSION_SET.has(getFileExtension(filename));
}

// 画像ブロック、それ以外はファイルブロックとして保存する。
export function isNotionImageFilename(filename: string) {
  return IMAGE_EXTENSION_SET.has(getFileExtension(filename));
}

// 20 MiB 以下は単一転送、それ以上は 10 MiB 単位の分割転送にする。
export function getNotionUploadPlan(size: number): NotionUploadPlan {
  if (size <= NOTION_SINGLE_PART_MAX_BYTES) {
    return { mode: "single_part", partCount: 1 };
  }

  return {
    mode: "multi_part",
    partCount: Math.ceil(size / NOTION_TRANSFER_CHUNK_BYTES),
  };
}

// 一時保管は常に 10 MiB 単位。単一転送でも 20 MiB を 1 リクエストに載せない。
export function getStagingChunkCount(size: number) {
  if (size <= 0) return 0;
  return Math.ceil(size / NOTION_TRANSFER_CHUNK_BYTES);
}

export function getStagingChunkSize(size: number, chunkIndex: number) {
  const start = chunkIndex * NOTION_TRANSFER_CHUNK_BYTES;
  return Math.min(NOTION_TRANSFER_CHUNK_BYTES, size - start);
}

// 1 パートを組み立てるのに読む一時保管チャンクの添字。
// 分割転送ではチャンクがパートに 1 対 1 で対応し、単一転送では全チャンクを連結する。
export function getNotionPartChunkIndexes(size: number, partNumber: number) {
  const plan = getNotionUploadPlan(size);

  if (plan.mode === "single_part") {
    return Array.from({ length: getStagingChunkCount(size) }, (_, index) => index);
  }

  return [partNumber - 1];
}

// 一時保管（Private Blob）のパス。画面からも同じ値を組み立てるため、
// 環境変数に依存しない純粋な関数としてここに置く。
export const NOTION_STAGING_ROOT = "notion-staging";

export function getNotionStagingPrefix(saveId: string) {
  return `${NOTION_STAGING_ROOT}/${saveId}`;
}

export function getNotionStagingChunkPath(saveId: string, fileId: string, chunkIndex: number) {
  return `${getNotionStagingPrefix(saveId)}/${fileId}/${chunkIndex}`;
}

// Notion へ実際に送れたバイト数。進捗表示に使う。
export function getNotionTransferredBytes(size: number, uploadedParts: number) {
  if (uploadedParts <= 0) return 0;

  const plan = getNotionUploadPlan(size);

  if (plan.mode === "single_part") {
    return size;
  }

  return Math.min(size, uploadedParts * NOTION_TRANSFER_CHUNK_BYTES);
}

export function formatByteSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unitIndex]}`;
}

// 画面とサーバーで共有する 1 ファイル分の検証。問題がなければ null を返す。
export function getNotionFileValidationError(
  file: { filename: string; size: number },
  maxFileUploadBytes: number,
) {
  if (!file.filename.trim()) {
    return "File name is required.";
  }

  if (!isSupportedNotionFilename(file.filename)) {
    return `Notion does not support this file type: ${file.filename}`;
  }

  if (file.size <= 0) {
    return `File is empty: ${file.filename}`;
  }

  // ワークスペース上限と Notion 自体の上限の低い方で判定する。
  const limit = Math.min(maxFileUploadBytes, NOTION_MAX_FILE_BYTES);

  if (file.size > limit) {
    return `${file.filename} is larger than the Notion limit of ${formatByteSize(limit)}.`;
  }

  return null;
}
