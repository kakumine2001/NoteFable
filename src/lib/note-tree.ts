import { byPosition } from "@/lib/list-order";
import { MAX_NOTE_TITLE } from "@/lib/note-document";
import type { NotePageSummary } from "@/types/notes";

// サブページ（親子関係）の木を扱う純粋な関数。サイドバー・スマホのホーム・パンくず・移動先の候補が使う。
// サーバーから来る一覧は平らな配列で、parentId で親を指す。親が一覧にない（ゴミ箱など）子は最上位として扱う。

export const MAX_DUPLICATE_PAGES = 100;

// 複製した最上位のページの題名（Notion と同じく末尾に「(1)」）。題名の上限を超えないよう元の題名を切る。
export function duplicateTitle(title: string) {
  const suffix = " (1)";
  return `${title.slice(0, MAX_NOTE_TITLE - suffix.length)}${suffix}`;
}

type TreeItem = Pick<NotePageSummary, "id" | "parentId" | "position" | "createdAt">;

// 親 ID → 子の配列（並び順どおり）。最上位は null のキー。
export function childrenByParent<T extends TreeItem>(pages: T[]) {
  const known = new Set(pages.map((page) => page.id));
  const map = new Map<string | null, T[]>();
  for (const page of [...pages].sort(byPosition)) {
    const parent = page.parentId && known.has(page.parentId) && page.parentId !== page.id ? page.parentId : null;
    const list = map.get(parent);
    if (list) list.push(page); else map.set(parent, [page]);
  }
  return map;
}

// 最上位のページ（親がない、または親が一覧にない）。
export function rootPages<T extends TreeItem>(pages: T[]) {
  return childrenByParent(pages).get(null) ?? [];
}

// 祖先を上から順に返す（自分は含めない）。壊れたデータで輪になっていても止まる。
export function ancestorsOf<T extends TreeItem>(pages: T[], id: string): T[] {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const chain: T[] = [];
  const seen = new Set([id]);
  let parentId = byId.get(id)?.parentId ?? null;
  while (parentId && byId.has(parentId) && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId)!;
    chain.unshift(parent);
    parentId = parent.parentId ?? null;
  }
  return chain;
}

// 子孫の ID（自分は含めない）。
export function descendantIdsOf<T extends TreeItem>(pages: T[], id: string): Set<string> {
  const children = childrenByParent(pages);
  const result = new Set<string>();
  const stack = [...(children.get(id) ?? [])];
  while (stack.length) {
    const page = stack.pop()!;
    if (result.has(page.id) || page.id === id) continue;
    result.add(page.id);
    stack.push(...(children.get(page.id) ?? []));
  }
  return result;
}

// 移動先として選べるか：自分自身と自分の子孫の中へは動かせない（輪になる）。
export function canMoveInto<T extends TreeItem>(pages: T[], id: string, parentId: string) {
  return id !== parentId && !descendantIdsOf(pages, id).has(parentId);
}
