import { childrenByParent } from "@/lib/note-tree";
import { pageKindOf, type PageKind } from "@/lib/page-kinds";

// ワークスペースのサイドバーとホームの並び（#168、docs/architecture/notes-flow.md の「分区」）。
// 最上位のページのうち、プロジェクトに入っているものはプロジェクトごとに種類を混ぜて並べ、入っていないものは種類ごとの分区
// （ノート・スライド・ホワイトボード）に分ける。サブページは種類にかかわらず親の下に出る（自分の種類の分区には出ない）。
// Android（NotesUiState.sections）と iOS（NotesUiState.sections）も同じ規則。

type SectionItem = { id: string; parentId?: string | null; position?: number; createdAt: string; groupId: string | null; kind?: unknown };

// 新しいページの作り先。parentId はそのページの中（サブページ、プロジェクトは親に従う）、groupId はそのプロジェクトの最上位。
// どちらもなければプロジェクトなしの最上位（その種類の分区）。kind を省略するとノート。
export type NewPageRequest = { kind?: PageKind; parentId?: string | null; groupId?: string | null };

// ページが並ぶ分区の種類。kinds は作れる種類（creatablePageKinds）。まだ作れない種類（エディターがない）のページは、
// 見えなくならないようノートの分区に並べる。
export function sectionKindOf(page: { kind?: unknown }, kinds: readonly PageKind[]): PageKind {
  const kind = pageKindOf(page);
  return kinds.includes(kind) ? kind : "note";
}

export type WorkspaceSection<T> = {
  kind: PageKind;
  // 分区に並ぶ最上位のページ（一覧の順）。
  roots: T[];
  // サブページを含めた数（ホームの見出しの数字）。
  count: number;
};

// kinds の順に、各分区の最上位のページを返す。プロジェクトが消えて残った groupId も「プロジェクトなし」として扱う。
export function workspaceSections<T extends SectionItem>(pages: T[], groups: readonly { id: string }[], kinds: readonly PageKind[]): WorkspaceSection<T>[] {
  const known = new Set(groups.map((group) => group.id));
  const children = childrenByParent(pages);
  const loose = (children.get(null) ?? []).filter((page) => !page.groupId || !known.has(page.groupId));
  // 最上位から子をたどる（輪になった壊れたデータは最上位から届かないので、ここで止まる）。
  const size = (page: T): number => 1 + (children.get(page.id) ?? []).reduce((sum, child) => sum + size(child), 0);
  return kinds.map((kind) => {
    const roots = loose.filter((page) => sectionKindOf(page, kinds) === kind);
    return { kind, roots, count: roots.reduce((sum, page) => sum + size(page), 0) };
  });
}

// 拖動の放し先の判定（ReorderRowButton と同じ規則を純粋な関数にしたもの）。分区の見出し・分区の最上位の行（dropKind あり）には、
// 同じ分区に並ぶページだけを放せる。プロジェクトの見出し・プロジェクトの中の行・サブページの行（dropKind なし）には何でも放せる。
// 種類は作った後に変えられないので、別の種類の分区へは動かせない。
export function canDropIn(dragKind: string | undefined, dropKind: string | undefined) {
  return !dropKind || dropKind === dragKind;
}
