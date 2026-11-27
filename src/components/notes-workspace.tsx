"use client";

import type { Block } from "@blocknote/core";
import { LayoutGrid, RefreshCw, Upload } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { NoteEditorHandle } from "@/components/note-editor";
import { CanvasPagePlaceholder } from "@/components/canvas-page-placeholder";
import { CANVAS_EDITORS } from "@/components/canvas-editors";
import { flushCanvasEditors } from "@/lib/canvas-flush";
import {
  applyExplicitSelection, applyLiveSelection, clearActiveSelection, resolveActiveSelection, type CanvasAiSelectionState,
} from "@/lib/canvas-selection-state";
import { PageAssistant } from "@/components/page-assistant";
import { NoteFloatingToc } from "@/components/note-floating-toc";
import { NotePageHeader } from "@/components/note-page-header";
import { NewPageButtons, NotesHome } from "@/components/notes-home";
import { WorkspaceSwitch, type WorkspaceView } from "@/components/workspace-nav";
import type { useNotePages } from "@/lib/use-note-pages";
import { useI18n, useT } from "@/components/i18n-provider";
import { localizeSystemText } from "@/lib/i18n/translate";
import { StorageLimitPrompt } from "@/components/guest-limit-prompt";
import { nativeCanOpenChat, nativeCanOpenPage, nativeCanShowStorageLimit, postToNative } from "@/lib/native-bridge";
import { NoteBacklinksSection } from "@/components/note-backlinks";
import { SLIDES_EVENTS } from "@/lib/slides/ai-context";
import { creatablePageKinds, isCanvasKind, pageKindFeatures, pageKindOf } from "@/lib/page-kinds";
import type { NewPageRequest } from "@/lib/workspace-sections";
import { STORAGE_LIMIT_EVENT, type StorageLimitDetail } from "@/lib/storage-limit-client";
import { pageSettingsOf } from "@/types/notes";
import type { PageSelection } from "@/lib/page-ai/types";
import { normalizeQuote } from "@/lib/chat-quote";

const NoteEditor = dynamic(() => import("@/components/note-editor"), {
  ssr: false, loading: () => <EditorLoading />,
});
// ノートの一時放映は「放映」を押したときだけ読み込む（通常のノート表示の初回バンドルにスライドのコード・CSS を入れない）。
const NotePresentPlayer = dynamic(() => import("@/components/slides/note-present-player"), { ssr: false });

function NotePresentationBridge({
  title, icon, blocks, parentId, groupId, embedded, onOpenSaved,
}: {
  title: string;
  icon: string | null;
  blocks: unknown;
  parentId: string | null;
  groupId: string | null;
  embedded: boolean;
  onOpenSaved: (id: string) => void;
}) {
  const [presenting, setPresenting] = useState(false);
  useEffect(() => {
    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string }>).detail;
      if (detail?.action === "present") setPresenting(true);
    };
    window.addEventListener(SLIDES_EVENTS.command, onCommand);
    return () => window.removeEventListener(SLIDES_EVENTS.command, onCommand);
  }, []);
  if (!presenting) return null;
  return (
    <NotePresentPlayer
      title={title}
      icon={icon}
      blocks={blocks}
      parentId={parentId}
      groupId={groupId}
      embedded={embedded}
      onExit={() => setPresenting(false)}
      onSaved={(id) => { setPresenting(false); onOpenSaved(id); }}
    />
  );
}

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

// ノートの画像・ファイル・カバー・アイコンが容量の上限で断られたときの案内（storage-limit-client.ts のイベント）。
// アプリに埋め込んだ編集画面では、案内を出せるアプリならアプリの画面に任せ、古いアプリでは理由だけを出す（ボタンなし）。
function NoteStorageLimitNotice({ embedded }: { embedded: boolean }) {
  const [limit, setLimit] = useState<StorageLimitDetail | null>(null);
  useEffect(() => {
    const onLimit = (event: Event) => {
      const detail = (event as CustomEvent<StorageLimitDetail>).detail;
      if (!detail) return;
      if (embedded && nativeCanShowStorageLimit() && postToNative({ type: "storageLimit", tier: detail.tier, used: detail.used, limit: detail.limit })) return;
      setLimit(detail);
    };
    window.addEventListener(STORAGE_LIMIT_EVENT, onLimit);
    return () => window.removeEventListener(STORAGE_LIMIT_EVENT, onLimit);
  }, [embedded]);
  if (!limit) return null;
  // 長いノートの下の方で貼り付けたときも見えるよう、書き出しの失敗と同じくスクロールする領域の上端に留める。
  return <div className="notes-storage-limit notes-column pt-6"><StorageLimitPrompt limit={limit} actions={!embedded} className="" onClose={() => setLimit(null)} /></div>;
}

// 保存できなかった・衝突したときの案内（ノートとホワイトボード・スライドで共通）。衝突は「新しいページとして保存」か「最新版を読み込む」。
function NoteSaveWarnings({ notes }: { notes: ReturnType<typeof useNotePages> }) {
  const t = useT();
  const { active, busy, backupError } = notes;
  if (!active) return null;
  return <>
    {backupError && <div className="notion-warning mb-4" role="alert">{t(backupError)}</div>}
    {!!active.error && <div className="notion-warning mb-5" role="alert">
      <p>{localizeSystemText(active.error, t)}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {active.status === "conflict" ? <>
          <button type="button" className="notion-button" disabled={busy} onClick={() => void notes.create(true)}>{t("Save as new page")}</button>
          <button type="button" className="notion-button" onClick={() => { if (window.confirm(t("Discard this unsaved draft and load the latest version?"))) void notes.loadLatest(); }}>{t("Load latest")}</button>
        </> : <button type="button" className="notion-button inline-flex items-center gap-2" onClick={() => void active.flush()}><RefreshCw size={13} />{t("Retry save")}</button>}
      </div>
    </div>}
  </>;
}

export function NotesWorkspace({ notes, listMode, model, reasoning, onModelChange, onReasoningChange, onOpen, onOpenChat, onCreate, onGenerateSlides, onImport, onWorkspaceChange, embedded = false, split = false, onAskSelectionInChat }: {
  notes: ReturnType<typeof useNotePages>;
  listMode: boolean;
  // ノートの AI アシスタントが使うモデルと推論強度（チャットで選んでいるものと同じ）。
  model: string;
  reasoning: string;
  // AI アシスタントの入力欄からモデルと推論強度を変える。/note-embed では渡さない（アプリ側で選ぶ）。
  onModelChange?: (model: string) => void;
  onReasoningChange?: (reasoning: string) => void;
  onOpen: (id: string) => void;
  // バックリンクの会話を開く（messageId はそのページを添付した発言）。/note-embed では渡さず、アプリに openChat を送る。
  onOpenChat?: (id: string, messageId?: string) => void;
  // 新しいページを作る（ホームと空状態の作成ボタン）。省略はプロジェクトなしのノート。
  onCreate: (request?: NewPageRequest) => void;
  // ホームと空状態の「Generate with AI」（AI のスライド生成の窓）。
  onGenerateSlides?: () => void;
  onImport?: (files: File[]) => void;
  onWorkspaceChange: (view: WorkspaceView) => void;
  // Android アプリの WebView に載せる 1 ページだけの画面（/note-embed）。ノートを開く前に Notes のホームを出さない。
  embedded?: boolean;
  // デスクトップの分割表示（チャットと並べて表示）。余白を詰め、右下の AI ボタンは隠す。
  split?: boolean;
  // 分割表示中にエディターで「Ask AI」を押したとき、左のチャットへ選択内容（引用・要素 ID・選区画像）を渡す。
  onAskSelectionInChat?: (selection: PageSelection) => void;
}) {
  const { t, locale } = useI18n();
  const { active, activeId, loading, listLoading, openingId, busy, error, actionError } = notes;
  // エディターで選んで「Ask NoteFable / Ask AI」に渡した抜粋、またはキャンバス上でリアルタイムに選んでいる要素と、アシスタントを開く合図。
  // どのノートのものかを持ち、別のノートへ移ったら効かない（PageSelection）。
  const [aiAsk, setAiAsk] = useState<CanvasAiSelectionState | null>(null);
  // ホワイトボード・スライドのエディターが空けた AI ボタンの置き場所（CanvasEditorProps.aiSlot の目印）。
  const [aiAnchor, setAiAnchor] = useState<HTMLElement | null>(null);
  const [generateImageRequest, setGenerateImageRequest] = useState<{ pageId: string; signal: number } | null>(null);
  const pageGenerateImageSignal = generateImageRequest && generateImageRequest.pageId === activeId ? generateImageRequest.signal : 0;
  const requestPageImageGeneration = useCallback(() => {
    if (!activeId) return;
    setGenerateImageRequest((current) => ({ pageId: activeId, signal: (current?.signal ?? 0) + 1 }));
  }, [activeId]);
  const consumePageImageGeneration = useCallback(() => {
    if (!activeId) return;
    setGenerateImageRequest((current) => (current?.pageId === activeId ? null : current));
  }, [activeId]);
  const aiSelection = resolveActiveSelection(aiAsk, activeId);
  const aiOpenSignal = aiAsk && aiAsk.noteId === activeId ? aiAsk.signal : 0;
  const handleCanvasSelectionChange = useCallback((selection: PageSelection | null) => {
    if (!activeId) return;
    setAiAsk((current) => applyLiveSelection(current, activeId, selection));
  }, [activeId]);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<NoteEditorHandle>(null);
  const emptyImportRef = useRef<HTMLInputElement>(null);
  const emptyPage = active?.content.title === "Untitled" && !active.content.blocks.length;
  // ページの表示設定（全幅・小さな文字・字体）とロック。一覧の 1 件が持つ（/note-embed では開いたページの 1 件だけ）。
  const activeSummary = activeId ? notes.pages.find((page) => page.id === activeId) : undefined;
  const settings = pageSettingsOf(activeSummary);
  // ページの種類。一覧の 1 件（/note-embed では開いたページの 1 件だけ）か、読み込んだページの行が持つ。
  const activeKind = pageKindOf(activeSummary?.kind ? activeSummary : active?.page);
  // ホワイトボード・スライドのエディター（種類の表でエディターがあり、画面に登録があるときだけ）。
  // 本体を持たないキュー（本体なしの応答から作られたもの）には作らない（空の本体で編集を始めさせない）。
  const canvasData = active?.content.data ?? active?.page.data;
  // この描画の時点で、キューの中身がサーバーの版で何回置き換えられたか（キャンバスのエディターが渡す変更の照合に使う）。
  const canvasGeneration = active?.generation ?? 0;
  const CanvasEditor = isCanvasKind(activeKind) && pageKindFeatures(activeKind).editor && canvasData ? CANVAS_EDITORS[activeKind] : undefined;
  const canvasEditorOpen = Boolean(CanvasEditor && active && activeId && !listMode && !loading);
  const editable = !busy && !settings.locked;
  const pageClass = active && activeId && !listMode
    ? `${settings.fullWidth ? " is-full-width" : ""}${settings.smallText ? " is-small-text" : ""}${settings.font !== "default" ? ` notes-font-${settings.font}` : ""}${settings.locked ? " is-locked" : ""}${split ? " is-split" : ""}`
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
  // 中身が届いて NotesHome の切り替えに替わるときは、切り替えにあったキーボードのフォーカスを新しい方の同じボタン（聊天 / 笔记）へ移す。
  // フォーカスしていたボタンの位置。切り替えの外なら null。
  const switchFocused = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // ページ切り替え・ホームとの行き来で前のスクロール位置を残さない（同じページの裏同期では維持する）。
  useLayoutEffect(() => {
    if (rootRef.current) rootRef.current.scrollTop = 0;
  }, [activeId, listMode]);
  useLayoutEffect(() => {
    const focused = document.activeElement;
    if (switchFocused.current === null || (focused && focused !== document.body)) return;
    rootRef.current?.querySelectorAll<HTMLElement>(".notion-home-switch button")[switchFocused.current]?.focus({ preventScroll: true });
  }, [hasItems, loading, error]);

  return <div ref={rootRef} className={`notes-workspace flex-1 overflow-y-auto${pageClass}${canvasEditorOpen ? " is-canvas-editor" : ""}`}
    onFocus={(event) => {
      const button = (event.target as HTMLElement).closest(".notion-home-switch button");
      switchFocused.current = button?.parentElement ? Array.from(button.parentElement.children).indexOf(button) : null;
    }}
    // 要素が消えて外れたフォーカス（relatedTarget なし）は覚えたままにして、上で付け直す。
    onBlur={(event) => { if (event.relatedTarget) switchFocused.current = null; }}>
    {openingId && (listMode || active) && <div className="notes-switch-progress" role="progressbar" aria-label={t("Loading page…")} />}
    {listMode && !hasItems && <div className="notes-column"><div className="notion-home-switch lg:hidden"><WorkspaceSwitch view="pages" onChange={onWorkspaceChange} /></div></div>}
    {error && <div className="notes-column pt-6"><div className="notion-error" role="alert">{localizeSystemText(error, t)}<button type="button" className="notion-button ml-3" onClick={() => void notes.load()}>{t("Retry")}</button></div></div>}
    <NoteStorageLimitNotice embedded={embedded} />
    {actionError && <div className="notes-action-error notes-column pt-6"><div className="notion-error" role="alert">{localizeSystemText(actionError, t)}<button type="button" className="notion-button ml-3" onClick={notes.dismissActionError}>{t("Close")}</button></div></div>}
    {listMode && (notes.pages.length > 0 || notes.groups.length > 0) ? (
      <NotesHome pages={notes.pages} groups={notes.groups} groupError={notes.groupError} busy={busy} onOpen={onOpen}
        onPrefetch={notes.prefetch} onCancelPrefetch={notes.cancelPrefetch} onCreate={onCreate} onGenerateSlides={onGenerateSlides} onImport={onImport}
        onWorkspaceChange={onWorkspaceChange} onReorder={notes.reorder} onMoveNote={notes.moveNote} onCreateGroup={notes.createGroup} onMoveToPage={notes.moveToPage} />
    ) : loading && (!listMode || !(notes.pages.length || notes.groups.length)) ? <div className="notes-column pt-24"><p className="notes-loading">{listMode ? t("Loading pages…") : t("Loading page…")}</p></div>
    // ホワイトボード・スライドは種類ごとのエディター（canvas-editors.tsx）。エディターがまだ無い種類は読み取り専用の仮の画面
    // （ノートのエディター・AI ボタンは出さない。保存もしない）。
    : active && activeId && !listMode && isCanvasKind(activeKind) ? <>
      {CanvasEditor ? <div className="canvas-editor-shell">
        <div className="canvas-editor-warnings"><NoteSaveWarnings notes={notes} /></div>
        <CanvasEditor key={`${activeId}:${notes.editorEpoch}`} pageId={activeId} kind={activeKind} title={active.content.title} icon={active.content.icon}
          data={canvasData!} version={active.version} generation={canvasGeneration} editable={editable} embedded={embedded} split={split} saveStatus={active.status}
          // 同じ内容の通知（作成・削除の途中で editable が替わったときなど）では、要らない保存を走らせない。
          // 中身をサーバーの版で置き換えた後（最新の版を読む・版の復元）は、置き換える前のエディターが閉じる時に渡す古い変更を捨てる。
          onChange={(data) => { if (active.generation === canvasGeneration && data !== active.content.data) active.edit({ ...active.content, data }); }}
          onTitleChange={(title) => { if (title !== active.content.title) active.edit({ ...active.content, title }); }}
          onIconChange={(icon) => { if (icon !== active.content.icon) active.edit({ ...active.content, icon }); }}
          // 埋め込み（/note-embed）は一覧を持たない。リンク先を選ぶ時にエディターが自分で読む。
          pages={embedded || (listLoading && !notes.pages.length) ? undefined : notes.pages}
          onOpenPage={(id) => { if (!embedded) { onOpen(id); return true; } return nativeCanOpenPage() && postToNative({ type: "openPage", id }); }}
          // 選んだ要素・スライドについて AI に聞く（AI パネルを開き、選んだものを文脈として渡す）。
          onAskAi={(selection) => {
            // 分割表示では AI パネルを出さないので、選んだ抜粋・要素 ID・選区画像コールバックを左のチャットへ渡す。
            if (split && onAskSelectionInChat) {
              if (normalizeQuote(selection.text) || selection.ids?.length || selection.captureImage) {
                onAskSelectionInChat(selection);
              }
              return;
            }
            setAiAsk((current) => applyExplicitSelection(current, activeId, selection));
          }}
          // キャンバス上の選択が変わったことをリアルタイムに AI パネルへ同期する（分割表示時は明示の「Ask NoteFable」のみチャットへ渡す）。
          onSelectionChange={split ? undefined : handleCanvasSelectionChange}
          // 分割表示では AI ボタンを出さないので、置き場所も作らない。
          aiSlot={split ? undefined : <span ref={setAiAnchor} className="page-ai-anchor" aria-hidden="true" />}
          generateImageSignal={pageGenerateImageSignal}
          onConsumeGenerateImage={consumePageImageGeneration} />
      </div> : <>
        {(!!active.error || !!notes.backupError) && <div className="notes-column pt-6"><NoteSaveWarnings notes={notes} /></div>}
        <CanvasPagePlaceholder key={`${activeId}:${notes.editorEpoch}`} kind={activeKind} title={active.content.title} icon={active.content.icon} data={active.page.data} />
      </>}
      {/* AI パネル（AI 操控底座）。エディターが選んだ要素・スライドを selection で渡す。AI が操作できない種類は読むだけ。
          送る前の flush は、ホワイトボードなどがまだ保存キューへ渡していない変更（描き終わり・文字の確定の直後）も先に渡してもらう（版の履歴と同じ）。 */}
      <PageAssistant key={activeId} pageId={activeId} pageKind={activeKind} pageTitle={active.content.title} pageLocked={Boolean(active.page.locked)} model={model} reasoning={reasoning}
        onModelChange={onModelChange} onReasoningChange={onReasoningChange} flush={async () => { if (!(await flushCanvasEditors())) return false; return active.flush(); }} embedded={embedded}
        selection={aiSelection} onClearSelection={(sent) => setAiAsk((current) => clearActiveSelection(current, activeId, sent))}
        openSignal={aiOpenSignal} hidden={split} anchor={CanvasEditor && !split ? aiAnchor : null}
        onGenerateImage={CanvasEditor && editable ? requestPageImageGeneration : undefined} />
    </>
    : active && activeId && !listMode ? <>
      <NotePageHeader key={`header:${activeId}`} content={active.content} editable={editable} titleRef={titleRef}
        onPatch={(patch) => active.edit({ ...active.content, ...patch })}
        onTitleKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter" || (event.key === "ArrowDown" && event.currentTarget.selectionStart === event.currentTarget.value.length)) {
            event.preventDefault(); editorRef.current?.focusStart();
          }
        }} />
      <div className="notes-column notes-body">
        <NoteSaveWarnings notes={notes} />
        <NoteEditor key={`${activeId}:${notes.editorEpoch}:${locale}`} blocks={active.content.blocks} editable={editable}
          embedded={embedded}
          generateImageSignal={pageGenerateImageSignal}
          onConsumeGenerateImage={consumePageImageGeneration}
          workspaceRef={rootRef}
          // 埋め込み（/note-embed）は一覧を持たないので、エディターが自分で読む。メンションを押したらアプリに開いてもらう。
          // 一覧の読み込み中（まだ空）は「不明」として渡さない。空の一覧を渡すと、すべてのメンションが「開けない」表示になる。
          pages={embedded || (listLoading && !notes.pages.length) ? undefined : notes.pages} currentPageId={activeId} pageMentions={!embedded || nativeCanOpenPage()}
          // 埋め込みでは、openPage を処理できるアプリにだけ送る。古いアプリ・ブラウザでは false を返し、エディターは元どおりリンクを新しいウィンドウで開く。
          onOpenPage={(id) => { if (!embedded) { onOpen(id); return true; } return nativeCanOpenPage() && postToNative({ type: "openPage", id }); }}
          editorRef={editorRef} onFocusTitle={() => {
            titleRef.current?.focus();
            const end = titleRef.current?.value.length ?? 0;
            titleRef.current?.setSelectionRange(end, end);
          }}
          onSelectionChange={split ? undefined : handleCanvasSelectionChange}
          onAskAi={(selection) => {
            if (split && onAskSelectionInChat) {
              if (normalizeQuote(selection.text) || selection.ids?.length) onAskSelectionInChat(selection);
              return;
            }
            setAiAsk((current) => applyExplicitSelection(current, activeId, selection));
          }}
          // 作成・削除の間（busy）に editable が切り替わると、エディターは内容が同じでも変更通知を出す。編集として扱うと、不要な保存（ゴミ箱へ移したノートへの保存を含む）が走る。
          onChange={(blocks) => { if (!isUnchanged(blocks, active.content.blocks)) active.edit({ ...active.content, blocks }); }} />
        {/* バックリンク：このページを指すページと、このページを使った会話。埋め込みでは、開く手段をアプリが持つものだけを出す。 */}
        <NoteBacklinksSection pageId={activeId} embedded={embedded}
          onOpenPage={!embedded ? onOpen : nativeCanOpenPage() ? (id) => { postToNative({ type: "openPage", id }); } : undefined}
          onOpenChat={!embedded ? onOpenChat
            : nativeCanOpenChat() ? (id, messageId) => { postToNative(messageId ? { type: "openChat", id, messageId } : { type: "openChat", id }); } : undefined} />
      </div>
      {!embedded && !split && <NoteFloatingToc blocks={active.content.blocks} scrollRootRef={rootRef} activeId={activeId} />}
      <PageAssistant key={activeId} pageId={activeId} pageTitle={active.content.title} pageLocked={Boolean(active.page.locked)} model={model} reasoning={reasoning}
        onModelChange={onModelChange} onReasoningChange={onReasoningChange} flush={() => active.flush()} embedded={embedded}
        selection={aiSelection} onClearSelection={(sent) => setAiAsk((current) => clearActiveSelection(current, activeId, sent))} openSignal={aiOpenSignal} hidden={split}
        onGenerateImage={editable ? requestPageImageGeneration : undefined} />
      <NotePresentationBridge
        key={`present:${activeId}`}
        title={active.content.title}
        icon={active.content.icon}
        blocks={active.content.blocks}
        parentId={activeSummary && activeSummary.parentId !== undefined ? activeSummary.parentId : (active.page.parentId ?? null)}
        groupId={activeSummary ? activeSummary.groupId : (active.page.groupId ?? null)}
        embedded={embedded}
        onOpenSaved={(id) => { if (!embedded) onOpen(id); else void notes.select(id, "none"); }}
      />
    </> : embedded ? !error && <div className="notes-column pt-24"><p className="notes-loading">{t("Loading page…")}</p></div>
    : !error && <>{!listMode && <div className="notes-column"><div className="notion-home-switch lg:hidden"><WorkspaceSwitch view="pages" onChange={onWorkspaceChange} /></div></div>}<div className="notes-column notes-empty">
      <div className="notes-empty-emblem" aria-hidden="true"><LayoutGrid size={26} strokeWidth={1.6} /></div>
      <h1 className="notes-empty-title">{t("Workspace")}</h1>
      <p className="notes-empty-subtitle">{t("Write notes, build slide decks and sketch on whiteboards. In a note, type {key} for headings, lists, to-dos and code.").split("{key}").flatMap((part, index) => index ? [<kbd key={index} className="notes-kbd">/</kbd>, part] : [part])}</p>
      <div className="notes-empty-actions">
        <NewPageButtons kinds={creatablePageKinds()} busy={busy} className="!mt-0" onCreate={(kind) => onCreate({ kind })} onGenerate={onGenerateSlides} />
        {onImport && <>
          <input ref={emptyImportRef} type="file" multiple accept=".md,.markdown,.txt,text/markdown,text/plain" className="sr-only"
            onChange={(event) => {
              const picked = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (picked.length) onImport(picked);
            }} />
          <button type="button" disabled={busy} className="ws-util-pill notes-empty-import" onClick={() => emptyImportRef.current?.click()}><Upload size={14} aria-hidden="true" /><span>{t("Import Markdown")}</span></button>
        </>}
      </div>
      <p className="notes-empty-footnote">{t("Your Workspace is saved on the server and linked to this device. Sign in to open it on other devices. If you clear app or site data before signing in, you lose access to it.")}</p>
    </div></>}
  </div>;
}
