import { answerFileName, extractLeadingHeadingTitle, fitMarkdownBlocksToNote } from "@/lib/answer-export";
import { blocksToMarkdown } from "@/lib/note-markdown";
import { unwrapColumns } from "@/lib/note-columns";
import { mentionText } from "@/lib/note-mention";
import type { WhiteboardMetaMap } from "@/lib/whiteboard/frames";
import type { NoteContent } from "@/types/notes";

// 1 回の取り込みで受け付ける Markdown ファイル数と容量の上限（Vercel の 4.5 MB リクエスト上限の内側に収める）。
export const MAX_IMPORT_FILES = 20;
export const MAX_IMPORT_FILE_BYTES = 1024 * 1024;
export const MAX_IMPORT_TOTAL_BYTES = 4 * 1024 * 1024;

export const IMPORT_FILE_EXTENSIONS = [".md", ".markdown", ".txt"] as const;

export function isImportableMarkdownFile(name: string) {
  const lower = name.trim().toLowerCase();
  return IMPORT_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// ファイル名から拡張子を取り除いてフォールバックの題名にする。
export function titleFromFileName(name: string) {
  const base = name.replace(/^.*[\\/]/, "").trim();
  const stripped = base.replace(/\.(?:md|markdown|txt)$/i, "").trim();
  return stripped || "Untitled";
}

const LIST_BLOCK_TYPES = new Set(["bulletListItem", "numberedListItem", "checkListItem", "toggleListItem"]);

// blocksToMarkdown はモデル向けにブロックを 1 行ずつ詰めて書く。そのままファイルにすると、他のアプリでは
// 続く段落が 1 つにまとまり、段落直後の --- が見出しになる。書き出しでは最上位のブロックを空行で区切り、
// 同じリストの項目が続く所だけ詰める。
// 「@」メンションの [@名前](page:ID) は他のアプリでは開けないリンクになるので、書き出しではメンションの要素だけを「@名前」の文字にする
// （本文やコードに書かれた同じ形の文字はそのまま）。
function mentionsAsText(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(mentionsAsText);
  if (!value || typeof value !== "object") return value;
  const node = value as Record<string, unknown>;
  if (node.type === "mention" && node.props && typeof node.props === "object") {
    return { type: "text", text: mentionText(node.props as Record<string, unknown>), styles: {} };
  }
  return Object.fromEntries(Object.entries(node).map(([key, entry]) => [key, key === "props" ? entry : mentionsAsText(entry)]));
}

function portableMarkdown(blocks: unknown, whiteboards?: WhiteboardMetaMap): string {
  if (!Array.isArray(blocks)) return "";
  let out = "";
  let previousType: unknown;
  // 段組みは外し、段の中のブロックも最上位のブロックと同じように空行で区切る。
  for (const block of unwrapColumns(blocks)) {
    const text = blocksToMarkdown([mentionsAsText(block)], 0, undefined, { portable: true, whiteboards }).trimEnd();
    if (!text) continue;
    const type = (block as { type?: unknown } | null)?.type;
    const sameList = LIST_BLOCK_TYPES.has(type as string) && type === previousType;
    out += out ? (sameList ? "\n" : "\n\n") + text : text;
    previousType = type;
  }
  return out;
}

// ノート 1 篇を「# 題名 + 本文」の Markdown ファイルへ書き出す。
export function noteToMarkdownFile(
  note: { title: string; blocks: unknown },
  options?: { whiteboards?: WhiteboardMetaMap },
): { fileName: string; markdown: string } {
  const cleanTitle = note.title.replace(/[\r\n]+/g, " ").trim() || "Untitled";
  const body = portableMarkdown(note.blocks, options?.whiteboards);
  // 見出しの末尾の # は「閉じる記号」として読まれて消える。題名が # で終わるときは、閉じる記号を 1 つ足して題名の # を残す。
  // 題名の中の * や _ などは、他のアプリで書式として読まれないよう \ を付ける（取り込みで外す）。
  const escaped = cleanTitle.replace(/[\\`*_[\]<>~]/g, "\\$&");
  const heading = escaped.endsWith("#") ? `# ${escaped} #` : `# ${escaped}`;
  const markdown = body ? `${heading}\n\n${body}\n` : `${heading}\n`;
  return {
    fileName: answerFileName(cleanTitle || "note"),
    markdown,
  };
}

// 取り込む Markdown 文字列からノート用の題名とブロックを作る。
// 先頭に「# 見出し」があればそれを題名にして本文から取り除き、無ければファイル名を使う。
export function markdownFileToNoteContent(fileName: string, rawMarkdown: string): { content: NoteContent; truncated: boolean } {
  // UTF-8 BOM を取り除き、NUL 文字は落とす。
  const cleaned = rawMarkdown.replace(/^\uFEFF/, "").replace(/\u0000/g, "");
  const fallback = titleFromFileName(fileName);
  const { title, body } = extractLeadingHeadingTitle(cleaned, fallback);
  const { blocks, truncated } = fitMarkdownBlocksToNote(title, body);
  return {
    content: {
      title,
      icon: null,
      cover: null,
      coverPosition: null,
      blocks: blocks as NoteContent["blocks"],
    },
    truncated,
  };
}
