import { msg } from "@/lib/i18n/translate";
import type { Deck } from "@/lib/slides/model";

// PPTX 取り込みの共通の型と上限値（docs/architecture/slides.md の「PPTX 导入」）。
// ブラウザ側だけで解析・変換するため、大きな ZIP や異常な画像でメモリを使い切らない上限をここで揃える。

export const MAX_PPTX_FILE_BYTES = 50 * 1024 * 1024; // 50 MiB
export const MAX_PPTX_SLIDES = 200;
// 解凍後の合計バイト数の硬上限（ZIP 爆弾対策。ヘッダーの申告値ではなく、実際に解凍したバイト数で数える）。
export const MAX_PPTX_UNCOMPRESSED_BYTES = 160 * 1024 * 1024; // 160 MiB
export const MAX_PPTX_ZIP_ENTRIES = 5_000;
export const MAX_PPTX_XML_ENTRY_BYTES = 10 * 1024 * 1024; // 10 MiB
export const MAX_PPTX_MEDIA_ENTRY_BYTES = 32 * 1024 * 1024; // 32 MiB
// 1 枚の画像の画素数と辺の硬上限（デコードする前に画像ヘッダーから確かめる）。
export const MAX_PPTX_IMAGE_PIXELS = 25_000_000; // 25 MP
export const MAX_PPTX_IMAGE_DIMENSION = 10_000;
// 1 枚の画像にアップロード前に縮小するときの長い辺の上限。
export const MAX_PPTX_IMAGE_SIDE = 2_560;

export type PptxErrorCode =
  | "not_pptx"
  | "file_too_large"
  | "invalid_archive"
  | "unsafe_archive"
  | "zip_too_large"
  | "too_many_slides"
  | "no_slides"
  | "deck_too_large"
  | "aborted";

export class PptxImportError extends Error {
  readonly code: PptxErrorCode;
  constructor(code: PptxErrorCode, message: string) {
    super(message);
    this.name = "PptxImportError";
    this.code = code;
  }
}

export const PPTX_ERROR_MESSAGES = {
  notPptx: msg("Choose a PowerPoint (.pptx) file."),
  fileTooLarge: msg("This PowerPoint file is too large to import (max 50 MB)."),
  invalidArchive: msg("Could not read this PowerPoint file."),
  unsafeArchive: msg("This PowerPoint file contains unsupported or unsafe XML content."),
  zipTooLarge: msg("This PowerPoint file expands beyond the safety limit and cannot be imported."),
  tooManySlides: msg("This presentation has too many slides to import (max 200)."),
  noSlides: msg("This PowerPoint file has no slides to import."),
  aborted: msg("Import cancelled."),
} as const;

export type PptxUnsupportedKind =
  | "chart"
  | "smartart"
  | "video"
  | "audio"
  | "animation"
  | "transition"
  | "unsupportedImage"
  | "externalImage"
  | "oversizedImage"
  | "ole";

export type PptxSlideIssue = {
  kind: PptxUnsupportedKind;
  count: number;
  previewCount: number;
};

export type PptxSlideReport = {
  slideNumber: number;
  slideTitle?: string;
  issues: PptxSlideIssue[];
};

export type PptxImportReport = {
  slideCount: number;
  uploadedImageCount: number;
  slides: PptxSlideReport[];
  totalUnsupported: number;
  totalPreviews: number;
};

export type ImageCropRect = {
  // 0..1 の割合（OOXML の srcRect は 1/100000 単位）。
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type PendingPptxImage = {
  /** 解析結果の中で同じ画像+切り抜きを重複アップロードしないための鍵。 */
  assetKey: string;
  /** ZIP 内の正規化パス。 */
  zipPath: string;
  /** 先頭バイトから判定した MIME（image/png | image/jpeg | image/gif | image/webp）。 */
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  width: number;
  height: number;
  bytes: Uint8Array;
  crop?: ImageCropRect;
};

export type ParsedPptx = {
  title: string;
  deck: Deck;
  /** スライド要素の仮の src（`pptx-asset:<assetKey>`）を実アップロードする一覧。 */
  images: PendingPptxImage[];
  report: PptxImportReport;
};

export const PPTX_ASSET_PREFIX = "pptx-asset:";

export type XmlParserLike = {
  parseFromString: (xml: string, type: "application/xml" | "text/xml") => Document;
};
