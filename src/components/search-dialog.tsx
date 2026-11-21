"use client";

import { FileText, Loader2, MessageSquareText, Paperclip, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "@/components/search-dialog.css";
import { findTermRanges } from "@/lib/search-fold";
import { useBackToClose } from "@/lib/use-back-to-close";
import { MAX_SEARCH_QUERY_CHARS, parseSearchTerms, type ChatSearchResult, type NoteSearchResult, type SearchResponse, type SearchScope } from "@/types/search";
import { useI18n } from "@/components/i18n-provider";
import type { TextDirection } from "@/lib/i18n/locale";
import { msg } from "@/lib/i18n/translate";

type Result = NoteSearchResult | ChatSearchResult;
// key は「どの検索条件の結果か」。data が null なら、その条件の検索に失敗した。
type Loaded = { key: string; data: SearchResponse | null };
export type SearchProject = { id: string; name: string };

const DEBOUNCE_MS = 250;
const TABS: { scope: SearchScope; label: string }[] = [{ scope: "all", label: msg("All") }, { scope: "chats", label: msg("Chats") }, { scope: "notes", label: msg("Notes") }];

export function nextSearchTabScope(index: number, key: "ArrowLeft" | "ArrowRight", dir: TextDirection = "ltr"): SearchScope {
  const step = (dir === "rtl" ? key === "ArrowLeft" : key === "ArrowRight") ? 1 : TABS.length - 1;
  return TABS[(index + step) % TABS.length].scope;
}

// 一致した語を <mark> で囲むための分割。語は畳み込み済み（parseSearchTerms の結果）。大文字小文字・全角半角・ひらがなカタカナの違いを越えて
// 一致し、囲む範囲は元の文字のまま（"api" は "ＡＰＩ" を、"データ" は "でーた" を囲む）。重なったときは左を、同じ位置では長い語を優先する。
export function splitHighlight(text: string, terms: string[]): { text: string; match: boolean }[] {
  if (!text) return [];
  const parts: { text: string; match: boolean }[] = [];
  let last = 0;
  for (const { start, end } of findTermRanges(text, terms)) {
    if (start > last) parts.push({ text: text.slice(last, start), match: false });
    parts.push({ text: text.slice(start, end), match: true });
    last = end;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts;
}

// 絞り込みの選択肢。いま開いている会話のプロジェクトを先頭に、あとは渡された順。
export function orderProjects(projects: SearchProject[], currentProjectId?: string | null): SearchProject[] {
  const current = currentProjectId ? projects.find((project) => project.id === currentProjectId) : undefined;
  return current ? [current, ...projects.filter((project) => project !== current)] : projects;
}

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  return <>{splitHighlight(text, terms).map((part, index) => part.match ? <mark key={index}>{part.text}</mark> : part.text)}</>;
}

function formatDate(value: string, tag: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(tag, sameYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" });
}

// BlockNote のエディター（と、その上に出る小窓）の中かどうか。ProseMirror は contenteditable なので isContentEditable でも拾える。
function inEditor(target: EventTarget | null) {
  const element = target as Partial<HTMLElement> | null;
  if (!element) return false;
  return element.isContentEditable === true || (typeof element.closest === "function" && !!element.closest(".bn-container, .bn-editor, .ProseMirror, [contenteditable='true'], [contenteditable='']"));
}

type ShortcutEvent = Pick<globalThis.KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "repeat" | "defaultPrevented"> & { isComposing?: boolean; target: EventTarget | null };

// Ctrl/Cmd+K で検索を開くか。エディターの中では開かない（BlockNote は Ctrl/Cmd+K をリンクの挿入に使い、ここで奪うとリンクが付けられなくなる）。
// 普通の入力欄（チャットの入力欄やタイトル）では開く。
export function isSearchShortcut(event: ShortcutEvent) {
  if (event.defaultPrevented || event.repeat || event.isComposing) return false;
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "k") return false;
  return !inEditor(event.target);
}

export function useSearchShortcut(onOpen: () => void) {
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (!isSearchShortcut(event)) return;
      // 確認ダイアログなど、画面全体を覆う小窓が開いている間は開かない。
      if (document.querySelector("dialog[open]")) return;
      // ブラウザの「検索バーへ移動」（Ctrl+K）を止めて、アプリの検索を開く。
      event.preventDefault();
      onOpenRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

function ResultRow({ id, index, result, terms, projectName, active, onHover, onSelect }: {
  id: string; index: number; result: Result; terms: string[]; projectName?: string; active: boolean; onHover: (index: number) => void; onSelect: (result: Result) => void;
}) {
  const { t, tag } = useI18n();
  const icon = result.icon ?? (result.kind === "note" ? <FileText size={16} /> : <MessageSquareText size={16} />);
  const fileName = result.kind === "chat" ? result.attachmentName : null;
  // 添付ファイルの本文に当たったときは、話し手ではなくファイル名を示す。
  const speaker = result.kind === "chat" && !fileName && result.snippet && result.role ? (result.role === "USER" ? t("You: ") : t("NoteFable: ")) : "";
  return (
    // フォーカスは入力欄に残し、行は aria-activedescendant で示す。クリック時に入力欄のフォーカスが外れないよう mousedown を止める。
    <div role="option" id={id} aria-selected={active} data-index={index} className={`search-row${active ? " is-active" : ""}`}
      onMouseMove={() => onHover(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => onSelect(result)}>
      <span className="search-row-icon" aria-hidden="true">{icon}</span>
      <span className="search-row-text">
        <span className="search-row-head">
          <span className="search-row-title"><Highlight text={result.title} terms={terms} /></span>
          {projectName && <span className="search-row-project" title={projectName}>{projectName}</span>}
        </span>
        {result.snippet && (
          <span className="search-row-snippet">
            {fileName && <span className="search-row-file"><Paperclip size={12} aria-hidden="true" />{t("in {fileName}", { fileName })}</span>}
            {speaker}<Highlight text={result.snippet} terms={terms} />
          </span>
        )}
      </span>
      <span className="search-row-date">{formatDate(result.updatedAt, tag)}</span>
    </div>
  );
}

function SearchPanel({ view, projects, currentProjectId, onClose, onOpenChat, onOpenNote }: Omit<SearchDialogProps, "open">) {
  const { t, dir } = useI18n();
  const [input, setInput] = useState("");
  const [scope, setScope] = useState<SearchScope>("all");
  // Chats タブの絞り込み。"" はすべてのプロジェクト。
  const [projectChoice, setProjectChoice] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [retry, setRetry] = useState(0);
  const [active, setActive] = useState(0);
  // 開く前にフォーカスがあった要素。入力欄にフォーカスが移る前（描画中）に控える。
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const baseId = useId();

  const projectOptions = orderProjects(projects ?? [], currentProjectId);
  const projectNames = new Map(projectOptions.map((project) => [project.id, project.name]));
  // 絞り込みは Chats タブだけ。消えたプロジェクトが選ばれたままなら「すべて」に戻す。
  const projectId = scope === "chats" && projectNames.has(projectChoice) ? projectChoice : "";
  const query = input.trim().slice(0, MAX_SEARCH_QUERY_CHARS);
  const key = `${scope}\n${projectId}\n${query}\n${retry}`;

  useEffect(() => {
    if (!query) return;
    // 入力が止まってから検索する。条件が変わったら前のリクエストは中止し、遅れて届いた古い結果は捨てる。
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: query, scope });
        if (projectId) params.set("projectId", projectId);
        const response = await fetch(`/api/search?${params}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(`Search failed with ${response.status}`);
        const data = await response.json() as SearchResponse;
        if (controller.signal.aborted) return;
        setLoaded({ key, data });
        setActive(0);
      } catch {
        if (!controller.signal.aborted) setLoaded({ key, data: null });
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, query, scope, projectId]);

  // 開いたら入力欄にフォーカスし、閉じたら開く前にいた場所へ戻す（画面から消えた要素は無視する）。
  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [opener]);

  const idle = query === "";
  const current = !idle && loaded?.key === key ? loaded : null;
  const failed = current !== null && current.data === null;
  const loading = !idle && current === null;
  // 検索中は直前の結果を薄く出したままにする（入力のたびに画面が空にならない）。
  const data = idle || failed ? null : (current ?? loaded)?.data ?? null;
  const terms = data ? parseSearchTerms(data.query) : [];
  const chats = scope === "notes" ? [] : data?.chats ?? [];
  const notes = scope === "chats" ? [] : data?.notes ?? [];
  const groups: { label: string; results: Result[] }[] = (view === "chat"
    ? [{ label: t("Chats"), results: chats }, { label: t("Notes"), results: notes }]
    : [{ label: t("Notes"), results: notes }, { label: t("Chats"), results: chats }]
  ).filter((group) => group.results.length > 0);
  const rows = groups.flatMap((group) => group.results);
  const activeIndex = Math.min(active, rows.length - 1);
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  function select(result: Result) {
    // 先に閉じてから移動する（移動の履歴操作は、シートを閉じる処理より前に走らせる）。
    onClose();
    if (result.kind === "note") onOpenNote(result.id, result.blockId ?? undefined);
    else onOpenChat(result.id, result.messageId ?? undefined);
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // 日本語などの変換中の矢印・Enter は変換の操作なので奪わない。Esc は useBackToClose が閉じる。
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!rows.length) return;
      event.preventDefault();
      const next = (activeIndex + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length;
      setActive(next);
      bodyRef.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && current && rows[activeIndex]) {
      event.preventDefault();
      select(rows[activeIndex]);
    }
  }

  // Tab で小窓の外へ出ないよう、先頭と末尾でつなぐ。
  function onPanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)")].filter((item) => item.tabIndex >= 0);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function changeScope(next: SearchScope) {
    setScope(next);
    setActive(0);
    inputRef.current?.focus();
  }

  // フォーカスは選択欄に残す（矢印キーで選択肢を順に動かせるように、入力欄へは戻さない）。
  function changeProject(next: string) {
    setProjectChoice(next);
    setActive(0);
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    // 矢印キーではフォーカスをタブに残す（入力欄へ移すと、続けて矢印でタブを動かせない）。
    const next = nextSearchTabScope(index, event.key, dir);
    setScope(next);
    setActive(0);
    document.getElementById(`${baseId}-tab-${next}`)?.focus();
  }

  let body: ReactNode;
  if (idle) {
    body = (
      <div className="search-empty">
        <p className="search-empty-title">{t("Search your chats and notes")}</p>
        <p>{t("Every word you type has to appear somewhere in the same chat or note: its title, a message or an attached file.")}</p>
        <p className="search-keys">{t("Use ↑ ↓ to move, Enter to open, Esc to close.")}</p>
      </div>
    );
  } else if (failed) {
    body = (
      <div className="search-empty" role="alert">
        <p className="search-empty-title">{t("Search is unavailable")}</p>
        <p>{t("Check your connection and try again.")}</p>
        <button type="button" className="notion-button" onClick={() => setRetry((count) => count + 1)}>{t("Try again")}</button>
      </div>
    );
  } else if (loading && !rows.length) {
    body = <div className="search-empty search-loading" role="status"><Loader2 size={16} className="search-spinner" aria-hidden="true" />{t("Searching…")}</div>;
  } else if (!rows.length) {
    body = (
      <div className="search-empty">
        <p className="search-empty-title">{t("No results for “{query}”", { query: data?.query ?? query })}</p>
        <p>{t("Try fewer words. Upper/lower case, full-width/half-width and hiragana/katakana are treated as the same, but synonyms and other spellings are not found.")}</p>
      </div>
    );
  } else {
    let index = 0;
    body = (
      <div role="listbox" id={listId} aria-label={t("Search results")} className={loading ? "search-list is-stale" : "search-list"}>
        {groups.map((group) => (
          <div key={group.label} role="group" aria-labelledby={`${baseId}-${group.label}`}>
            <div id={`${baseId}-${group.label}`} className="search-group-title">{group.label}</div>
            {group.results.map((result) => {
              const rowIndex = index++;
              const projectName = result.kind === "chat" && result.projectId ? projectNames.get(result.projectId) : undefined;
              return <ResultRow key={`${result.kind}:${result.id}`} id={optionId(rowIndex)} index={rowIndex} result={result} terms={terms} projectName={projectName}
                active={rowIndex === activeIndex} onHover={setActive} onSelect={select} />;
            })}
          </div>
        ))}
      </div>
    );
  }

  const status = idle ? "" : failed ? t("Search is unavailable.") : loading ? t("Searching.") : (rows.length === 1 ? t("1 result.") : t("{count} results.", { count: rows.length }));
  const listboxShown = rows.length > 0 && !failed;

  return (
    <div className="search-root">
      <div className="search-backdrop" aria-hidden="true" onMouseDown={onClose} />
      <div className="search-panel" role="dialog" aria-modal="true" aria-label={t("Search chats and notes")} onKeyDown={onPanelKeyDown}>
        <div className="search-field">
          <Search size={18} aria-hidden="true" className="search-field-icon" />
          <input ref={inputRef} value={input} maxLength={MAX_SEARCH_QUERY_CHARS} type="text" inputMode="search" enterKeyHint="search"
            autoComplete="off" autoCorrect="off" spellCheck={false} placeholder={t("Search chats and notes")} aria-label={t("Search chats and notes")} className="search-input"
            role="combobox" aria-expanded={listboxShown} aria-controls={listboxShown ? listId : undefined} aria-autocomplete="list" aria-busy={loading}
            aria-activedescendant={listboxShown && !loading ? optionId(activeIndex) : undefined}
            onChange={(event) => { setInput(event.target.value); setActive(0); }} onKeyDown={onInputKeyDown} />
          {loading && <Loader2 size={16} className="search-spinner" aria-hidden="true" />}
          <button type="button" className="search-close" aria-label={t("Close search")} onClick={onClose}><X size={18} /></button>
        </div>
        <div className="search-toolbar">
          <div className="search-tabs" role="tablist" aria-label={t("Search in")}>
            {TABS.map((tab, index) => (
              <button key={tab.scope} type="button" role="tab" id={`${baseId}-tab-${tab.scope}`} aria-selected={scope === tab.scope} aria-controls={`${baseId}-panel`}
                tabIndex={scope === tab.scope ? 0 : -1} className="search-tab" onClick={() => changeScope(tab.scope)} onKeyDown={(event) => onTabKeyDown(event, index)}>
                {t(tab.label)}
              </button>
            ))}
          </div>
          {scope === "chats" && projectOptions.length > 0 && (
            <select className="search-project" aria-label={t("Project")} value={projectId} onChange={(event) => changeProject(event.target.value)}>
              <option value="">{t("All projects")}</option>
              {projectOptions.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          )}
        </div>
        <div className="search-body" ref={bodyRef} id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${scope}`}>{body}</div>
        <p className="search-sr" role="status" aria-live="polite">{status}</p>
      </div>
    </div>
  );
}

export type SearchDialogProps = {
  open: boolean;
  onClose: () => void;
  // いま開いている画面。同じ種類の結果（chat なら Chats、pages なら Notes）を先に並べる。
  view: "chat" | "pages";
  // Chats タブで会話を絞り込めるプロジェクト。空か未指定なら絞り込みは出さない。
  projects?: SearchProject[];
  // いま開いている会話のプロジェクト。選択肢の先頭に置く（最初の絞り込みは、これではなく「すべてのプロジェクト」）。
  currentProjectId?: string | null;
  onOpenChat: (id: string, messageId?: string) => void;
  onOpenNote: (id: string, blockId?: string) => void;
};

// Chats と Notes をまとめて探す小窓（Ctrl/Cmd+K）。スマホ（640px 未満）では全画面のシートになり、端末の「戻る」で閉じる。
// 開いている間だけ中身を載せるので、開くたびに入力・タブ・結果は空に戻る。
export function SearchDialog({ open, onClose, view, projects, currentProjectId, onOpenChat, onOpenNote }: SearchDialogProps) {
  useBackToClose(open, onClose);
  if (!open || typeof document === "undefined") return null;
  return createPortal(<SearchPanel view={view} projects={projects} currentProjectId={currentProjectId} onClose={onClose} onOpenChat={onOpenChat} onOpenNote={onOpenNote} />, document.body);
}
