// 会話の枝分かれ（発言の編集・回答の再生成）を扱う純粋な関数。DB には触らない。
// 発言は木になっていて、Message.active が「いま表示している枝」を表す。置き換えられた版は消さずに残す。

// 会話の先頭の発言の parentId。null（この機能より前の行・複製した行）とは区別する。
export const ROOT_PARENT = "root";

export type BranchNode = { id: string; parentId: string | null; active: boolean; role: string; createdAt: Date };

// 同じ位置にある別の版（同じ親を持つ発言）の中での位置。版が 1 つだけの発言には付けない。
export type MessageVersions = { index: number; total: number; prevId: string | null; nextId: string | null };

export type BranchTree = {
  // 作成順（同時刻は ID 順）。
  order: BranchNode[];
  // 発言の ID → 親の ID（先頭は ROOT_PARENT）。
  parent: Map<string, string>;
  // 親の ID（または ROOT_PARENT）→ 子の ID（作成順）。
  children: Map<string, string[]>;
};

export function buildTree(nodes: BranchNode[]): BranchTree {
  const order = [...nodes].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const index = new Map(order.map((node, position) => [node.id, position]));
  const parent = new Map<string, string>();
  const children = new Map<string, string[]>();
  order.forEach((node, position) => {
    // 明示された親は、この発言より前に作られた同じ会話の発言だけを認める（循環や他の会話の ID を親にしない）。
    const explicit = node.parentId === ROOT_PARENT ? ROOT_PARENT
      : node.parentId !== null && (index.get(node.parentId) ?? Infinity) < position ? node.parentId
      : null;
    // 親の記録が無い行（古い行・複製した行）は、作成順で直前の発言が親。
    const resolved = explicit ?? (position > 0 ? order[position - 1].id : ROOT_PARENT);
    parent.set(node.id, resolved);
    const siblings = children.get(resolved);
    if (siblings) siblings.push(node.id);
    else children.set(resolved, [node.id]);
  });
  return { order, parent, children };
}

// 表示中の発言のうち、別の版がある発言の版情報。
export function versionsOf(tree: BranchTree): Map<string, MessageVersions> {
  const result = new Map<string, MessageVersions>();
  for (const node of tree.order) {
    if (!node.active) continue;
    const siblings = tree.children.get(tree.parent.get(node.id)!) ?? [];
    if (siblings.length < 2) continue;
    const position = siblings.indexOf(node.id);
    result.set(node.id, { index: position + 1, total: siblings.length, prevId: siblings[position - 1] ?? null, nextId: siblings[position + 1] ?? null });
  }
  return result;
}

// その発言と、その下に続くすべての発言の ID。
export function subtreeIds(tree: BranchTree, id: string): string[] {
  const ids = [id];
  for (let cursor = 0; cursor < ids.length; cursor++) ids.push(...(tree.children.get(ids[cursor]) ?? []));
  return ids;
}

// その版を表示するときに表示中にする発言の ID：先頭からその発言までと、その先は各段でいちばん新しい版。
export function activationFor(tree: BranchTree, id: string): Set<string> | null {
  if (!tree.parent.has(id)) return null;
  const ids = new Set<string>();
  for (let cursor: string | undefined = id; cursor && cursor !== ROOT_PARENT; cursor = tree.parent.get(cursor)) ids.add(cursor);
  for (let cursor = id; ;) {
    const next = tree.children.get(cursor)?.at(-1);
    if (!next) break;
    ids.add(next);
    cursor = next;
  }
  return ids;
}

// 次の発言の親：表示中の枝の末尾。発言が無ければ会話の先頭。
export function activeLeafId(tree: BranchTree): string {
  for (let position = tree.order.length - 1; position >= 0; position--) {
    if (tree.order[position].active) return tree.order[position].id;
  }
  return ROOT_PARENT;
}

// 先頭からその発言までの ID（古い順）。
export function pathTo(tree: BranchTree, id: string): string[] {
  const ids: string[] = [];
  for (let cursor: string | undefined = id; cursor && cursor !== ROOT_PARENT; cursor = tree.parent.get(cursor)) ids.push(cursor);
  return ids.reverse();
}
