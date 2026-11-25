import { isEmojiIcon } from "@/lib/emoji-icon";
import { MAX_NOTE_TITLE, NoteValidationError, uploadedCoverPath } from "@/lib/note-document";
import { parseNoteFileUrl } from "@/lib/note-file-keys";
import { fmt, msg } from "@/lib/i18n/translate";
import { isCanvasKind, type CanvasKind, type PageKind } from "@/lib/page-kinds";
import { WHITEBOARD_ELEMENT_TYPES } from "@/lib/whiteboard/scene";
import { mindmapDataOf } from "@/lib/whiteboard/mindmap/model";

// ホワイトボードとスライドの本体（NoteCanvas.data）の形、検証、検索用の文字の取り出し（docs/architecture/notes-flow.md の「白板和幻灯片的数据」）。
// エディター（#152・#149）がまだ無いので、形は外枠だけを決める：
//   ホワイトボード: { elements: [{ id, type, text?, originalText?, name?, containerId?, isDeleted?, … }], files?: { <id>: { dataURL | url, … } }, appState?: {…} }
//     （Excalidraw の scene と同じ並び。画像は note-files にアップロードし、files の dataURL / url はその URL にする）
//   スライド:       { slides: [{ id, layout?, hidden?, notes?, elements?: [{ id, … }] }], theme?: {…} }
// 要素・ページの中身（位置・色・書式など）は各エディターが決める。ここでは大きさ・ID・画像の置き方・文字だけを見る。
// このファイルは prisma を読み込まない（画面からも使う）。

const MIB = 1024 * 1024;
// 1 つのホワイトボード・スライドの本体（JSON）の上限。Vercel の受信上限 4.5 MB より十分小さくし、保存時に線の点を間引く前提の値。
export const MAX_CANVAS_BYTES: Record<CanvasKind, number> = { whiteboard: 2 * MIB, slides: 2 * MIB };
// 保存の要求本文の上限（本体の上限 + 題名などの余白）。
export const MAX_CANVAS_REQUEST_BYTES = 2 * MIB + 64 * 1024;
export const MAX_WHITEBOARD_ELEMENTS = 20_000;
export const MAX_SLIDES = 500;
export const MAX_SLIDE_ELEMENTS = 1_000;
// 演説者ノート 1 枚分の長さ。
export const MAX_SLIDE_NOTES = 20_000;
const MAX_ID_LENGTH = 120;
const MAX_TYPE_LENGTH = 64;
// JSON の入れ子の深さ。ふつうの要素は 5〜10 段ほど。深すぎるものは壊れたデータとして断る。
const MAX_DEPTH = 64;
// 検索・チャットの文脈に使う文字の合計の上限と、1 つの要素・ページの上限。
export const MAX_CANVAS_TEXT = 100_000;
const MAX_SEGMENT_TEXT = 8_000;
// 埋め込んだ画像・ファイル（data:<MIME>;base64,… や data:image/svg+xml,…）。画像は note-files にアップロードしてその URL を置く。
const INLINE_DATA_URL = /^\s*data:[a-z]+\/[a-z0-9.+-]+[;,]/i;
// 片方だけのサロゲート。PostgreSQL の jsonb は受け付けない（保存が 500 になる）ので、先に断る。
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const FILE_URL_PREFIX = "/api/pages/files?";

export type CanvasData = Record<string, unknown>;
// 本体から取り出した文字。id はホワイトボードの要素（文字が図形に付いているときは図形）、またはスライドのページ。
// index はスライドの並び順（0 から）。文字の無いスライドは segments に入らないので、何枚目かはこれで数える（古い保存には無い）。
export type CanvasSegment = { id: string; text: string; index?: number };
// filePaths は参照しているファイル（note-files）の保存先。保存のたびに使用中へ戻す（stored-files.ts の claimStoredFiles）。
export type ValidatedCanvas = { data: CanvasData; size: number; fileOwners: string[]; filePaths: string[] };

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function emptyCanvasData(kind: CanvasKind): CanvasData {
  return kind === "whiteboard" ? { elements: [] } : { slides: [] };
}

const invalid = () => new NoteValidationError(msg("This page contains invalid whiteboard or slide data."));
export const CANVAS_TOO_LARGE = msg("This page is larger than 2 MB and cannot be saved.");

// 本体全体をたどり、壊れた値・埋め込み画像・他人のファイルの参照につながるものを見る。再帰を使わない（深い JSON でもスタックを使い切らない）。
// スライドの本文・表セル・メモ・数式に書いた文字列（"data:image/png;base64,..." の引用など）は画像埋め込みとして誤拒否しない。
// src / url / dataURL / href / link などの資源参照は引き続き厳格に拒否する。
function isSlideLiteralTextField(parent: Record<string, unknown>, key: string): boolean {
  // ProseMirror のテキストノード（スライド要素には必ず id があるが、テキスト葉には id が無い）。
  if (key === "text" && parent.type === "text" && parent.id === undefined) return true;
  // 表セル（{ text: "..." }）。
  if (key === "text" && Object.keys(parent).length === 1) return true;
  // スライドの演説者メモ。
  if (key === "notes" && typeof parent.id === "string" && Array.isArray(parent.elements)) return true;
  // 数式の TeX 文字列。
  if (key === "latex" && Object.keys(parent).length === 1) return true;
  return false;
}

function scan(kind: CanvasKind, value: unknown, files: Map<string, string>) {
  const stack: { value: unknown; depth: number; literalText: boolean }[] = [{ value, depth: 0, literalText: false }];
  while (stack.length) {
    const { value: current, depth, literalText } = stack.pop()!;
    if (depth > MAX_DEPTH) throw invalid();
    if (typeof current === "string") {
      // PostgreSQL の jsonb は NUL を入れられない（保存で 500 にならないよう、先に断る）。
      if (current.includes("\u0000") || LONE_SURROGATE.test(current)) throw invalid();
      if (!literalText && INLINE_DATA_URL.test(current)) throw new NoteValidationError(msg("Images must be uploaded, not embedded in the page."));
      // 先頭の空白も URL としては同じに読まれるので、空白を飛ばして見分ける（その形は parseNoteFileUrl が断る）。
      if (current.trimStart().startsWith(FILE_URL_PREFIX)) {
        const parsed = parseNoteFileUrl(current);
        if (!parsed || parsed === "empty") throw invalid();
        files.set(parsed.path, parsed.ownerId);
      }
      continue;
    }
    if (typeof current === "number") { if (!Number.isFinite(current)) throw invalid(); continue; }
    if (current === null || typeof current === "boolean") continue;
    if (Array.isArray(current)) {
      for (const item of current) stack.push({ value: item, depth: depth + 1, literalText: false });
      continue;
    }
    if (!object(current)) throw invalid();
    for (const [key, item] of Object.entries(current)) {
      if (key.includes("\u0000") || LONE_SURROGATE.test(key)) throw invalid();
      stack.push({ value: item, depth: depth + 1, literalText: kind === "slides" && isSlideLiteralTextField(current, key) });
    }
  }
}

const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;

// 要素・ページの並び。どれも ID（重複なし）を持つオブジェクト。
function validItems(items: unknown, max: number, ids: Set<string>, { needsType = false } = {}): items is Record<string, unknown>[] {
  if (!Array.isArray(items) || items.length > max) return false;
  return items.every((item) => {
    if (!object(item) || !validId(item.id) || ids.has(item.id)) return false;
    ids.add(item.id);
    if (needsType && !(typeof item.type === "string" && item.type.length > 0 && item.type.length <= MAX_TYPE_LENGTH)) return false;
    return item.isDeleted === undefined || typeof item.isDeleted === "boolean";
  });
}

function validWhiteboard(data: Record<string, unknown>) {
  // もう一方の種類の外枠（slides）は持たない（種類を本体の形からも取り違えないように）。
  if (data.slides !== undefined) return false;
  if (!validItems(data.elements, MAX_WHITEBOARD_ELEMENTS, new Set(), { needsType: true })) return false;
  // 置ける種類だけ（埋め込み・iframe などは保存させない。src/lib/whiteboard/scene.ts の WHITEBOARD_ELEMENT_TYPES）。
  if (!(data.elements as Record<string, unknown>[]).every((element) => WHITEBOARD_ELEMENT_TYPES.has(element.type as string))) return false;
  if (data.appState !== undefined && !object(data.appState)) return false;
  if (data.files === undefined) return true;
  if (!object(data.files)) return false;
  // 画像ファイルは自分のサービスの note-files の URL だけ（埋め込みや外部 URL は置かない）。
  return Object.values(data.files).every((file) => object(file) && ["dataURL", "url"].every((key) => {
    const url = file[key];
    if (url === undefined) return true;
    const parsed = parseNoteFileUrl(url);
    return parsed !== null && parsed !== "empty";
  }));
}

function validSlides(data: Record<string, unknown>) {
  if (data.elements !== undefined) return false;
  if (!validItems(data.slides, MAX_SLIDES, new Set())) return false;
  if (data.theme !== undefined && !object(data.theme)) return false;
  const elementIds = new Set<string>();
  return (data.slides as Record<string, unknown>[]).every((slide) =>
    (slide.elements === undefined || validItems(slide.elements, MAX_SLIDE_ELEMENTS, elementIds))
    && (slide.notes === undefined || (typeof slide.notes === "string" && slide.notes.length <= MAX_SLIDE_NOTES))
    && (slide.hidden === undefined || typeof slide.hidden === "boolean")
    && (slide.layout === undefined || (typeof slide.layout === "string" && slide.layout.length <= MAX_TYPE_LENGTH))
    && (slide.transition === undefined || (typeof slide.transition === "string" && slide.transition.length <= MAX_TYPE_LENGTH)));
}

// 保存してよい本体か確かめる。大きさは JSON のバイト数。fileOwners は参照しているファイルの持ち主（保存時に本人だけか確かめる）。
export function validateCanvasData(kind: CanvasKind, value: unknown): ValidatedCanvas {
  if (!object(value)) throw invalid();
  // 深さを先に（再帰しない scan で）確かめる。深すぎる JSON は JSON.stringify がスタックを使い切って 503 になる。
  const files = new Map<string, string>();
  scan(kind, value, files);
  const size = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (size > MAX_CANVAS_BYTES[kind]) throw new NoteValidationError(CANVAS_TOO_LARGE, 413);
  if (!(kind === "whiteboard" ? validWhiteboard(value) : validSlides(value))) throw invalid();
  return { data: value, size, fileOwners: [...new Set(files.values())], filePaths: [...files.keys()] };
}

// 他人のフォルダにあるファイルを、自分のホワイトボード・スライドに置かせない。
export function assertCanvasFilesOwner(canvas: Pick<ValidatedCanvas, "fileOwners">, userId: string) {
  if (canvas.fileOwners.some((owner) => owner !== userId)) throw new NoteValidationError(msg("This page refers to a file that is not yours."));
}

// ---- 検索・意味検索・チャットの文脈に使う文字 ----

// サロゲートペアの途中で切らない（切ると jsonb に入れられない文字列になる）。
function cut(text: string, limit: number) {
  if (text.length <= limit) return text;
  const end = (text.charCodeAt(limit - 1) & 0xfc00) === 0xd800 ? limit - 1 : limit;
  return text.slice(0, end);
}

function clean(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

// オブジェクトの中の「text」キーの文字（リッチテキストの JSON も含む）を文書の順に集める。
function collectText(value: unknown, out: string[]) {
  const stack: unknown[] = [value];
  while (stack.length) {
    const current = stack.pop();
    if (Array.isArray(current)) { for (let index = current.length - 1; index >= 0; index--) stack.push(current[index]); continue; }
    if (!object(current)) continue;
    if (typeof current.text === "string") out.push(current.text);
    // スライドの数式（行内・ブロック）の TeX も検索できるようにする（ノートの数式と同じ）。
    if (current.type === "math_inline" || current.type === "math_block") {
      const attrs = current.attrs;
      if (object(attrs) && typeof attrs.latex === "string") out.push(attrs.latex);
    }
    const entries = Object.entries(current).filter(([key]) => key !== "text");
    for (let index = entries.length - 1; index >= 0; index--) stack.push(entries[index][1]);
  }
}

// 本体から、移動先の ID ごとの文字を取り出す。保存のたびにサーバーで作り、NoteCanvas.segments に入れる（線の点などは見ない）。
// ホワイトボード：消していない要素の文字（originalText か text）と枠の名前（name）。図形に付いた文字（containerId）は図形の ID にまとめる。
// スライド：ページごとに、要素の中の文字と演説者ノート。
export function extractCanvasSegments(kind: CanvasKind, data: unknown): CanvasSegment[] {
  if (!object(data)) return [];
  // 同じ ID に何万もの文字が付いても線形で済むよう、配列はその場で伸ばし、1 つの ID の上限を超えたら足さない。
  const byId = new Map<string, { texts: string[]; length: number; index?: number }>();
  const add = (id: string, text: unknown, index?: number) => {
    if (typeof text !== "string") return;
    const value = clean(text);
    if (!value) return;
    const entry = byId.get(id) ?? { texts: [], length: 0, ...(index === undefined ? {} : { index }) };
    if (!byId.has(id)) byId.set(id, entry);
    if (entry.length >= MAX_SEGMENT_TEXT) return;
    entry.texts.push(value);
    entry.length += value.length + 1;
  };
  if (kind === "whiteboard") {
    const elements = Array.isArray(data.elements) ? data.elements.filter((element) => object(element) && validId(element.id) && element.isDeleted !== true) as Record<string, unknown>[] : [];
    const ids = new Set(elements.map((element) => element.id as string));
    for (const element of elements) {
      const target = validId(element.containerId) && ids.has(element.containerId) ? element.containerId : element.id as string;
      add(target, typeof element.originalText === "string" ? element.originalText : element.text);
      add(element.id as string, element.name);
      // 思考マップで畳んだ節が預かっている子孫の文字も、その節の文字として検索・AI に渡す（開くとその節に移動する）。
      const mark = mindmapDataOf(element.customData);
      if (mark?.role === "node" && mark.stash) {
        for (const stashed of mark.stash) add(element.id as string, typeof stashed.originalText === "string" ? stashed.originalText : stashed.text);
      }
    }
  } else {
    const slides = Array.isArray(data.slides) ? data.slides.filter((slide) => object(slide) && validId(slide.id)) as Record<string, unknown>[] : [];
    slides.forEach((slide, index) => {
      const texts: string[] = [];
      collectText(slide.elements, texts);
      for (const text of texts) add(slide.id as string, text, index);
      add(slide.id as string, slide.notes, index);
    });
  }
  const segments: CanvasSegment[] = [];
  let total = 0;
  for (const [id, { texts, index }] of byId) {
    const text = cut(texts.join(" "), MAX_SEGMENT_TEXT);
    if (total + text.length > MAX_CANVAS_TEXT) break;
    total += text.length;
    segments.push({ id, text, ...(index === undefined ? {} : { index }) });
  }
  return segments;
}

// DB から読んだ segments を確かめる（壊れた要素は捨てる）。
export function parseCanvasSegments(value: unknown): CanvasSegment[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is CanvasSegment => object(entry) && typeof entry.id === "string" && typeof entry.text === "string")
    .map((entry) => (Number.isSafeInteger(entry.index) && (entry.index as number) >= 0 ? { id: entry.id, text: entry.text, index: entry.index } : { id: entry.id, text: entry.text }));
}

// 検索のブロック用の関数（search.ts・note-embeddings.ts の walkBlocks / blockText / extractNoteChunks）にそのまま渡せる形。
// 1 つの文字のまとまりを 1 つの段落ブロックとして扱い、ブロックの ID が移動先（要素・ページ）になる。
export function canvasSearchBlocks(segments: CanvasSegment[]) {
  return segments.map((segment) => ({ id: segment.id, type: "paragraph", props: {}, content: [{ type: "text", text: segment.text, styles: {} }], children: [] }));
}

// 検索で一致した場所を探す・意味検索のチャンクを作るためのブロック。ノートは本文そのもの、ホワイトボード・スライドは取り出した文字を
// 段落ブロックにしたもの（ブロックの ID が要素・ページ）。segments は NoteCanvas.segments（ノートは無視する）。
export function searchableBlocks(kind: PageKind, blocks: unknown, segments: unknown): unknown {
  return isCanvasKind(kind) ? canvasSearchBlocks(parseCanvasSegments(segments)) : blocks;
}

// AI ツール（read_note）とチャットの文脈（添付・プロジェクトの参照）に渡す、読むための文字。
export function canvasReadableText(kind: CanvasKind, segments: CanvasSegment[]) {
  if (kind === "whiteboard") return segments.map((segment) => `- ${segment.text}`).join("\n");
  // 何枚目かは保存した並び順で数える（文字の無いスライドを飛ばして数えない）。古い保存は並べた順。
  return segments.map((segment, index) => `Slide ${(segment.index ?? index) + 1}: ${segment.text}`).join("\n");
}

// ---- ページの入力（作成・保存） ----

export type CanvasPageInput = { title: string; icon: string | null; data?: CanvasData; size?: number; fileOwners: string[]; filePaths: string[] };

// 作成（POST /api/pages）と保存（PATCH /api/pages/:id）の本文。題名とアイコンはノートと同じ規則。
// カバーはノートだけのもの（送られても null 以外は断る）。data は省略できる（作成では空の本体、保存では題名・アイコンだけを変える）。
export function validateCanvasPage(kind: CanvasKind, value: unknown): CanvasPageInput {
  if (!object(value)) throw new NoteValidationError(msg("Invalid JSON request."));
  if (typeof value.title !== "string" || value.title.length > MAX_NOTE_TITLE) {
    throw new NoteValidationError(fmt("Note title must be at most {max} characters.", { max: MAX_NOTE_TITLE }));
  }
  const icon = value.icon ?? null;
  if (icon !== null && !isEmojiIcon(icon) && !uploadedCoverPath(icon)) throw new NoteValidationError(msg("Note icon must be a single emoji or an uploaded image."));
  if ((value.cover ?? null) !== null || (value.coverPosition ?? null) !== null || value.blocks !== undefined) throw invalid();
  const canvas = value.data === undefined ? null : validateCanvasData(kind, value.data);
  return {
    title: value.title.trim() || "Untitled", icon: icon as string | null,
    ...(canvas ? { data: canvas.data, size: canvas.size } : {}), fileOwners: canvas?.fileOwners ?? [], filePaths: canvas?.filePaths ?? [],
  };
}
