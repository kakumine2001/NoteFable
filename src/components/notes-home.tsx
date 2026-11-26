import { ChevronLeft, ChevronRight, Clock3, Folder, FolderInput, FolderPlus, LayoutGrid, Plus, Star, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { AppIcon } from "@/components/app-icon";
import { NOTE_COVERS, coverImageUrl, isPresetCover } from "@/lib/note-document";
import { creatablePageKinds, PAGE_KIND_LABELS, PAGE_KIND_NEW_LABELS, PAGE_KIND_SECTION_LABELS, pageKindOf, type PageKind } from "@/lib/page-kinds";
import { sectionKindOf, workspaceSections, type NewPageRequest } from "@/lib/workspace-sections";

// Notes のホーム: 作成済みのページをプロジェクトごと（種類は混ぜる）と、プロジェクトなしは種類ごとの分区（サイドバーと同じ、#168）に並べて、
// 押したものを開く。ページが 0 件のときは呼び出し側が空状態を出す。
// パソコン幅（640px 以上）では、上にあいさつ・クイック作成デッキ・「最近編集したページ」のカード（すべての種類、種類のアイコン付き）を出す。
export function NotesHome({ pages, groups, groupError, busy, onOpen, onPrefetch, onCancelPrefetch, onCreate, onGenerateSlides, onImport, onWorkspaceChange, onMoveNote, onCreateGroup, onReorder, onMoveToPage }: {
  onMoveToPage: (pageId: string, parentId: string) => Promise<unknown>;
  pages: NotePageSummary[];
  onReorder:(move:ReorderRequest)=>Promise<unknown>;
  groups: NoteGroupSummary[];
  groupError: string;
  busy: boolean;
  onOpen: (id: string) => void;
  onPrefetch?: (id: string, immediate?: boolean) => void;
  onCancelPrefetch?: (id?: string) => void;
  // 種類を指定して作る（省略はノート）。作成カードは作れる種類ごとに 1 つ。
  onCreate: (request?: NewPageRequest) => void;
  // AI のスライド生成の窓を開く（作成カードの下の「Generate with AI」）。
  onGenerateSlides?: () => void;
  onImport?: (files: File[]) => void;
  onWorkspaceChange: (view: WorkspaceView) => void;
  onMoveNote: (pageId: string, groupId: string | null) => Promise<unknown>;
  onCreateGroup: (name: string) => Promise<NoteGroupSummary | null>;
}) {
  const { t, tag } = useI18n();
  const importInputRef = useRef<HTMLInputElement>(null);
  const recentListRef = useRef<HTMLUListElement>(null);
  const [recentScroll, setRecentScroll] = useState({ prev: false, next: false });
  const [moving, setMoving] = useState<NotePageSummary | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [kindFilter, setKindFilter] = useState<PageKind | null>(null);
  // ホームを開いた時刻。あいさつと相対時刻の基準にする。
  const [openedAt] = useState(() => Date.now());
  const recent = recentPages(pages);
  const updateRecentScroll = useCallback(() => {
    const el = recentListRef.current;
    if (!el) { setRecentScroll({ prev: false, next: false }); return; }
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    const pos = Math.abs(el.scrollLeft);
    const prev = pos > 2;
    const next = max - pos > 2;
    setRecentScroll((cur) => (cur.prev === prev && cur.next === next ? cur : { prev, next }));
  }, []);
  useEffect(() => {
    const el = recentListRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(updateRecentScroll);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateRecentScroll) : null;
    observer?.observe(el);
    return () => { cancelAnimationFrame(raf); observer?.disconnect(); };
  }, [recent.length, updateRecentScroll]);
  function scrollRecent(direction: -1 | 1) {
    const el = recentListRef.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === "rtl";
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    el.scrollBy({ left: (rtl ? -1 : 1) * direction * 420, behavior: reduced ? "auto" : "smooth" });
  }
  const relative = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
  // サブページの木。最上位のページをプロジェクトごとと種類ごとの分区に並べ、子は開いた親の下に字下げして出す（開閉はサイドバーと共有）。
  const kinds = creatablePageKinds();
  const multiKind = kinds.length > 1;
  const activeFilter = multiKind ? kindFilter : null;
  const children = childrenByParent(pages);
  const roots = rootPages(pages);
  const sections = workspaceSections(pages, groups, kinds);
  const sectionOf = new Map(sections.flatMap((section) => section.roots.map((page) => [page.id, section] as const)));
  const groupIds = new Set(groups.map((group) => group.id));
  const favorites = pages.filter((page) => page.favoritedAt).sort((a, b) => (a.favoritedAt ?? "").localeCompare(b.favoritedAt ?? ""));
  const [expanded, toggleExpanded] = useExpandedPages();
  const ids = new Set(pages.map((page) => page.id));
  const matchesFilter = (page: NotePageSummary) => !activeFilter || sectionKindOf(page, kinds) === activeFilter;
  const visibleFavorites = favorites.filter(matchesFilter);
  // プロジェクトなしの最上位は、同じ分区の中だけで動かす。
  const siblingIds = (page: NotePageSummary) => sectionOf.get(page.id)?.roots.map((item) => item.id) ?? (children.get(page.parentId && ids.has(page.parentId) ? page.parentId : null) ?? [])
    .filter((item) => item.groupId === page.groupId).map((item) => item.id);

  const item = (page: NotePageSummary, { showKindTag = false, flat = false }: { showKindTag?: boolean; flat?: boolean } = {}) => {
    const kids = children.get(page.id) ?? [];
    const kind = pageKindOf(page);
    // サイドバーと同じく、どのページにも開閉の矢印を出す（サブページがなければ「No pages inside」）。絞り込み中はフラットに表示する。
    const open = !flat && !!expanded[page.id];
    const rowInner = <>
      <span className={`notes-home-icon${page.icon ? " has-custom" : ` is-${kind}`}`} aria-hidden="true"><NoteIcon icon={page.icon} fallback={<PageKindIcon kind={kind} size={16} />} /></span>
      <span className="notes-home-name">{page.title}</span>
      {showKindTag && multiKind && <span className={`ws-kind-badge is-${kind}`}>{t(PAGE_KIND_LABELS[kind])}</span>}
      <time className="notes-home-date" dateTime={page.updatedAt}>
        {new Date(page.updatedAt).toLocaleDateString(tag, { month: "short", day: "numeric" })}
      </time>
    </>;
    return <li key={page.id} className="notes-home-node">
      <div className="notes-home-item vt-row" style={rowName(`hrow-${page.id}`)}
        data-order-id={flat ? undefined : page.id} data-order-scope={flat ? undefined : "note"}
        data-page-kind={flat ? undefined : sectionKindOf(page, kinds)} data-drop-kind={flat ? undefined : sectionOf.get(page.id)?.kind}>
        {!flat && <button type="button" className="notes-home-toggle" aria-expanded={open} onClick={() => toggleExpanded(page.id, !open)}
          aria-label={open ? t("Collapse {title}", { title: page.title }) : t("Expand {title}", { title: page.title })}>
          <ChevronRight size={15} className={`sidebar-chevron rtl-mirror${open ? " is-open" : ""}`} />
        </button>}
        {flat ? (
          <button type="button" className="notes-home-row" disabled={busy} onClick={() => onOpen(page.id)}
            onPointerEnter={(event) => { if (event.pointerType !== "touch") onPrefetch?.(page.id, false); }}
            onPointerLeave={() => onCancelPrefetch?.(page.id)}
            onPointerDown={(event) => { if (event.pointerType !== "touch" && event.button === 0) onPrefetch?.(page.id, true); }}
            onFocus={() => onPrefetch?.(page.id, true)}>
            {rowInner}
          </button>
        ) : (
          <ReorderRowButton id={page.id} title={page.title} scope="note" ids={siblingIds(page)} disabled={busy} onMove={onReorder} onMoveGroup={groupId=>onMoveNote(page.id,groupId)} onOpen={() => onOpen(page.id)}
            onPrefetch={onPrefetch ? (immediate) => onPrefetch(page.id, immediate) : undefined}
            onCancelPrefetch={onCancelPrefetch ? () => onCancelPrefetch(page.id) : undefined}
            className="notes-home-row">
            {rowInner}
          </ReorderRowButton>
        )}
        <button type="button" className="notes-home-move" disabled={busy} onClick={() => setMoving(page)} aria-label={t("Move {title} to a project", { title: page.title })} title={t("Move to project")}><FolderInput size={16} /></button>
      </div>
      {open && (kids.length ? <ul className="notes-home-sub">{kids.map((child) => item(child, { showKindTag }))}</ul> : <p className="notes-home-empty notes-home-sub">{t("No pages inside")}</p>)}
    </li>;
  };

  const visibleGroups = activeFilter
    ? groups
        .map((group) => {
          const members = pages.filter((page) => page.groupId === group.id && matchesFilter(page));
          return { group, members, total: members.length };
        })
        .filter(({ members }) => members.length > 0)
    : groups.map((group) => ({
        group,
        members: roots.filter((page) => page.groupId === group.id),
        total: pages.filter((page) => page.groupId === group.id).length,
      }));

  const ungroupedFiltered = activeFilter
    ? pages.filter((page) => (!page.groupId || !groupIds.has(page.groupId)) && matchesFilter(page))
    : [];
  const visibleSections = activeFilter
    ? (ungroupedFiltered.length > 0 ? [{ kind: activeFilter, roots: ungroupedFiltered, count: ungroupedFiltered.length }] : [])
    : sections.filter((section) => section.roots.length > 0);

  const filterEmpty = activeFilter !== null && visibleFavorites.length === 0 && visibleGroups.length === 0 && visibleSections.length === 0;

  return (
    <div className="notes-column notes-home" data-reorder-list>
      <div className="notion-home-switch"><WorkspaceSwitch view="pages" onChange={onWorkspaceChange} /></div>

      {onImport && (
        <input ref={importInputRef} type="file" multiple accept=".md,.markdown,.txt,text/markdown,text/plain" className="sr-only"
          onChange={(event) => {
            const picked = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (picked.length) onImport(picked);
          }} />
      )}

      <header className="ws-home-header">
        <div className="ws-home-title-wrap">
          <h1 className="notes-home-greeting">{t(greetingFor(new Date(openedAt).getHours()))}</h1>
          <h1 className="notes-home-title" data-note-group-drop="">{t("Workspace")}</h1>
        </div>
        <div className="ws-home-utils">
          <button type="button" className="ws-util-pill" disabled={busy} onClick={() => setCreatingGroup(true)}>
            <FolderPlus size={14} aria-hidden="true" /><span>{t("New project")}</span>
          </button>
          {onImport && (
            <button type="button" className="ws-util-pill" disabled={busy} onClick={() => importInputRef.current?.click()}>
              <Upload size={14} aria-hidden="true" /><span>{t("Import Markdown")}</span>
            </button>
          )}
        </div>
      </header>

      <div className="ws-home-create">
        <NewPageButtons kinds={kinds} busy={busy} onCreate={(kind) => onCreate({ kind })} onGenerate={onGenerateSlides} />
      </div>

      <div className="notes-home-hero">
        {recent.length > 0 && (
          <section aria-labelledby="notes-home-recent">
            <div className="ws-recent-head">
              <h2 id="notes-home-recent" className="notes-home-section"><Clock3 size={14} aria-hidden="true" /><span>{t("Recently edited")}</span></h2>
              {(recentScroll.prev || recentScroll.next) && (
                <div className="ws-recent-nav">
                  <button type="button" className="ws-recent-nav-btn" disabled={!recentScroll.prev} aria-label={t("Previous")} onClick={() => scrollRecent(-1)}>
                    <ChevronLeft size={14} className="rtl-mirror" aria-hidden="true" />
                  </button>
                  <button type="button" className="ws-recent-nav-btn" disabled={!recentScroll.next} aria-label={t("Next")} onClick={() => scrollRecent(1)}>
                    <ChevronRight size={14} className="rtl-mirror" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
            <ul ref={recentListRef} className="notes-recent-list" onScroll={updateRecentScroll}>
              {recent.map((page) => {
                const kind = pageKindOf(page);
                const preset = isPresetCover(page.cover) ? NOTE_COVERS[page.cover] : null;
                const imageUrl = coverImageUrl(page.cover);
                const hasCover = Boolean(preset || imageUrl);
                return <li key={page.id}>
                  <button type="button" className={`notes-recent-card is-${kind}`} disabled={busy} onClick={() => onOpen(page.id)}
                    onPointerEnter={(event) => { if (event.pointerType !== "touch") onPrefetch?.(page.id, false); }}
                    onPointerLeave={() => onCancelPrefetch?.(page.id)}
                    onPointerDown={(event) => { if (event.pointerType !== "touch" && event.button === 0) onPrefetch?.(page.id, true); }}
                    onFocus={() => onPrefetch?.(page.id, true)}>
                    <span className={`notes-recent-cover is-${kind}${hasCover ? " has-cover" : ""}`} style={preset ? { background: preset } : undefined} aria-hidden="true">
                      {/* eslint-disable-next-line @next/next/no-img-element -- 所有者確認付き API から返す private 画像のため next/image の最適化は使わない */}
                      {imageUrl ? <img src={imageUrl} alt="" draggable={false} loading="lazy" className="notes-recent-cover-image" style={{ objectPosition: `center ${page.coverPosition ?? 50}%` }} /> : null}
                      {!hasCover && <span className="notes-recent-motif" />}
                      {multiKind && <span className={`notes-recent-kind-pill is-${kind}`}>{t(PAGE_KIND_LABELS[kind])}</span>}
                    </span>
                    <span className={`notes-recent-icon${page.icon ? " has-custom" : ` is-${kind}`}`} aria-hidden="true">
                      <NoteIcon icon={page.icon} fallback={<PageKindIcon kind={kind} size={17} strokeWidth={1.85} />} />
                    </span>
                    <span className="notes-recent-name">{page.title}</span>
                    <time className="notes-recent-date" dateTime={page.updatedAt}>{relativeTime(page.updatedAt, openedAt, relative)}</time>
                  </button>
                </li>;
              })}
            </ul>
          </section>
        )}
      </div>

      <div className="ws-library-bar">
        {/* プロジェクトから外すドロップ先（スマホ幅では上の見出しが同じ役目）。外したページは自分の種類の分区に戻る。 */}
        <h2 className="notes-home-section ws-library-heading" data-note-group-drop="">
          <LayoutGrid size={14} aria-hidden="true" />
          <span>{multiKind ? t("All pages") : t("All notes")}</span>
        </h2>
        {multiKind && (
          <div className="ws-filter-bar" role="group" aria-label={t("Page type")}>
            <button type="button" aria-pressed={activeFilter === null}
              className={`ws-filter-pill${activeFilter === null ? " is-active" : ""}`}
              onClick={() => setKindFilter(null)}>
              {t("All")}
            </button>
            {kinds.map((kind) => (
              <button key={kind} type="button" aria-pressed={activeFilter === kind}
                className={`ws-filter-pill is-${kind}${activeFilter === kind ? " is-active" : ""}`}
                onClick={() => setKindFilter(kind)}>
                <PageKindIcon kind={kind} size={13} aria-hidden="true" />
                <span>{t(PAGE_KIND_SECTION_LABELS[kind])}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {visibleFavorites.length > 0 && <section className="ws-home-section-block">
        <h2 className="notes-home-group"><Star size={13.5} className="sidebar-fav-star" aria-hidden="true" /><span>{t("Favorites")}</span><span className="ws-count-pill">{visibleFavorites.length}</span></h2>
        <ul className="notes-home-list">{visibleFavorites.map((page) => {
          const kind = pageKindOf(page);
          return <li key={page.id} className="notes-home-node"><div className="notes-home-item">
            <button type="button" className="notes-home-row" disabled={busy} onClick={() => onOpen(page.id)}
              onPointerEnter={(event) => { if (event.pointerType !== "touch") onPrefetch?.(page.id, false); }}
              onPointerLeave={() => onCancelPrefetch?.(page.id)}
              onPointerDown={(event) => { if (event.pointerType !== "touch" && event.button === 0) onPrefetch?.(page.id, true); }}
              onFocus={() => onPrefetch?.(page.id, true)}>
              <span className={`notes-home-icon${page.icon ? " has-custom" : ` is-${kind}`}`} aria-hidden="true"><NoteIcon icon={page.icon} fallback={<PageKindIcon kind={kind} size={16} />} /></span>
              <span className="notes-home-name">{page.title}</span>
              {multiKind && <span className={`ws-kind-badge is-${kind}`}>{t(PAGE_KIND_LABELS[kind])}</span>}
            </button>
          </div></li>;
        })}</ul>
      </section>}

      {visibleGroups.map((entry) => (
          <section key={entry.group.id} className="ws-home-section-block">
            <h2 className="notes-home-group" data-note-group-drop={entry.group.id}>
              <Folder size={13.5} aria-hidden="true" />
              <span>{entry.group.name}</span>
              <span className="ws-count-pill">{entry.total}</span>
            </h2>
            {entry.members.length
              ? <ul className="notes-home-list">{entry.members.map((page) => item(page, { showKindTag: true, flat: activeFilter !== null }))}</ul>
              : <p className="notes-home-empty ws-home-empty-card">{t("No notes in this project.")}</p>}
          </section>
        ))}

      {/* プロジェクトなしのページ。作れる種類がノートだけなら今までどおり「No project」（プロジェクトがあるときだけ見出しを出す）、
          2 つ以上なら種類ごとの分区の見出し。見出しは同じ分区に並ぶページだけを受けるプロジェクトから外す放し先。 */}
      {visibleSections.map((section) => (
        <section key={section.kind} className="ws-home-section-block">
          {multiKind
            ? <h2 className="notes-home-group" data-note-group-drop="" data-drop-kind={section.kind}>
                <PageKindIcon kind={section.kind} size={13.5} aria-hidden="true" />
                <span>{t(PAGE_KIND_SECTION_LABELS[section.kind])}</span>
                <span className="ws-count-pill">{section.count}</span>
              </h2>
            : groups.length > 0 && <h2 className="notes-home-group" data-note-group-drop="" data-drop-kind={section.kind}>
                <span>{t("No project")}</span>
                <span className="ws-count-pill">{section.count}</span>
              </h2>}
          <ul className="notes-home-list">{section.roots.map((page) => item(page, { flat: activeFilter !== null }))}</ul>
        </section>
      ))}

      {filterEmpty && (
        <p className="notes-home-empty ws-home-empty-card">{t("No notes match.")}</p>
      )}

      {moving && <MoveNoteDialog page={pages.find((page) => page.id === moving.id) ?? moving} groups={groups} error={groupError}
        onMove={onMoveNote} onCreateGroup={onCreateGroup} onClose={() => setMoving(null)} pages={pages} onMoveToPage={onMoveToPage} />}
      {creatingGroup && <GroupNameDialog title={t("New project")} submitLabel={t("Create")} error={groupError} onClose={() => setCreatingGroup(false)}
        onSubmit={async (name) => Boolean(await onCreateGroup(name))} />}
    </div>
  );
}

// ホームと空状態の作成ボタン（#168）。作れる種類がノートだけなら「New note」1 つ。
// 2 つ以上ならノート・スライド・ホワイトボードの 3 枚のスタジオ作成カード（.ws-create-deck）を並べる。
export function NewPageButtons({ kinds, busy, onCreate, onGenerate, className = "" }: { kinds: readonly PageKind[]; busy: boolean; onCreate: (kind: PageKind) => void; onGenerate?: () => void; className?: string }) {
  const { t } = useI18n();
  if (kinds.length < 2) {
    return (
      <button type="button" className={`notes-empty-new ${className}`} disabled={busy} onClick={() => onCreate("note")}>
        <Plus size={16} />{t("New note")}
      </button>
    );
  }
  const deck = (
    <div className={`ws-create-deck ${className}`}>
      {kinds.map((kind) => (
        <button key={kind} type="button" className={`ws-create-card is-${kind}`} disabled={busy} onClick={() => onCreate(kind)}>
          <span className={`ws-create-icon is-${kind}`} aria-hidden="true">
            <PageKindIcon kind={kind} size={18} strokeWidth={1.85} />
          </span>
          <span className="ws-create-label">{t(PAGE_KIND_NEW_LABELS[kind])}</span>
          <span className="ws-create-plus" aria-hidden="true"><Plus size={15} /></span>
          <span className="ws-create-motif" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
  if (!onGenerate || !kinds.includes("slides")) return deck;
  // スライドを作れるときは、カードの下に AI で作る操作を添える。
  return (
    <div className="ws-create-with-ai">
      {deck}
      <button type="button" className="ws-util-pill" disabled={busy} aria-haspopup="dialog" onClick={onGenerate}>
        <AppIcon size={16} /><span>{t("Generate with AI")}</span>
      </button>
    </div>
  );
}
