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
};

// テキスト抽出結果の最大文字数。大きなファイルでプロンプトが膨らみすぎるのを防ぐ。
const MAX_TEXT_CHARS = 120_000;
// 1 回の送信で受け付けるファイル数の上限。
export const MAX_UPLOAD_FILES = 5;
// 1 ファイルあたりの最大サイズ。
export const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;
// 複数ファイル合計の最大サイズ。
export const MAX_UPLOAD_TOTAL_BYTES = 20 * 1024 * 1024;
// multipart リクエスト全体の最大サイズ。フォーム境界やメタ情報も含むため合計上限より少し大きい。
export const MAX_MULTIPART_REQUEST_BYTES = 25 * 1024 * 1024;

// MIME type が曖昧でもテキストとして読める拡張子。
const TEXT_EXTENSIONS = [".md", ".markdown", ".json", ".csv", ".tsv", ".txt"];

export class AttachmentValidationError extends Error {
  // 添付エラーは基本的に payload too large として扱う。呼び出し側で必要なら上書きできる。
  status = 413;
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
  // 画像は image/* の MIME type で判定する。対応モデルでは vision 入力として扱う。
  return file.type.startsWith("image/");
}

function isSupportedFile(file: File) {
  // 現在の添付対応範囲。ここに含まれない形式は読み込み前に拒否する。
  return isTextLike(file) || isPdf(file) || isImageFile(file);
}

export function validateAttachmentFiles(files: File[]) {
  // ファイル内容を読み込む前に、数・種類・単体サイズ・合計サイズを確認する。
  // 重い PDF 解析や画像保存に入る前に弾くことで、API の負荷と想定外の入力を抑える。
  if (files.length > MAX_UPLOAD_FILES) {
    throw new AttachmentValidationError(`Upload up to ${MAX_UPLOAD_FILES} files at a time.`);
  }

  let totalBytes = 0;

  for (const file of files) {
    // 合計サイズの検査用に、各ファイルサイズを足し込む。
    totalBytes += file.size;

    if (!isSupportedFile(file)) {
      throw new AttachmentValidationError(`Unsupported file type: ${file.name}`);
    }

    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      throw new AttachmentValidationError(`File is too large: ${file.name}`);
    }
  }

  if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) {
    throw new AttachmentValidationError("Total upload size is too large.");
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

  if (!Number.isFinite(contentLength)) {
    throw new AttachmentValidationError("Request body size is invalid.");
  }

  if (contentLength > MAX_MULTIPART_REQUEST_BYTES) {
    throw new AttachmentValidationError("Request body is too large.");
  }
}

export async function prepareAttachments(files: File[]) {
  // 添付をモデル入力用と履歴保存用の両方に加工する。
  // テキスト/PDF は本文抽出、画像はモデル入力用 data URL と再表示用の保存パスを作る。
  const attachments: PreparedAttachment[] = [];

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
      const { writeStoredImage } = await import("@/lib/storage");
      base.imageStoragePath = await writeStoredImage(buffer, base.mimeType);
      base.imageInputDataUrl = `data:${base.mimeType};base64,${buffer.toString("base64")}`;
    }

    // 加工済み添付として、呼び出し元の API へ返す。
    attachments.push(base);
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
