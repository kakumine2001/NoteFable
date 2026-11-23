import { isSupportedImageMimeType } from "@/lib/image-types";
import { MAX_UPLOAD_FILES, MAX_UPLOAD_FILE_BYTES, MAX_UPLOAD_TOTAL_BYTES, MAX_MULTIPART_REQUEST_BYTES } from "@/lib/upload-limits";
import { msg, fmt } from "@/lib/i18n/translate";
export { MAX_UPLOAD_FILES, MAX_UPLOAD_FILE_BYTES, MAX_UPLOAD_TOTAL_BYTES, MAX_MULTIPART_REQUEST_BYTES } from "@/lib/upload-limits";

export type PreparedAttachment = {
  // 元ファイル名。DB 保存とモデルへ渡すファイル境界の説明に使う。
  filename: string;
  // ブラウザから受け取った MIME type。未設定時は呼び出し側で application/octet-stream にする。
  mimeType: string;
  // 元ファイルサイズ。アップロード制限と添付表示で使う。
  size: number;
  // テキスト/PDF から抽出した本文。モデル入力用の追加コンテキストになる。
  extractedText?: string;
  // 画像入力対応モデルへ渡す data URL。DB へは保存せず、このリクエスト内だけで使う。
  imageInputDataUrl?: string;
  // 保存済み画像の相対パス。履歴再表示時に添付画像 API から読む。
  imageStoragePath?: string;
  // Size of the provider input copy; the saved size above always describes the original.
  imageInputBytes?: number;
};

// テキスト抽出結果の最大文字数。大きなファイルでプロンプトが膨らみすぎるのを防ぐ。
const MAX_TEXT_CHARS = 120_000;

// MIME type が曖昧でもテキストとして読める拡張子。
const TEXT_EXTENSIONS = [".md", ".markdown", ".json", ".csv", ".tsv", ".txt"];

export class AttachmentValidationError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function isTextLike(file: File) {
  // text/* の MIME type または許可した拡張子なら、UTF-8 テキストとして抽出対象にする。
  const name = file.name.toLowerCase();
  return (
    file.type.startsWith("text/") ||
    TEXT_EXTENSIONS.some((extension) => name.endsWith(extension))
  );
}

function isPdf(file: File) {
  // ブラウザや OS によって MIME type が空の場合があるため、拡張子でも PDF 判定する。
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function isImageFile(file: File) {
  // Responses API が受け付ける画像形式だけを vision 入力として扱う。
  return isSupportedImageMimeType(file.type);
}

function isSupportedFile(file: File) {
  // 現在の添付対応範囲。ここに含まれない形式は読み込み前に拒否する。
  return isTextLike(file) || isPdf(file) || isImageFile(file);
}

export function validateAttachmentFiles(files: File[]) {
  // ファイル内容を読み込む前に、数・種類・単体サイズ・合計サイズを確認する。
  // 重い PDF 解析や画像保存に入る前に弾くことで、API の負荷と想定外の入力を抑える。
  if (files.length > MAX_UPLOAD_FILES) {
    throw new AttachmentValidationError(
      fmt("Upload up to {max} files at a time.", { max: MAX_UPLOAD_FILES }),
      413,
    );
  }

  let totalBytes = 0;

  for (const file of files) {
    // 合計サイズの検査用に、各ファイルサイズを足し込む。
    totalBytes += file.size;

    if (!isSupportedFile(file)) {
      throw new AttachmentValidationError(fmt("Unsupported file type: {name}", { name: file.name }), 415);
    }

    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      throw new AttachmentValidationError(fmt("File is too large: {name}", { name: file.name }), 413);
    }
  }

  if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) {
    throw new AttachmentValidationError(msg("Total upload size is too large."), 413);
  }
}

export function validateMultipartRequestSize(request: Request) {
  // multipart の formData() は本文全体の解析が必要になる。
  // content-length が分かる場合は先に見て、明らかに大きいリクエストを早めに拒否する。
  const rawContentLength = request.headers.get("content-length");

  if (!rawContentLength) {
    return;
  }

  const contentLength = Number(rawContentLength);

  if (!/^\d+$/.test(rawContentLength) || !Number.isSafeInteger(contentLength)) {
    throw new AttachmentValidationError(msg("Request body size is invalid."));
  }

  if (contentLength > MAX_MULTIPART_REQUEST_BYTES) {
    throw new AttachmentValidationError(msg("Request body is too large."), 413);
  }
}

// owner を渡すと、保存する画像を持ち主の容量に数える（上限なら StorageLimitError で、それまでに保存した画像は消す）。
export async function prepareAttachments(files: File[], claudeImageMaxBytes?: number, owner?: import("@/lib/stored-files").StorageOwner) {
  // 添付をモデル入力用と履歴保存用の両方に加工する。
  // テキスト/PDF は本文抽出、画像はモデル入力用 data URL と再表示用の保存パスを作る。
  const attachments: PreparedAttachment[] = [];
  const savedImagePaths: string[] = [];

  try {
    for (const file of files) {
      // 空ファイルはモデルにも履歴にも有用な情報がないため無視する。
      if (file.size === 0) continue;

      // File から Node.js の Buffer に変換し、テキスト抽出や画像保存で使う。
      const buffer = Buffer.from(await file.arrayBuffer());
      // どの種類の添付でも共通して DB に残す基本情報。
      const base: PreparedAttachment = {
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
      };

      if (isTextLike(file)) {
        // テキスト系は UTF-8 として読み、プロンプト上限に合わせて切り詰める。
        base.extractedText = buffer.toString("utf8").slice(0, MAX_TEXT_CHARS);
      } else if (isPdf(file)) {
        // PDF は pdf-parse を遅延 import し、PDF 添付がない通常送信では読み込まない。
        const { PDFParse } = await import("pdf-parse");
        // parser は明示的な destroy が必要なので finally で解放する。
        const parser = new PDFParse({ data: buffer });
        try {
          const parsed = await parser.getText();
          base.extractedText = parsed.text.slice(0, MAX_TEXT_CHARS);
        } finally {
          await parser.destroy();
        }
      } else if (isImageFile(file)) {
        // 画像は履歴表示用に保存しつつ、今回のモデル入力には base64 data URL として渡す。
        const input = claudeImageMaxBytes
          ? await (await import("@/lib/claude-image")).prepareClaudeImage(buffer, base.mimeType, claudeImageMaxBytes)
          : { buffer, mimeType: base.mimeType };
        base.imageInputBytes = input.buffer.byteLength;
        base.imageInputDataUrl = `data:${input.mimeType};base64,${input.buffer.toString("base64")}`;
        // Decode/optimize before storing so invalid images never create orphan originals.
        if (owner) {
          const [{ newChatImagePath }, { storeFile }] = await Promise.all([import("@/lib/storage"), import("@/lib/stored-files")]);
          base.imageStoragePath = await storeFile(owner, { path: newChatImagePath(base.mimeType), kind: "CHAT_IMAGE", buffer, mimeType: base.mimeType });
        } else {
          const { writeStoredImage } = await import("@/lib/storage");
          base.imageStoragePath = await writeStoredImage(buffer, base.mimeType);
        }
        savedImagePaths.push(base.imageStoragePath);
      }

      // 加工済み添付として、呼び出し元の API へ返す。
      attachments.push(base);
    }
  } catch (error) {
    if (savedImagePaths.length) {
      if (owner) {
        // 記録のある画像は、ファイルと行を一緒に片付ける（消せなければ後片付けがやり直す）。
        const { discardStoredFiles } = await import("@/lib/stored-files");
        await discardStoredFiles(savedImagePaths).catch((reason: unknown) => console.error("Failed to clean up uncommitted attachment images.", reason));
      } else {
        const { deleteStoredImage } = await import("@/lib/storage");
        const cleanup = await Promise.allSettled(savedImagePaths.map((storagePath) => deleteStoredImage(storagePath)));
        for (const result of cleanup) {
          if (result.status === "rejected") console.error("Failed to clean up an uncommitted attachment image.", result.reason);
        }
      }
    }
    throw error;
  }

  return attachments;
}

export function buildAttachmentPrompt(attachments: PreparedAttachment[]) {
  // モデルに読ませる必要があるのは、添付から抽出できたテキストだけ。
  // ファイル名と MIME type も添えて、複数ファイルの境界が分かる形で今回のプロンプトへ差し込む。
  const textBlocks = attachments
    .filter((attachment) => attachment.extractedText)
    .map(
      (attachment) =>
        `File: ${attachment.filename}\nType: ${attachment.mimeType}\nContent:\n${attachment.extractedText}`,
    );

  if (!textBlocks.length) return "";

  return `The user uploaded these files for this turn. Use them as context when helpful.\n\n${textBlocks.join(
    "\n\n---\n\n",
  )}`;
}
