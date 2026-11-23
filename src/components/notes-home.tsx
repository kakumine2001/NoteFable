import { ChevronDown, ChevronRight, Clock3, FileText, FolderInput, FolderPlus, Plus, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { ReorderRowButton } from "@/components/reorder-row-button";
import type { ReorderRequest } from "@/lib/list-order";
import { GroupNameDialog, MoveNoteDialog } from "@/components/note-group-dialogs";
import { WorkspaceSwitch, type WorkspaceView } from "@/components/workspace-nav";
import { childrenByParent, rootPages } from "@/lib/note-tree";
import { useExpandedPages } from "@/lib/use-expanded-pages";
import { rowName } from "@/lib/view-transition";
import type { NoteGroupSummary, NotePageSummary } from "@/types/notes";
import { useI18n } from "@/components/i18n-provider";
import { greetingFor, recentPages, relativeTime } from "@/lib/notes-home-text";
import { NoteIcon } from "@/components/note-icon";
import { PageKindIcon } from "@/components/page-kind-icon";
import { creatablePageKinds, PAGE_KIND_NEW_LABELS, PAGE_KIND_SECTION_LABELS, type PageKind } from "@/lib/page-kinds";
import { sectionKindOf, workspaceSections, type NewPageRequest } from "@/lib/workspace-sections";

// Notes のホーム: 作成済みのページをプロジェクトごと（種類は混ぜる）と、プロジェクトなしは種類ごとの分区（サイドバーと同じ、#168）に並べて、
// 押したものを開く。ページが 0 件のときは呼び出し側が空状態を出す。
// パソコン幅（640px 以上）では、上にあいさつと「最近編集したページ」のカード（すべての種類、種類のアイコン付き）を出す（スマホ幅は一覧だけ）。
export function NotesHome({ pages, groups, groupError, busy, onOpen, onPrefetch, onCancelPrefetch, onCreate, onImport, onWorkspaceChange, onMoveNote, onCreateGroup, onReorder, onMoveToPage }: {
  onMoveToPage: (pageId: string, parentId: string) => Promise<unknown>;
  pages: NotePageSummary[];
  onReorder:(move:ReorderRequest)=>Promise<unknown>;
  groups: NoteGroupSummary[];
  groupError: string;
  busy: boolean;
  onOpen: (id: string) => void;
  onPrefetch?: (id: string, immediate?: boolean) => void;
  onCancelPrefetch?: (id?: string) => void;
  // 種類を指定して作る（省略はノート）。下の作成ボタンは作れる種類ごとに 1 つ。
  onCreate: (request?: NewPageRequest) => void;
  onImport?: (files: File[]) => void;
  onWorkspaceChange: (view: WorkspaceView) => void;
  onMoveNote: (pageId: string, groupId: string | null) => Promise<unknown>;
  onCreateGroup: (name: string) => Promise<NoteGroupSummary | null>;
}) {
  const { t, tag } = useI18n();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [moving, setMoving] = useState<NotePageSummary | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  // ホームを開いた時刻。あいさつと相対時刻の基準にする。
  const [openedAt] = useState(() => Date.now());
  const recent = recentPages(pages);
  const relative = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
  // サブページの木。最上位のページをプロジェクトごとと種類ごとの分区に並べ、子は開いた親の下に字下げして出す（開閉はサイドバーと共有）。
  const kinds = creatablePageKinds();
  const children = childrenByParent(pages);
  const roots = rootPages(pages);
  const sections = workspaceSections(pages, groups, kinds);
  const sectionOf = new Map(sections.flatMap((section) => section.roots.map((page) => [page.id, section] as const)));
  const favorites = pages.filter((page) => page.favoritedAt).sort((a, b) => (a.favoritedAt ?? "").localeCompare(b.favoritedAt ?? ""));
  const [expanded, toggleExpanded] = useExpandedPages();
  const ids = new Set(pages.map((page) => page.id));
  // プロジェクトなしの最上位は、同じ分区の中だけで動かす。
  const siblingIds = (page: NotePageSummary) => sectionOf.get(page.id)?.roots.map((item) => item.id) ?? (children.get(page.parentId && ids.has(page.parentId) ? page.parentId : null) ?? [])
    .filter((item) => item.groupId === page.groupId).map((item) => item.id);
  const item = (page: NotePageSummary) => {
    const kids = children.get(page.id) ?? [];
    // サイドバーと同じく、どのページにも開閉の矢印を出す（サブページがなければ「No pages inside」）。
    const open = !!expanded[page.id];
    return <li key={page.id} className="notes-home-node">
      <div className="notes-home-item vt-row" style={rowName(`hrow-${page.id}`)} data-order-id={page.id} data-order-scope="note"
        data-page-kind={sectionKindOf(page, kinds)} data-drop-kind={sectionOf.get(page.id)?.kind}>
      <button type="button" className="notes-home-toggle" aria-expanded={open} onClick={() => toggleExpanded(page.id, !open)}
        aria-label={open ? t("Collapse {title}", { title: page.title }) : t("Expand {title}", { title: page.title })}>
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} className="rtl-mirror" />}
      </button>
      <ReorderRowButton id={page.id} title={page.title} scope="note" ids={siblingIds(page)} disabled={busy} onMove={onReorder} onMoveGroup={groupId=>onMoveNote(page.id,groupId)} onOpen={() => onOpen(page.id)}
        onPrefetch={onPrefetch ? (immediate) => onPrefetch(page.id, immediate) : undefined}
        onCancelPrefetch={onCancelPrefetch ? () => onCancelPrefetch(page.id) : undefined}
        className="notes-home-row">
        <span className="notes-home-icon" aria-hidden="true"><NoteIcon icon={page.icon} fallback={<PageKindIcon kind={page.kind} size={20} />} /></span>
        <span className="notes-home-name">{page.title}</span>
        <time className="notes-home-date" dateTime={page.updatedAt}>
          {new Date(page.updatedAt).toLocaleDateString(tag, { month: "short", day: "numeric" })}
        </time>
      </ReorderRowButton>
      <button type="button" className="notes-home-move" disabled={busy} onClick={() => setMoving(page)} aria-label={t("Move {title} to a project", { title: page.title })}><FolderInput size={18} /></button>
      </div>
      {open && (kids.length ? <ul className="notes-home-list notes-home-sub">{kids.map(item)}</ul> : <p className="notes-home-empty notes-home-sub">{t("No pages inside")}</p>)}
    </li>;
  };
  return (
    <div className="notes-column notes-home" data-reorder-list>
      <div className="notion-home-switch"><WorkspaceSwitch view="pages" onChange={onWorkspaceChange} /></div>
      <div className="notes-home-hero">
        <h1 className="notes-home-greeting">{t(greetingFor(new Date(openedAt).getHours()))}</h1>
        <section aria-labelledby="notes-home-recent">
          <h2 id="notes-home-recent" className="notes-home-section"><Clock3 size={15} aria-hidden="true" />{t("Recently edited")}</h2>
          <ul className="notes-recent-list">
            {recent.map((page) => <li key={page.id}>
              <button type="button" className="notes-recent-card" disabled={busy} onClick={() => onOpen(page.id)}
                onPointerEnter={(event) => { if (event.pointerType !== "touch") onPrefetch?.(page.id, false); }}
                onPointerLeave={() => onCancelPrefetch?.(page.id)}
                onPointerDown={(event) => { if (event.pointerType !== "touch" && event.button === 0) onPrefetch?.(page.id, true); }}
                onFocus={() => onPrefetch?.(page.id, true)}>
                <span className="notes-recent-cover" aria-hidden="true" />
                <span className="notes-recent-icon" aria-hidden="true"><NoteIcon icon={page.icon} fallback={<PageKindIcon kind={page.kind} size={24} strokeWidth={1.6} />} /></span>
                <span className="notes-recent-name">{page.title}</span>
                <time className="notes-recent-date" dateTime={page.updatedAt}>{relativeTime(page.updatedAt, openedAt, relative)}</time>
              </button>
            </li>)}
          </ul>
        </section>
        {/* プロジェクトから外すドロップ先（スマホ幅では下の見出しが同じ役目）。外したページは自分の種類の分区に戻る。 */}
        <h2 className="notes-home-section" data-note-group-drop=""><FileText size={15} aria-hidden="true" />{kinds.length > 1 ? t("All pages") : t("All notes")}</h2>
      </div>
      <h1 className="notes-home-title" data-note-group-drop="">{t("Workspace")}</h1>
      {favorites.length > 0 && <section>
        <h2 className="notes-home-group">{t("Favorites")}<span>{favorites.length}</span></h2>
        <ul className="notes-home-list">{favorites.map((page) => <li key={page.id} className="notes-home-node"><div className="notes-home-item">
          <button type="button" className="notes-home-row" disabled={busy} onClick={() => onOpen(page.id)}
            onPointerEnter={(event) => { if (event.pointerType !== "touch") onPrefetch?.(page.id, false); }}
            onPointerLeave={() => onCancelPrefetch?.(page.id)}
            onPointerDown={(event) => { if (event.pointerType !== "touch" && event.button === 0) onPrefetch?.(page.id, true); }}
            onFocus={() => onPrefetch?.(page.id, true)}>
            <span className="notes-home-icon" aria-hidden="true"><NoteIcon icon={page.icon} fallback={<PageKindIcon kind={page.kind} size={20} />} /></span>
            <span className="notes-home-name">{page.title}</span>
          </button>
        </div></li>)}</ul>
      </section>}
      {groups.map((group) => {
        const members = roots.filter((page) => page.groupId === group.id);
        const total = pages.filter((page) => page.groupId === group.id).length;
        return (
          <section key={group.id}>
            <h2 className="notes-home-group" data-note-group-drop={group.id}>{group.name}<span>{total}</span></h2>
            {members.length ? <ul className="notes-home-list">{members.map(item)}</ul> : <p className="notes-home-empty">{t("No notes in this project.")}</p>}
          </section>
        );
      })}
      {/* プロジェクトなしのページ。作れる種類がノートだけなら今までどおり「No project」（プロジェクトがあるときだけ見出しを出す）、
          2 つ以上なら種類ごとの分区の見出し。見出しは同じ分区に並ぶページだけを受けるプロジェクトから外す放し先。 */}
      {sections.map((section) => section.roots.length > 0 && <section key={section.kind}>
        {kinds.length > 1
          ? <h2 className="notes-home-group" data-note-group-drop="" data-drop-kind={section.kind}>{t(PAGE_KIND_SECTION_LABELS[section.kind])}<span>{section.count}</span></h2>
          : groups.length > 0 && <h2 className="notes-home-group" data-note-group-drop="" data-drop-kind={section.kind}>{t("No project")}<span>{section.count}</span></h2>}
        <ul className="notes-home-list">{section.roots.map(item)}</ul>
      </section>)}
      <div className="notes-home-actions">
        <NewPageButtons kinds={kinds} busy={busy} onCreate={(kind) => onCreate({ kind })} />
        <button type="button" className="notion-button notes-home-new-group" disabled={busy} onClick={() => setCreatingGroup(true)}><FolderPlus size={16} />{t("New project")}</button>
        {onImport && <>
          <input ref={importInputRef} type="file" multiple accept=".md,.markdown,.txt,text/markdown,text/plain" className="sr-only"
            onChange={(event) => {
              const picked = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (picked.length) onImport(picked);
            }} />
          <button type="button" className="notion-button notes-home-new-group" disabled={busy} onClick={() => importInputRef.current?.click()}><Upload size={16} />{t("Import Markdown")}</button>
        </>}
      </div>
      {moving && <MoveNoteDialog page={pages.find((page) => page.id === moving.id) ?? moving} groups={groups} error={groupError}
        onMove={onMoveNote} onCreateGroup={onCreateGroup} onClose={() => setMoving(null)} pages={pages} onMoveToPage={onMoveToPage} />}
      {creatingGroup && <GroupNameDialog title={t("New project")} submitLabel={t("Create")} error={groupError} onClose={() => setCreatingGroup(false)}
        onSubmit={async (name) => Boolean(await onCreateGroup(name))} />}
    </div>
  );
}

// ホームと空状態の作成ボタン（#168）。作れる種類がノートだけなら今までどおりの「New note」1 つ。2 つ以上なら種類ごとに 1 つずつ、
// 種類のアイコン付きで並べる（最初のノートだけ濃い色）。
export function NewPageButtons({ kinds, busy, onCreate, className = "" }: { kinds: readonly PageKind[]; busy: boolean; onCreate: (kind: PageKind) => void; className?: string }) {
  const { t } = useI18n();
  if (kinds.length < 2) return <button type="button" className={`notes-empty-new ${className}`} disabled={busy} onClick={() => onCreate("note")}><Plus size={16} />{t("New note")}</button>;
  return <>{kinds.map((kind, index) => <button key={kind} type="button" className={index === 0 ? `notes-empty-new ${className}` : "notion-button notes-home-new-group"} disabled={busy} onClick={() => onCreate(kind)}>
    <PageKindIcon kind={kind} size={16} aria-hidden="true" />{t(PAGE_KIND_NEW_LABELS[kind])}
  </button>)}</>;
}
