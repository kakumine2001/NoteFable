// 段組み（Notion の Columns）のブロック JSON を扱う、サーバーでも使える純粋な関数。
// 形: { type: "columnList", children: column[] }、column は { type: "column", props: { width }, children: 本文のブロック[] }。
// columnList は 2 段以上、column は 1 つ以上の本文のブロックを持つ（BlockNote の core が前提にしている形）。

export const COLUMN_LIST = "columnList";
export const COLUMN = "column";
// エディターで作れる段の数の上限。保存の検査は、貼り付けなどで多くなった文書も弾かないよう少し広く取る。
export const MAX_COLUMNS = 5;
export const MAX_STORED_COLUMNS = 12;
// 段の幅は flex-grow の比。調整で極端に細くならないよう、この範囲に収める。
export const MIN_COLUMN_WIDTH = 0.05;
export const MAX_COLUMN_WIDTH = 20;

type TreeBlock = { type?: unknown; props?: unknown; children?: unknown };

export function isColumnContainer(block: unknown): boolean {
  const type = (block as TreeBlock | null)?.type;
  return type === COLUMN_LIST || type === COLUMN;
}

export function validColumnWidth(width: unknown): width is number {
  return typeof width === "number" && Number.isFinite(width) && width >= MIN_COLUMN_WIDTH && width <= MAX_COLUMN_WIDTH;
}

// 段組みを外して、段の中のブロックを順に並べる（左の段 → 右の段）。Markdown への書き出しと AI の番号付けに使う。
// 子ブロックの中の段組みは、呼び出し側が子を読むときにまた外す。
export function unwrapColumns<T>(blocks: T[]): T[] {
  const out: T[] = [];
  for (const block of blocks) {
    if (isColumnContainer(block)) {
      const children = (block as TreeBlock).children;
      if (Array.isArray(children)) out.push(...unwrapColumns(children as T[]));
    } else out.push(block);
  }
  return out;
}

// AI の編集などでブロックを消した後に、段組みの形を直す。空の段を消し、段が 1 つだけになった段組みは中身だけを残し、
// 段が無くなった段組みは消す（エディターの fixColumnList と同じ考え方）。
export function normalizeColumns<T extends TreeBlock>(blocks: T[]): T[] {
  const out: T[] = [];
  for (const block of blocks) {
    const children = Array.isArray(block.children) ? normalizeColumns(block.children as T[]) : block.children;
    if (block.type === COLUMN_LIST) {
      const columns = (children as T[] | undefined ?? []).filter((column) => column.type === COLUMN && Array.isArray(column.children) && column.children.length);
      if (columns.length === 1) out.push(...(columns[0].children as T[]));
      else if (columns.length > 1) out.push({ ...block, children: columns });
      continue;
    }
    out.push(children === block.children ? block : { ...block, children });
  }
  return out;
}
