import { NoteValidationError } from "@/lib/note-document";
import { NOTE_FILE_TYPES, NOTE_IMAGE_EXTENSIONS, parseNoteFileUrl, safeFileName, sniffImage } from "@/lib/note-file-keys";
import { msg } from "@/lib/i18n/translate";
import { isColumnContainer } from "@/lib/note-columns";

// アップロードを受け付けるか判断し、保存する拡張子と種別を返す。画像は拡張子ではなく先頭バイトで見る。
export function classifyUpload(buffer: Buffer, originalName: string):
  { kind: "image" | "file"; extension: string } | null {
  const mime = sniffImage(buffer);
  if (mime) return { kind: "image", extension: NOTE_IMAGE_EXTENSIONS[mime] };
  const extension = safeFileName(originalName).split(".").pop()?.toLowerCase() ?? "";
  if (extension && Object.hasOwn(NOTE_FILE_TYPES, extension)) return { kind: "file", extension };
  return null;
}

// 他人のフォルダにあるファイルを、自分のノートのブロックに付けさせない。
export function assertNoteFilesOwner(blocks: unknown, userId: string, depth = 0) {
  if (!Array.isArray(blocks) || depth > 8) return;
  for (const block of blocks as { type?: unknown; props?: { url?: unknown }; children?: unknown }[]) {
    if ((block?.type === "image" || block?.type === "file") && block.props) {
      const parsed = parseNoteFileUrl(block.props.url);
      if (parsed && parsed !== "empty" && parsed.ownerId !== userId) throw new NoteValidationError(msg("This note refers to a file that is not yours."));
    }
    // 段組み・段は入れ物なので深さに数えない（validateNoteContent と同じ）。数えると段の中の深いブロックを調べ損ねる。
    assertNoteFilesOwner(block?.children, userId, isColumnContainer(block) ? depth : depth + 1);
  }
}

// 本文の画像ブロック・ファイルブロックが指すファイルの保存先（note-files/<利用者>/…）。重複は除く。
export function noteFilePaths(blocks: unknown, found = new Set<string>(), depth = 0) {
  if (!Array.isArray(blocks) || depth > 8) return [...found];
  for (const block of blocks as { type?: unknown; props?: { url?: unknown }; children?: unknown }[]) {
    if ((block?.type === "image" || block?.type === "file") && block.props) {
      const parsed = parseNoteFileUrl(block.props.url);
      if (parsed && parsed !== "empty") found.add(parsed.path);
    }
    noteFilePaths(block?.children, found, isColumnContainer(block) ? depth : depth + 1);
  }
  return [...found];
}
