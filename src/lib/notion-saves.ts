import { getOrCreateAnonymousUser } from "@/lib/auth";
import {
  getNotionFileValidationError,
  getNotionStagingPrefix,
  isNotionImageFilename,
  NOTION_MAX_DRAFT_FILES,
  NOTION_MAX_DRAFT_TOTAL_BYTES,
  NOTION_MAX_FILE_BYTES,
} from "@/lib/notion-files";
import type { NotionPageBlock } from "@/lib/notion";
import { deleteNotionStagingPrefix } from "@/lib/notion-staging";
import { prisma } from "@/lib/prisma";

// 下書き 1 件に載せられる本文の合計文字数。Notion のブロック数を無制限にしないための上限。
export const MAX_NOTION_DRAFT_TEXT_CHARS = 200_000;
export const MAX_NOTION_DRAFT_TITLE_CHARS = 2000;

// DB に保存するブロック。ファイルは NotionSaveFile の id で参照する。
export type StoredNotionSaveBlock =
  | { type: "text"; text: string }
  | { type: "file"; fileId: string };

export type ParsedNotionSave = {
  blocks: Array<{ type: "text"; text: string } | { type: "file"; fileIndex: number }>;
  files: Array<{
    filename: string;
    mimeType: string;
    size: number;
    blockType: "image" | "file";
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// 入力ブロックを検証し、ファイルは DB 登録前の一覧へ、本文は並び順のまま取り出す。
export function parseNotionSaveBlocks(
  value: unknown,
  maxFileUploadBytes: number,
): { ok: true; parsed: ParsedNotionSave } | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: "Content is required." };
  }

  const blocks: ParsedNotionSave["blocks"] = [];
  const files: ParsedNotionSave["files"] = [];
  let totalTextChars = 0;
  let totalBytes = 0;

  for (const raw of value) {
    if (!isRecord(raw)) {
      return { ok: false, error: "Content is invalid." };
    }

    if (raw.type === "text") {
      if (typeof raw.text !== "string") {
        return { ok: false, error: "Content is invalid." };
      }

      const text = raw.text.trim();
      if (!text) continue;

      totalTextChars += text.length;
      if (totalTextChars > MAX_NOTION_DRAFT_TEXT_CHARS) {
        return { ok: false, error: "Content is too long." };
      }

      blocks.push({ type: "text", text });
      continue;
    }

    if (raw.type === "file") {
      const filename = typeof raw.filename === "string" ? raw.filename.trim() : "";
      const mimeType = typeof raw.mimeType === "string" ? raw.mimeType.trim() : "";
      const size = typeof raw.size === "number" ? raw.size : Number.NaN;

      if (!Number.isSafeInteger(size) || size > NOTION_MAX_FILE_BYTES) {
        return { ok: false, error: `Unsupported file size: ${filename || "file"}` };
      }

      const validationError = getNotionFileValidationError(
        { filename, size },
        maxFileUploadBytes,
      );

      if (validationError) {
        return { ok: false, error: validationError };
      }

      totalBytes += size;
      if (totalBytes > NOTION_MAX_DRAFT_TOTAL_BYTES) {
        return { ok: false, error: "Attachments are too large in total." };
      }

      if (files.length >= NOTION_MAX_DRAFT_FILES) {
        return {
          ok: false,
          error: `Up to ${NOTION_MAX_DRAFT_FILES} attachments per save.`,
        };
      }

      blocks.push({ type: "file", fileIndex: files.length });
      files.push({
        filename,
        mimeType: mimeType || "application/octet-stream",
        size,
        blockType: isNotionImageFilename(filename) ? "image" : "file",
      });
      continue;
    }

    return { ok: false, error: "Content is invalid." };
  }

  if (blocks.length === 0) {
    return { ok: false, error: "Add text or a file before saving." };
  }

  return { ok: true, parsed: { blocks, files } };
}

// 保存成功・取消のタイミングで一時保管を消す。
// DB 側の保管先も空にして、期限切れ回収の対象から外す。
export async function releaseNotionStaging(saveId: string) {
  await deleteNotionStagingPrefix(getNotionStagingPrefix(saveId));
  await prisma.notionSaveFile.updateMany({
    where: { saveId },
    data: { stagingPrefix: null },
  });
}

// 所有者の一致まで含めて下書きを読み出す。他人の保存処理は見つからない扱いにする。
export async function loadOwnedNotionSave(saveId: string) {
  const user = await getOrCreateAnonymousUser();

  return prisma.notionSave.findFirst({
    where: { id: saveId, userId: user.id },
    include: { files: true },
  });
}

export function parseStoredBlocks(value: unknown): StoredNotionSaveBlock[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((raw): StoredNotionSaveBlock[] => {
    if (!isRecord(raw)) return [];

    if (raw.type === "text" && typeof raw.text === "string") {
      return [{ type: "text", text: raw.text }];
    }

    if (raw.type === "file" && typeof raw.fileId === "string") {
      return [{ type: "file", fileId: raw.fileId }];
    }

    return [];
  });
}

// 保存済みのブロック列を Notion へ送る形に戻す。転送が終わっていないファイルは含めない。
export function buildOrderedNotionBlocks(
  blocks: StoredNotionSaveBlock[],
  filesById: Map<string, { filename: string; blockType: string; notionFileUploadId: string | null }>,
): NotionPageBlock[] {
  return blocks.flatMap((block): NotionPageBlock[] => {
    if (block.type === "text") {
      return [{ type: "text", text: block.text }];
    }

    const file = filesById.get(block.fileId);

    if (!file?.notionFileUploadId) return [];

    return [
      {
        type: "file",
        filename: file.filename,
        fileUploadId: file.notionFileUploadId,
        blockType: file.blockType === "image" ? "image" : "file",
      },
    ];
  });
}

export function serializeNotionSaveFile(file: {
  id: string;
  filename: string;
  mimeType: string;
  size: bigint;
  blockType: string;
  status: string;
  stagingChunkCount: number;
  partCount: number;
  uploadedParts: number;
}) {
  return {
    fileId: file.id,
    filename: file.filename,
    mimeType: file.mimeType,
    // 5 GiB までなので Number で正確に表現できる。
    size: Number(file.size),
    blockType: file.blockType,
    status: file.status,
    chunkCount: file.stagingChunkCount,
    partCount: file.partCount,
    uploadedParts: file.uploadedParts,
  };
}
