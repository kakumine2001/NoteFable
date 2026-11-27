import { CANVAS_TOO_LARGE, validateCanvasData } from "@/lib/canvas-document";
import { msg } from "@/lib/i18n/translate";
import { parseNoteFileUrl } from "@/lib/note-file-keys";
import { normalizeDeck, type Deck } from "@/lib/slides/model";
import { extensionForMime, preparePptxImageBlob } from "@/lib/slides/pptx/image-probe";
import { parsePptx } from "@/lib/slides/pptx/parse";
import {
  MAX_PPTX_FILE_BYTES,
  PPTX_ASSET_PREFIX,
  PPTX_ERROR_MESSAGES,
  PptxImportError,
  type PendingPptxImage,
  type PptxImportReport,
  type XmlParserLike,
} from "@/lib/slides/pptx/types";
import { storageLimitFromUpload } from "@/lib/storage-limit-client";
import type { NotePageSummary } from "@/types/notes";

// PPTX 取り込みの実行フロー：
// 1. 入力の拡張子と上限（50 MB）を確かめ、ブラウザ内で解析（ZIP 爆弾・外部参照・画素上限を検査）。
// 2. 画像を重複排除して note-files へアップロード（容量上限 413 は通常の storageLimit 通知へ流す）。
// 3. 最終の Deck を normalizeDeck + validateCanvasData（2 MiB 上限）で検証してから POST /api/pages で 1 回だけ建页。
// 4. 建页が成功する前に中止・失敗したら、途中でアップロード済みの note-files を DELETE /api/pages/files で片付ける。

export type PptxImportStage = "parsing" | "uploading" | "saving";

export type PptxImportProgress = {
  stage: PptxImportStage;
  done: number;
  total: number;
};

export type PptxImportResult = {
  page: NotePageSummary;
  report: PptxImportReport;
};

export type ImportPptxOptions = {
  groupId?: string | null;
  parentId?: string | null;
  signal?: AbortSignal;
  onProgress?: (progress: PptxImportProgress) => void;
  /** テスト用差し替え口（既定は実ブラウザ API を使う）。 */
  xmlParser?: XmlParserLike;
  maxUncompressedBytes?: number;
  prepareImage?: (image: PendingPptxImage) => Promise<{ blob: Blob; mimeType: PendingPptxImage["mimeType"] }>;
  uploadFile?: (blob: Blob, fileName: string, mimeType: string, signal?: AbortSignal) => Promise<{ url: string }>;
  cleanupFiles?: (keys: string[]) => Promise<void>;
  createPage?: (body: { kind: "slides"; title: string; icon: null; data: Deck; groupId?: string; parentId?: string }, signal?: AbortSignal) => Promise<NotePageSummary>;
};

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export function isPptxFile(file: Pick<File, "name" | "type">): boolean {
  if (/\.pptx$/i.test(file.name)) return true;
  if (file.type === PPTX_MIME) return true;
  return false;
}

async function defaultUploadFile(blob: Blob, fileName: string, mimeType: string, signal?: AbortSignal): Promise<{ url: string }> {
  const form = new FormData();
  form.append("file", new File([blob], fileName, { type: mimeType }));
  const response = await fetch("/api/pages/files", { method: "POST", body: form, signal });
  const data = await response.json().catch(() => null) as { url?: string; error?: string } | null;
  const storage = storageLimitFromUpload(response.status, data);
  if (storage) throw storage;
  if (!response.ok || !data?.url) throw new Error(data?.error || msg("Upload failed. Try again."));
  return { url: data.url };
}

async function defaultCleanupFiles(keys: string[]): Promise<void> {
  if (!keys.length) return;
  const chunkSize = 100;
  for (let i = 0; i < keys.length; i += chunkSize) {
    const batch = keys.slice(i, i + chunkSize);
    await fetch("/api/pages/files", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: batch }),
      keepalive: true,
    }).catch(() => {});
  }
}

async function defaultCreatePage(
  body: { kind: "slides"; title: string; icon: null; data: Deck; groupId?: string; parentId?: string },
  signal?: AbortSignal,
): Promise<NotePageSummary> {
  const response = await fetch("/api/pages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await response.json().catch(() => null) as { page?: NotePageSummary; error?: string } | null;
  if (!response.ok || !data?.page?.id) {
    throw new Error(data?.error || msg("Could not import this PowerPoint file. Try again."));
  }
  return data.page;
}

function replaceAssetUrls(deck: Deck, urlByKey: Map<string, string>): Deck {
  return {
    ...deck,
    slides: deck.slides.map((slide) => ({
      ...slide,
      elements: slide.elements.map((element) => {
        if (element.type !== "image" || !element.src.startsWith(PPTX_ASSET_PREFIX)) return element;
        const key = element.src.slice(PPTX_ASSET_PREFIX.length);
        return { ...element, src: urlByKey.get(key) ?? "" };
      }),
    })),
  };
}

export async function importPptxFile(file: File, options: ImportPptxOptions = {}): Promise<PptxImportResult> {
  if (!isPptxFile(file)) {
    throw new PptxImportError("not_pptx", PPTX_ERROR_MESSAGES.notPptx);
  }
  if (file.size > MAX_PPTX_FILE_BYTES) {
    throw new PptxImportError("file_too_large", PPTX_ERROR_MESSAGES.fileTooLarge);
  }
  if (options.signal?.aborted) {
    throw new PptxImportError("aborted", PPTX_ERROR_MESSAGES.aborted);
  }

  options.onProgress?.({ stage: "parsing", done: 0, total: 1 });
  const buffer = await file.arrayBuffer();
  const parsed = await parsePptx(buffer, {
    fileName: file.name,
    xmlParser: options.xmlParser,
    maxUncompressedBytes: options.maxUncompressedBytes,
    signal: options.signal,
    onSlideProgress: (done, total) => options.onProgress?.({ stage: "parsing", done, total }),
  });

  const prepareImage = options.prepareImage ?? preparePptxImageBlob;
  const uploadFile = options.uploadFile ?? defaultUploadFile;
  const cleanupFiles = options.cleanupFiles ?? defaultCleanupFiles;
  const createPage = options.createPage ?? defaultCreatePage;

  const uploadedKeys: string[] = [];
  const urlByKey = new Map<string, string>();
  let pageCreated = false;

  try {
    const totalImages = parsed.images.length;
    for (let i = 0; i < totalImages; i += 1) {
      if (options.signal?.aborted) throw new PptxImportError("aborted", PPTX_ERROR_MESSAGES.aborted);
      options.onProgress?.({ stage: "uploading", done: i, total: totalImages });
      const image = parsed.images[i];
      const prepared = await prepareImage(image);
      const baseName = image.zipPath.split("/").pop()?.replace(/\.[^.]+$/, "") || `slide-image-${i + 1}`;
      const fileName = `${baseName}.${extensionForMime(prepared.mimeType)}`;
      const uploaded = await uploadFile(prepared.blob, fileName, prepared.mimeType, options.signal);
      urlByKey.set(image.assetKey, uploaded.url);
      const keyParts = parseNoteFileUrl(uploaded.url);
      if (keyParts && keyParts !== "empty") uploadedKeys.push(keyParts.path);
    }
    if (totalImages > 0) {
      options.onProgress?.({ stage: "uploading", done: totalImages, total: totalImages });
    }

    if (options.signal?.aborted) throw new PptxImportError("aborted", PPTX_ERROR_MESSAGES.aborted);
    options.onProgress?.({ stage: "saving", done: 0, total: 1 });

    // 最終の本体を正規化し、サーバーと同じ 2 MiB 上限と構造検査を通す。
    const finalDeck = normalizeDeck(replaceAssetUrls(parsed.deck, urlByKey));
    try {
      validateCanvasData("slides", finalDeck);
    } catch (error) {
      if (error instanceof Error && error.message === CANVAS_TOO_LARGE) {
        throw new PptxImportError("deck_too_large", CANVAS_TOO_LARGE);
      }
      throw error;
    }

    const page = await createPage({
      kind: "slides",
      title: parsed.title,
      icon: null,
      data: finalDeck,
      ...(options.parentId ? { parentId: options.parentId } : options.groupId ? { groupId: options.groupId } : {}),
    }, options.signal);
    pageCreated = true;
    options.onProgress?.({ stage: "saving", done: 1, total: 1 });

    return {
      page,
      report: {
        ...parsed.report,
        uploadedImageCount: urlByKey.size,
      },
    };
  } catch (error) {
    if (!pageCreated && uploadedKeys.length > 0) {
      await cleanupFiles(uploadedKeys).catch(() => {});
    }
    if (options.signal?.aborted && !(error instanceof PptxImportError)) {
      throw new PptxImportError("aborted", PPTX_ERROR_MESSAGES.aborted);
    }
    throw error;
  }
}

export * from "@/lib/slides/pptx/types";
