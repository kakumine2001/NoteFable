"use client";

import type { Block } from "@blocknote/core";
import { FileText, Plus, RefreshCw } from "lucide-react";
import dynamic from "next/dynamic";
import { useLayoutEffect, useRef } from "react";
import type { NoteEditorHandle } from "@/components/note-editor";
import { NoteAssistant } from "@/components/note-assistant";
import { NotePageHeader } from "@/components/note-page-header";
import { NotesHome } from "@/components/notes-home";
import { WorkspaceSwitch, type WorkspaceView } from "@/components/workspace-nav";
import type { useNotePages } from "@/lib/use-note-pages";
import { useI18n, useT } from "@/components/i18n-provider";
import { localizeSystemText } from "@/lib/i18n/translate";
import { pageSettingsOf } from "@/types/notes";

const NoteEditor = dynamic(() => import("@/components/note-editor"), {
  ssr: false, loading: () => <EditorLoading />,
});

function EditorLoading() {
  const t = useT();
  return <p className="notes-loading">{t("Loading editor…")}</p>;
}

// ブロックの JSON が内容として同じか（キーの順序と undefined の項目は無視する。DB の JSONB はキーの順序が変わる）。
export function sameJson(a: unknown, b: unknown): boolean {
  // 配列の中の undefined は JSON では null になる（表の未設定の列幅など）ので、同じとみなす。
  if (a === b || (a == null && b == null)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b || Array.isArray(a) !== Array.isArray(b)) return false;
  // 配列は位置ごとに比べる（下のキーの比較は undefined の要素を飛ばすので、[undefined] と [null] が違って見える）。
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((entry, index) => sameJson(entry, b[index]));
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter((key) => left[key] !== undefined);
  return keys.length === Object.keys(right).filter((key) => right[key] !== undefined).length && keys.every((key) => sameJson(left[key], right[key]));
}

// エディターから届いたブロックが、いま保存キューが持つ内容と変わらないか。空のノート（[]）は、エディターが空の段落を 1 つ足して返すので、それも同じとみなす。
function isUnchanged(next: Block[], current: Block[]) {
  if (sameJson(next, current)) return true;
  const [only] = next;
  return current.length === 0 && next.length === 1 && only.type === "paragraph" && Array.isArray(only.content) && only.content.length === 0 && only.children.length === 0;
}

export function NotesWorkspace({ notes, listMode, model, reasoning, onModelChange, onReasoningChange, onOpen, onCreate, onWorkspaceChange, embedded = false }: {
  notes: ReturnType<typeof useNotePages>;
  listMode: boolean;
  // ノートの AI アシスタントが使うモデルと推論強度（チャットで選んでいるものと同じ）。
  model: string;
  reasoning: string;
  // AI アシスタントの入力欄からモデルと推論強度を変える。/note-embed では渡さない（アプリ側で選ぶ）。
  onModelChange?: (model: string) => void;
  onReasoningChange?: (reasoning: string) => void;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onWorkspaceChange: (view: WorkspaceView) => void;
  // Android アプリの WebView に載せる 1 ページだけの画面（/note-embed）。ノートを開く前に Notes のホームを出さない。
  embedded?: boolean;
}) {
  const { t, locale } = useI18n();
  const { active, activeId, loading, busy, error, backupError } = notes;
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<NoteEditorHandle>(null);
  const emptyPage = active?.content.title === "Untitled" && !active.content.blocks.length;
  // ページの表示設定（全幅・小さな文字・字体）とロック。一覧の 1 件が持つ（/note-embed では開いたページの 1 件だけ）。
  const settings = pageSettingsOf(activeId ? notes.pages.find((page) => page.id === activeId) : undefined);
  const editable = !busy && !settings.locked;
  const pageClass = active && activeId && !listMode
    ? `${settings.fullWidth ? " is-full-width" : ""}${settings.smallText ? " is-small-text" : ""}${settings.font !== "default" ? ` notes-font-${settings.font}` : ""}${settings.locked ? " is-locked" : ""}`
    : "";
  useLayoutEffect(() => {
    if (!titleRef.current) return;
    titleRef.current.style.height = "auto";
    titleRef.current.style.height = `${titleRef.current.scrollHeight}px`;
  }, [active?.content.title, activeId, loading]);
  useLayoutEffect(() => {
    if (!loading && emptyPage && !settings.locked) titleRef.current?.focus();
  }, [activeId, loading, emptyPage, settings.locked]);

  const hasItems = notes.pages.length > 0 || notes.groups.length > 0;
  // 一覧が中身なしのあいだ（読み込み中・失敗・空）は、スマホの「聊天 / 笔记」切り替えを 1 つだけ出し続ける（消えない・作り直さない）。
  // 中身が届いて NotesHome の切り替えに替わるときは、切り替えにあったキーボードのフォーカスを新しい方へ移す。
  const switchFocused = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const focused = document.activeElement;
    if (!switchFocused.current || (focused && focused !== document.body)) return;
    rootRef.current?.querySelector<HTMLElement>('.notion-home-switch [aria-pressed="true"]')?.focus({ preventScroll: true });
  }, [hasItems, loading, error]);

  return <div ref={rootRef} className={`notes-workspace flex-1 overflow-y-auto${pageClass}`}
    onFocus={(event) => { switchFocused.current = !!(event.target as HTMLElement).closest(".notion-home-switch"); }}
    // 要素が消えて外れたフォーカス（relatedTarget なし）は覚えたままにして、上で付け直す。
    onBlur={(event) => { if (event.relatedTarget) switchFocused.current = false; }}>
    {listMode && !hasItems && <div className="notes-column"><div className="notion-home-switch lg:hidden"><WorkspaceSwitch view="pages" onChange={onWorkspaceChange} /></div></div>}
    {error && <div className="notes-column pt-6"><div className="notion-error" role="alert">{localizeSystemText(error, t)}<button type="button" className="notion-button ml-3" onClick={() => void notes.load()}>{t("Retry")}</button></div></div>}
    {listMode && (notes.pages.length > 0 || notes.groups.length > 0) ? (
      <NotesHome pages={notes.pages} groups={notes.groups} groupError={notes.groupError} busy={busy || loading} onOpen={onOpen} onCreate={onCreate}
        onWorkspaceChange={onWorkspaceChange} onReorder={notes.reorder} onMoveNote={notes.moveNote} onCreateGroup={notes.createGroup} onMoveToPage={notes.moveToPage} />
    ) : loading && (!listMode || !(notes.pages.length || notes.groups.length)) ? <div className="notes-column pt-24"><p className="notes-loading">{listMode ? t("Loading notes…") : t("Loading note…")}</p></div> : active && activeId && !listMode ? <>
      <NotePageHeader content={active.content} editable={editable} titleRef={titleRef}
        onPatch={(patch) => active.edit({ ...active.content, ...patch })}
        onTitleKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter" || (event.key === "ArrowDown" && event.currentTarget.selectionStart === event.currentTarget.value.length)) {
            event.preventDefault(); editorRef.current?.focusStart();
          }
        }} />
      <div className="notes-column notes-body">
        {backupError && <div className="notion-warning mb-4" role="alert">{t(backupError)}</div>}
        {!!active.error && <div className="notion-warning mb-5" role="alert">
          <p>{localizeSystemText(active.error, t)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {active.status === "conflict" ? <>
              <button type="button" className="notion-button" disabled={busy} onClick={() => void notes.create(true)}>{t("Save as new note")}</button>
              <button type="button" className="notion-button" onClick={() => { if (window.confirm(t("Discard this unsaved draft and load the latest version?"))) notes.loadLatest(); }}>{t("Load latest")}</button>
            </> : <button type="button" className="notion-button inline-flex items-center gap-2" onClick={() => void active.flush()}><RefreshCw size={13} />{t("Retry save")}</button>}
          </div>
        </div>}
        <NoteEditor key={`${activeId}:${notes.editorEpoch}:${locale}`} blocks={active.content.blocks} editable={editable}
          editorRef={editorRef} onFocusTitle={() => {
            titleRef.current?.focus();
            const end = titleRef.current?.value.length ?? 0;
            titleRef.current?.setSelectionRange(end, end);
          }}
          // 作成・削除の間（busy）に editable が切り替わると、エディターは内容が同じでも変更通知を出す。編集として扱うと、不要な保存（ゴミ箱へ移したノートへの保存を含む）が走る。
          onChange={(blocks) => { if (!isUnchanged(blocks, active.content.blocks)) active.edit({ ...active.content, blocks }); }} />
      </div>
      <NoteAssistant key={activeId} noteId={activeId} noteTitle={active.content.title} model={model} reasoning={reasoning} onModelChange={onModelChange} onReasoningChange={onReasoningChange} flush={() => active.flush()} embedded={embedded} />
    </> : embedded ? !error && <div className="notes-column pt-24"><p className="notes-loading">{t("Loading note…")}</p></div>
    : !error && <>{!listMode && <div className="notes-column"><div className="notion-home-switch lg:hidden"><WorkspaceSwitch view="pages" onChange={onWorkspaceChange} /></div></div>}<div className="notes-column notes-empty">
      <FileText size={28} strokeWidth={1.4} className="text-[var(--notion-faint)]" />
      <h1 className="mt-4 text-[2.5rem] font-[750] leading-tight tracking-[-0.04em] text-[var(--nf-ink)]">{t("Notes")}</h1>
      <p className="mt-2 text-[15px] leading-6 text-[var(--notion-muted)]">{t("Write notes with blocks — type {key} for headings, lists, to-dos and code.").split("{key}").flatMap((part, index) => index ? [<kbd key={index} className="notes-kbd">/</kbd>, part] : [part])}</p>
      <button type="button" disabled={busy} className="notes-empty-new" onClick={onCreate}><Plus size={16} />{t("New note")}</button>
      <p className="mt-10 max-w-sm text-xs leading-5 text-[var(--notion-faint)]">{t("Notes are saved on the server and linked to this device. Sign in to open them on other devices. Clearing app or site data creates a separate workspace.")}</p>
    </div></>}
  </div>;
}
