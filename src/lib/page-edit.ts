import { blocksToMarkdown, flattenBlocks, markdownToBlocks, type NoteBlock } from "@/lib/note-markdown";

// モデルが出す編集案を、ページのブロック列へ適用する。ページ自体は変更せず、結果を返すだけ。

export const MAX_EDITS = 20;
const MAX_MARKDOWN_CHARS = 20_000;
// 1 回の提案全体の上限。インライン解析が行の長さに対して二乗で伸びるため、合計も抑える。
const MAX_TOTAL_MARKDOWN_CHARS = 60_000;
const OPS = ["replace", "insert_after", "delete"] as const;

export class PageEditError extends Error {}

// 同じ種類のブロック 1 つへ置き換える時は、ブロック全体の色と配置を引き継ぐ。
const CARRIED_PROPS = ["textColor", "backgroundColor", "textAlignment"] as const;

function richBlockProps(block: NoteBlock) {
  const props = block.props ?? {};
  return CARRIED_PROPS.some((key) => props[key] !== undefined && props[key] !== "default" && props[key] !== "left");
}

function richInline(content: unknown): boolean {
  return Array.isArray(content) && content.some((node: { styles?: Record<string, unknown>; content?: unknown }) =>
    Object.keys(node?.styles ?? {}).some((key) => !["bold", "italic", "strike", "code"].includes(key)) || richInline(node?.content));
}

// 置き換えで捨てられる範囲（ブロック本人と子孫）に、Markdown で表せない書式があるか。
function losesFormatting(target: NoteBlock, carried: boolean): boolean {
  const walk = (block: NoteBlock, isTarget: boolean): boolean =>
    richInline(block.content) || (richBlockProps(block) && !(isTarget && carried))
    || (Array.isArray(block.children) && (block.children as NoteBlock[]).some((child) => walk(child, false)));
  return walk(target, true);
}
export type PageEditChange = {
  op: (typeof OPS)[number];
  // read_page で見えていた番号（0 は先頭への挿入）。
  block: number;
  // 変更前と変更後の Markdown。挿入では before、削除では after がない。
  before?: string;
  after?: string;
  // 置き換えると Markdown で表せない書式（文字色・背景色・下線・配置）が失われる。画面で警告する。
  dropsFormatting?: true;
};

// 画面に出す編集案。承認されたら proposed をそのまま PATCH /api/pages/[id] へ送る（baseVersion で競合を検出）。
export type PageEditProposal = {
  id: string;
  pageId: string;
  pageTitle: string;
  baseVersion: number;
  title?: { before: string; after: string };
  changes: PageEditChange[];
  proposed: { title: string; blocks: unknown[] };
};

// 新しいページの提案。承認されたら proposed をそのまま POST /api/pages へ送る。
export type PageCreateProposal = {
  id: string;
  title: string;
  icon: string | null;
  // 画面に出す本文の Markdown（保存されるブロックを書き戻したもの）。
  content: string;
  proposed: { title: string; icon: string | null; blocks: unknown[] };
};

// 新規ページの本文（Markdown）をブロックにする。空なら空のページ。
export function parseNewPageMarkdown(value: unknown): NoteBlock[] {
  if (value === null || value === undefined || value === "") return [];
  if (typeof value !== "string") throw new PageEditError("markdown must be a string or null.");
  if (value.length > MAX_TOTAL_MARKDOWN_CHARS) throw new PageEditError(`markdown is longer than ${MAX_TOTAL_MARKDOWN_CHARS} characters; create the page with the first part and add the rest with propose_page_edit.`);
  return markdownToBlocks(value) as NoteBlock[];
}

type Edit = { op: (typeof OPS)[number]; block: number; markdown: string | null };

function parseEdits(value: unknown, count: number): Edit[] {
  if (!Array.isArray(value)) throw new PageEditError("edits must be an array.");
  if (value.length > MAX_EDITS) throw new PageEditError(`At most ${MAX_EDITS} edits per call; split the work.`);
  let total = 0;
  return value.map((entry, index) => {
    const edit = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const where = `edits[${index}]`;
    const op = OPS.find((name) => name === edit.op);
    if (!op) throw new PageEditError(`${where}.op must be one of ${OPS.join(", ")}.`);
    const block = edit.block;
    if (typeof block !== "number" || !Number.isInteger(block) || block < (op === "insert_after" ? 0 : 1) || block > count) {
      throw new PageEditError(`${where}.block must be a block number from read_page (1-${count}${op === "insert_after" ? ", or 0 for the start" : ""}).`);
    }
    const markdown = typeof edit.markdown === "string" ? edit.markdown : null;
    if (op !== "delete") {
      if (!markdown?.trim()) throw new PageEditError(`${where}.markdown is required for ${op}.`);
      if (markdown.length > MAX_MARKDOWN_CHARS) throw new PageEditError(`${where}.markdown is longer than ${MAX_MARKDOWN_CHARS} characters.`);
    }
    total += op === "delete" ? 0 : markdown!.length;
    if (total > MAX_TOTAL_MARKDOWN_CHARS) throw new PageEditError(`The edits contain more than ${MAX_TOTAL_MARKDOWN_CHARS} characters of markdown in total; split the work into several proposals.`);
    return { op, block, markdown: op === "delete" ? null : markdown };
  });
}

// 番号は read_page 時点のもの。すべての編集を元のブロック列に対して解決してから、一度に適用する。
export function applyPageEdits(blocks: NoteBlock[], rawEdits: unknown): { blocks: NoteBlock[]; changes: PageEditChange[] } {
  const flat = flattenBlocks(blocks);
  const edits = parseEdits(rawEdits, flat.length);
  const idOf = (number: number) => String(flat[number - 1].id);

  const parentOf = new Map<string, string>();
  const walk = (list: unknown, parent?: string) => {
    if (!Array.isArray(list)) return;
    for (const block of list as NoteBlock[]) {
      const id = String(block.id);
      if (parent) parentOf.set(id, parent);
      walk(block.children, id);
    }
  };
  walk(blocks);

  const removed = new Set<string>();
  for (const edit of edits) {
    if (edit.op === "insert_after") continue;
    const id = idOf(edit.block);
    if (removed.has(id)) throw new PageEditError(`Block ${edit.block} is edited more than once.`);
    removed.add(id);
  }
  // 置換・削除したブロックの中を、別の編集で触ることはできない。
  for (const edit of edits) {
    if (edit.block === 0) continue;
    for (let ancestor = parentOf.get(idOf(edit.block)); ancestor; ancestor = parentOf.get(ancestor)) {
      if (removed.has(ancestor)) throw new PageEditError(`Block ${edit.block} is inside a block that is replaced or deleted. Edit the outer block instead.`);
    }
  }

  const replacements = new Map<string, NoteBlock[]>();
  const insertions = new Map<string, NoteBlock[]>();
  const head: NoteBlock[] = [];
  const changes: PageEditChange[] = [];
  for (const edit of edits) {
    const parsed = edit.markdown === null ? [] : markdownToBlocks(edit.markdown);
    if (edit.op !== "delete" && !parsed.length) throw new PageEditError(`The markdown for block ${edit.block} produced no blocks.`);
    const after = parsed.length ? blocksToMarkdown(parsed) : undefined;
    if (edit.op === "insert_after") {
      if (edit.block === 0) head.push(...parsed);
      else insertions.set(idOf(edit.block), [...(insertions.get(idOf(edit.block)) ?? []), ...parsed]);
      changes.push({ op: edit.op, block: edit.block, after });
      continue;
    }
    const target = flat[edit.block - 1];
    let carried = false;
    if (edit.op === "replace") {
      if (parsed.length === 1 && parsed[0].type === target.type) {
        for (const key of CARRIED_PROPS) if (target.props?.[key] !== undefined) { parsed[0].props[key] = target.props[key]; carried = true; }
      }
      replacements.set(idOf(edit.block), parsed);
    }
    changes.push({
      op: edit.op, block: edit.block, before: blocksToMarkdown([target]), ...(after === undefined ? {} : { after }),
      ...(edit.op === "replace" && losesFormatting(target, carried) ? { dropsFormatting: true as const } : {}),
    });
  }

  const rebuild = (list: unknown): NoteBlock[] => {
    const out: NoteBlock[] = [];
    for (const block of (Array.isArray(list) ? list : []) as NoteBlock[]) {
      const id = String(block.id);
      const replacement = replacements.get(id);
      if (replacement) out.push(...replacement);
      else if (!removed.has(id)) out.push({ ...block, children: rebuild(block.children) });
      out.push(...(insertions.get(id) ?? []));
    }
    return out;
  };
  return { blocks: [...head, ...rebuild(blocks)], changes };
}
