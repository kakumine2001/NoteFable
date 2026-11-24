"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { validateNoteContent } from "@/lib/note-document";
import { NoteSaveError, NoteSaveQueue, type NoteDraft } from "@/lib/note-save-queue";
import { flushCanvasEditors, flushCanvasEditorsSync } from "@/lib/canvas-flush";
import { byPosition, OrderRefreshSync, type ReorderRequest } from "@/lib/list-order";
import { runTransition } from "@/lib/view-transition";
import { descendantIdsOf } from "@/lib/note-tree";
import { isImportableMarkdownFile, MAX_IMPORT_FILE_BYTES, MAX_IMPORT_FILES, MAX_IMPORT_TOTAL_BYTES } from "@/lib/note-io";
import { isCanvasKind, pageKindFeatures, pageKindOf, type PageKind } from "@/lib/page-kinds";
import { CANVAS_DRAFT_PREFIX, canvasSaveBody, canvasSavedPage, newPageBody, parseCanvasDraft } from "@/lib/canvas-save";
import { PAGES_TRASHED_EVENT, PAGES_WILL_TRASH_EVENT, type PagesWillTrashDetail } from "@/lib/proposal-sync";
import { preloadPageEditor } from "@/lib/preload-editor";
import { afterSheetHistory, isSheetCleanupPopState, restoreSheetMarker } from "@/lib/use-back-to-close";
import type { NoteContent, NoteGroupSummary, NotePage, NotePageSettings, NotePageSummary } from "@/types/notes";
import { fmt, msg } from "@/lib/i18n/translate";

const DRAFT_PREFIX = "notefable:page-draft:v1:";
const PREFETCH_HOVER_DELAY_MS = 65;
const PREFETCH_FRESH_MS = 5000;
const MAX_PREFETCHED = 20;
const MAX_CONCURRENT_PREFETCHES = 2;
// ネイティブアプリの埋め込み WebView（/note-embed）でメモリを使いすぎないよう、
// 常駐再利用時に保持するクリーンな保存キューの件数に上限を設ける（未保存・保存中のキューは捨てない）。
const MAX_EMBEDDED_CACHED_QUEUES = 8;

export type SelectPageOptions = {
  // 未キャッシュのページを読み込む間、いま表示しているページをそのまま残すか（デスクトップ・分割表示は true でちらつきを防ぎ、スマホでホームから開くときは false）。
  keepCurrent?: boolean;
};

async function pageRequest(url: string, method = "GET", body?: unknown) {
  const response = await fetch(url, {
    method, cache: "no-store",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new NoteSaveError(data.error || msg("Note request failed. Your draft has been kept."), response.status, data.page);
  return data;
}


// embedded: Android アプリの WebView に載せる /note-embed（1 ページだけを開き、一覧は読まない）。
export function useNotePages(
  enabled: boolean,
  { embedded = false, onMissing }: { embedded?: boolean; onMissing?: (id: string) => void } = {},
) {
  const onMissingRef = useRef(onMissing);
  useEffect(() => { onMissingRef.current = onMissing; }, [onMissing]);
  const orderSync=useRef(new OrderRefreshSync());
  const reorderBusy=useRef(false);
  const [pages, setPages] = useState<NotePageSummary[]>([]);
  const pagesRef = useRef<NotePageSummary[]>([]);
  useEffect(() => { pagesRef.current = pages; }, [pages]);
  const [groups, setGroups] = useState<NoteGroupSummary[]>([]);
  const [groupError, setGroupError] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<NoteSaveQueue>();
  // 一覧の初回取得中（listLoading）と、未キャッシュのページを読み込み中（openingId）を分ける。
  // 既に開いているページがある間のページ切り替えでは loading を立てず、画面を白くしない。
  const [listLoading, setListLoading] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const loading = listLoading || (openingId !== null && (!active || activeId === null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // 書き出し・取り込みの失敗。一覧の読み込み失敗（error）と分けて、画面を隠さず、閉じられる帯で出す。
  const [actionError, setActionError] = useState("");
  const [backupError, setBackupError] = useState("");
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [, refresh] = useState(0);
  const queues = useRef(new Map<string, NoteSaveQueue>());
  // ホバー・フォーカスで先読みしたページ本体（副作用を出さないよう、開くまで NoteSaveQueue は作らない）。
  const prefetched = useRef(new Map<string, { page: NotePage; fetchedAt: number; startedMeta: number }>());
  const inflightPages = useRef(new Map<string, Promise<{ page: NotePage; startedMeta: number }>>());
  const inflightPrefetches = useRef(new Set<string>());
  const invalidationSeq = useRef(new Map<string, number>());
  const prefetchTimer = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const createdWhileLoading = useRef<NotePageSummary[]>([]);
  const loaded = useRef(false);
  const started = useRef(false);
  const navigation = useRef(0);
  const actionBusy = useRef(false);
  const displayedId = useRef<string | null>(null);
  const pendingId = useRef<string | null>(null);
  // ページの本文が画面に出ているか（/app がホーム・チャットの間は false）。端末の「戻る」でページへ戻るときに使う。
  const pageShown = useRef(true);
  const setPageShown = useCallback((shown: boolean) => { pageShown.current = shown; }, []);

  // この画面で表示設定・お気に入りを変えるたびに進める番号。ページごとに最後に変えた番号を覚える（取得・保存の応答が古い値で戻さないため）。
  const metaSequence = useRef(0);
  const metaChanged = useRef(new Map<string, number>());
  const markMeta = useCallback((id: string) => { metaChanged.current.set(id, ++metaSequence.current); }, []);

  const invalidatePageCache = useCallback((id: string) => {
    prefetched.current.delete(id);
    inflightPages.current.delete(id);
    invalidationSeq.current.set(id, (invalidationSeq.current.get(id) ?? 0) + 1);
  }, []);

  const cachePrefetched = useCallback((id: string, page: NotePage, seq: number, startedMeta: number) => {
    if ((invalidationSeq.current.get(id) ?? 0) !== seq || queues.current.has(id)) return;
    // LRU 風に新しい順へ並べ直し、上限を超えた古い先読みから捨てる。
    prefetched.current.delete(id);
    prefetched.current.set(id, { page, fetchedAt: Date.now(), startedMeta });
    if (prefetched.current.size > MAX_PREFETCHED) {
      const oldest = prefetched.current.keys().next().value;
      if (oldest !== undefined) prefetched.current.delete(oldest);
    }
  }, []);

  const fetchPage = useCallback((id: string): Promise<{ page: NotePage; startedMeta: number }> => {
    const inflight = inflightPages.current.get(id);
    if (inflight) return inflight;
    const startedMeta = metaSequence.current;
    const promise = pageRequest(`/api/pages/${id}`).then((data) => ({ page: data.page as NotePage, startedMeta }));
    const wrapped = promise.finally(() => {
      if (inflightPages.current.get(id) === wrapped) inflightPages.current.delete(id);
    });
    inflightPages.current.set(id, wrapped);
    return wrapped;
  }, []);

  const cancelPrefetch = useCallback((id?: string) => {
    const current = prefetchTimer.current;
    if (!current) return;
    if (id !== undefined && current.id !== id) return;
    clearTimeout(current.timer);
    prefetchTimer.current = null;
  }, []);

  const runPrefetch = useCallback((id: string) => {
    if (!id || displayedId.current === id) return;
    const summary = pagesRef.current.find((entry) => entry.id === id);
    if (summary) preloadPageEditor(pageKindOf(summary));
    if (queues.current.has(id) || inflightPages.current.has(id)) return;
    const cached = prefetched.current.get(id);
    if (cached && Date.now() - cached.fetchedAt < PREFETCH_FRESH_MS) return;
    if (inflightPrefetches.current.size >= MAX_CONCURRENT_PREFETCHES) return;
    const seq = invalidationSeq.current.get(id) ?? 0;
    inflightPrefetches.current.add(id);
    void fetchPage(id)
      .then(({ page, startedMeta }) => { cachePrefetched(id, page, seq, startedMeta); })
      .catch(() => { /* 先読みの失敗は無視し、実際に開いたときに通常どおり扱う。 */ })
      .finally(() => { inflightPrefetches.current.delete(id); });
  }, [cachePrefetched, fetchPage]);

  const prefetch = useCallback((id: string, immediate = false) => {
    if (!id || displayedId.current === id || queues.current.has(id)) return;
    cancelPrefetch();
    if (immediate) { runPrefetch(id); return; }
    const timer = setTimeout(() => {
      if (prefetchTimer.current?.id === id) prefetchTimer.current = null;
      runPrefetch(id);
    }, PREFETCH_HOVER_DELAY_MS);
    prefetchTimer.current = { id, timer };
  }, [cancelPrefetch, runPrefetch]);

  const hasCached = useCallback((id: string) => queues.current.has(id) || prefetched.current.has(id), []);

  const touchQueue = useCallback((id: string, queue: NoteSaveQueue) => {
    queues.current.delete(id);
    queues.current.set(id, queue);
    if (!embedded || queues.current.size <= MAX_EMBEDDED_CACHED_QUEUES) return;
    for (const [candidateId, candidate] of queues.current) {
      if (queues.current.size <= MAX_EMBEDDED_CACHED_QUEUES) break;
      if (candidateId === id || candidateId === displayedId.current || candidateId === pendingId.current) continue;
      if (candidate.dirty || candidate.status === "saving") continue;
      candidate.dispose();
      queues.current.delete(candidateId);
    }
  }, [embedded]);

  const cancelPending = useCallback(() => {
    if (!pendingId.current) return;
    ++navigation.current;
    pendingId.current = null;
    setOpeningId(null);
    setError("");
  }, []);

  // ネイティブアプリの常駐 WebView が一覧へ戻ったとき：編集画面を閉じて DOM/キャンバスを解放しつつ、
  // queues の LRU キャッシュと読み込み済み JS チャンクはそのまま残して次回を即座に開けるようにする。
  const deactivate = useCallback(() => {
    ++navigation.current;
    cancelPrefetch();
    pendingId.current = null;
    displayedId.current = null;
    setOpeningId(null);
    setActiveId(null);
    setActive(undefined);
    setError("");
  }, [cancelPrefetch]);

  // local: 編集中の内容（queue.page は開いた時点の古い行）から作った 1 件。お気に入り・表示設定は一覧の値を残す。
  // それ以外（サーバーから読んだ・保存した行）は、お気に入り・表示設定をサーバーの値にそろえる（別タブ・アプリでの変更を拾う）。

  // local: 編集中の内容（queue.page は開いた時点の古い行）から作った 1 件。お気に入り・表示設定は一覧の値を残す。
  // since: 保存を始めた時点の番号。その後にこの画面で設定を変えていたら一覧の値を残し、変えていなければサーバーの値（別のタブ・アプリでの変更）を使う。
  const upsertSummary = useCallback((page: NotePageSummary, { local = false, since }: { local?: boolean; since?: number } = {}) => {
    // 保存のたびに行が動かないよう、作成順を保つ。
    setPages((current) => {
      const existing = current.find((entry) => entry.id === page.id);
      if (!existing) return [{ ...page, groupId: page.groupId ?? null }, ...current].sort(byPosition);
      // 一覧の版より古い応答（遅れて届いたもの）では戻さない。
      if (page.version < existing.version) return current;
      const changedLocally = since !== undefined && (metaChanged.current.get(page.id) ?? 0) > since;
      const meta = local || changedLocally || page.locked === undefined
        ? {
            favoritedAt: existing.favoritedAt, fullWidth: existing.fullWidth, smallText: existing.smallText, font: existing.font, locked: existing.locked,
            shareEnabled: existing.shareEnabled, shareExpiresAt: existing.shareExpiresAt,
          }
        : {
            favoritedAt: page.favoritedAt ?? null, fullWidth: page.fullWidth, smallText: page.smallText, font: page.font, locked: page.locked,
            shareEnabled: page.shareEnabled, shareExpiresAt: page.shareExpiresAt ?? null,
          };
      if (existing.title === page.title && existing.icon === page.icon && existing.version === page.version && existing.updatedAt === page.updatedAt
        && existing.favoritedAt === meta.favoritedAt && existing.fullWidth === meta.fullWidth && existing.smallText === meta.smallText && existing.font === meta.font && existing.locked === meta.locked
        && existing.shareEnabled === meta.shareEnabled && existing.shareExpiresAt === meta.shareExpiresAt) return current;
      // 所属グループ・親・位置は移動と並べ替えの操作だけが決める（並べ替えの最中に届いた古い値で戻さない）。
      // 種類は変わらない。種類を持たない応答で消さない。
      // AI が書いた目印（aiUpdatedAt）も、持たない応答で消さない。
      return current.map((entry) => entry.id === page.id ? {
        ...page, ...meta, kind: page.kind ?? entry.kind, groupId: entry.groupId, position: entry.position, parentId: entry.parentId,
        aiUpdatedAt: page.aiUpdatedAt !== undefined ? page.aiUpdatedAt : entry.aiUpdatedAt,
      } : entry);
    });
  }, []);

  const install = useCallback((page: NotePage, recoveredDraft?: NoteDraft) => {
    const kind = pageKindOf(page);
    let draft: NoteDraft | undefined = recoveredDraft;
    if (!draft) try {
      if (isCanvasKind(kind)) {
        // ホワイトボード・スライドにノートの下書きは無い（古い画面が残したものは、ノートの本文として送ると断られ続けるので捨てる）。
        // 本体の下書きは別の名前（CANVAS_DRAFT_PREFIX）に置く。
        localStorage.removeItem(DRAFT_PREFIX + page.id);
        const cached = localStorage.getItem(CANVAS_DRAFT_PREFIX + page.id);
        if (cached) draft = parseCanvasDraft(kind, cached, page);
        if (cached && !draft) localStorage.removeItem(CANVAS_DRAFT_PREFIX + page.id);
      } else {
        const cached = localStorage.getItem(DRAFT_PREFIX + page.id);
        if (cached) {
          const parsed = JSON.parse(cached);
          // 新しい項目を持たない旧下書きは、保存済みページの値で補ってから検証する。
          if (Number.isSafeInteger(parsed.version)) draft = { ...validateNoteContent({ icon: page.icon, cover: page.cover, coverPosition: page.coverPosition, ...parsed }), version: parsed.version };
        }
      }
    } catch { /* 壊れた端末キャッシュは DB の本文に影響させない。 */ }
    const draftKey = (isCanvasKind(kind) ? CANVAS_DRAFT_PREFIX : DRAFT_PREFIX) + page.id;
    // 最後に書いた下書きの内容。保存の状態だけが変わった通知で、同じ（ホワイトボード・スライドでは最大 2 MB の）内容を書き直さない。
    let writtenDraft: { content: unknown; version: number } | null = null;
    const queue: NoteSaveQueue = new NoteSaveQueue(page, async (content, version): Promise<NotePage> => {
      const started = metaSequence.current;
      if (isCanvasKind(kind)) {
        // ホワイトボード・スライドは { title, icon, data?, version }。応答は版と一覧の 1 件だけなので、送った本体と合わせてページを作り直す。
        // queue.page.data は最後に保存できた本体（読み込み・保存・最新版の読み込みのたびに替わる）。
        const saved = queue.page.data;
        const data = await pageRequest(`/api/pages/${page.id}`, "PATCH", canvasSaveBody(content, version, saved));
        // 送っている間にゴミ箱へ移った（キューを捨てた）ページを、一覧に戻さない。
        if (queues.current.get(page.id) === queue) upsertSummary(data.page, { since: started });
        return canvasSavedPage(queue.page, data, content, saved);
      }
      const data = await pageRequest(`/api/pages/${page.id}`, "PATCH", { ...content, version });
      // 保存の間にこの画面でロックなどを変えていたら、応答の（変更前かもしれない）値で戻さない。変えていなければ別のタブ・アプリでの変更を拾う。
      // 送っている間にゴミ箱へ移った（キューを捨てた）ページは、一覧に戻さない。
      if (queues.current.get(page.id) === queue) upsertSummary(data.page, { since: started });
      return data.page;
    }, () => {
      upsertSummary({ ...queue.page, title: queue.content.title.trim() || "Untitled", icon: queue.content.icon }, { local: true });
      try {
        if (!queue.dirty) { localStorage.removeItem(draftKey); writtenDraft = null; }
        else if (!isCanvasKind(kind) || writtenDraft?.content !== queue.content || writtenDraft.version !== queue.version) {
          localStorage.setItem(draftKey, JSON.stringify(queue.draft));
          writtenDraft = { content: queue.content, version: queue.version };
        }
        setBackupError("");
      } catch { setBackupError(msg("Browser draft backup is unavailable. Keep this tab open until Saved appears.")); }
      refresh((value) => value + 1);
    }, draft);
    touchQueue(page.id, queue);
    queue.schedule();
    return queue;
  }, [touchQueue, upsertSummary]);

  const syncPageUrl = useCallback((id: string, historyMode: "push" | "replace" | "none") => {
    if (historyMode === "none") return;
    const apply = () => {
      if (displayedId.current !== id) return;
      const url = new URL(window.location.href);
      if (url.searchParams.get("view") !== "pages") return;
      url.searchParams.set("page", id);
      if (url.href === window.location.href) return;
      if (historyMode === "push") {
        if (window.history.state?.notefableSheet) {
          window.history.replaceState(null, "", url);
          restoreSheetMarker();
        } else {
          window.history.pushState(null, "", url);
        }
      } else {
        window.history.replaceState(null, "", url);
      }
    };
    // タブレット等のドロワー後始末（history.back）が予約・実行中なら、それが終わってから URL を書き換える。
    // 目印の履歴にいても、すでに history.back を呼んだ後（戻りの popstate 待ち）なら、書いた URL ごと戻されるので待つ。
    if (window.history.state?.notefableSheet && !isSheetCleanupPopState()) apply();
    else afterSheetHistory(apply);
  }, []);

  // 開けたら true。ノートが無い（ゴミ箱に入った・削除された）ときだけ false で、呼び出し側が古いリンクを片付けられる。
  const select = useCallback(async (id: string, historyMode: "push" | "replace" | "none" = "push", { keepCurrent = true }: SelectPageOptions = {}): Promise<boolean> => {
    const currentUrl = new URL(window.location.href);
    const alreadyAtUrl = currentUrl.searchParams.get("view") !== "pages" || currentUrl.searchParams.get("page") === id;
    if (historyMode === "push" && displayedId.current === id && alreadyAtUrl) {
      // 読み込み中に元のページへ戻った操作も、後から来る応答で上書きしない。
      if (pendingId.current) { ++navigation.current; pendingId.current = null; setOpeningId(null); setError(""); }
      return true;
    }
    const intent = ++navigation.current;
    cancelPrefetch(id);
    setError("");
    const existing = queues.current.get(id);
    // 404（gone）で残っていたキューは、ゴミ箱から復元された可能性があるため即表示せずサーバーで再確認する。
    const usableExisting = existing && !existing.gone ? existing : undefined;
    const prefetchedEntry = !existing ? prefetched.current.get(id) : undefined;
    if (usableExisting || prefetchedEntry) {
      if (prefetchedEntry) prefetched.current.delete(id);
      const queue = usableExisting ?? install(prefetchedEntry!.page);
      if (usableExisting) touchQueue(id, usableExisting);
      pendingId.current = null;
      setOpeningId(null);
      setActiveId(id);
      displayedId.current = id;
      setActive(queue);
      // 先読みしたページは先読み開始時点以降のローカル変更がなければ新しい設定（ロック等）を反映し、既存キューは裏の再照合で合わせる。
      upsertSummary(
        { ...queue.page, title: queue.content.title.trim() || "Untitled", icon: queue.content.icon },
        prefetchedEntry ? { since: prefetchedEntry.startedMeta } : { local: true },
      );
      syncPageUrl(id, historyMode);
      // 先読み直後で十分に新しい場合以外は、裏で最新版を照合して別タブの更新・削除を拾う。
      const shouldRevalidate = Boolean(usableExisting) || !prefetchedEntry || Date.now() - prefetchedEntry.fetchedAt >= PREFETCH_FRESH_MS;
      if (shouldRevalidate) {
        const seq = invalidationSeq.current.get(id) ?? 0;
        void fetchPage(id).then(({ page: latestPage, startedMeta }) => {
          if ((invalidationSeq.current.get(id) ?? 0) !== seq) return;
          const currentQueue = queues.current.get(id);
          if (!currentQueue) return;
          if (latestPage.version > currentQueue.version) {
            // ホワイトボード等に 400ms 待ちの未提出の線やアップロード中画像があれば、先に同期でキューへ渡してから判定する。
            const hasPendingEditorWork = displayedId.current === id && flushCanvasEditorsSync(id);
            if (!hasPendingEditorWork && !currentQueue.dirty && currentQueue.status !== "saving") {
              currentQueue.loadLatest(latestPage);
              if (displayedId.current === id) setEditorEpoch((value) => value + 1);
            } else if (currentQueue.status !== "saving") {
              currentQueue.status = "conflict";
              currentQueue.latest = latestPage;
              currentQueue.error = msg("This note was changed in another tab. Save a copy or load the latest version.");
              refresh((value) => value + 1);
            }
          } else if (currentQueue.status === "error" && !currentQueue.gone && currentQueue.dirty) {
            // 前回の保存が一時失敗して下書きだけ残っていた場合、再表示時の再照合で衝突がなければ自動で再送する。
            void currentQueue.flush();
          }
          if (latestPage.version >= currentQueue.version) {
            upsertSummary({ ...latestPage, title: currentQueue.content.title.trim() || "Untitled", icon: currentQueue.content.icon }, { since: startedMeta });
          }
        }).catch((caught) => {
          const gone = caught instanceof NoteSaveError && caught.status === 404;
          if (!gone) return;
          // 照合の途中でゴミ箱・復元・開き直しがあった（キャッシュが無効化された、別のキューになった）なら、古い 404 で消さない。
          if ((invalidationSeq.current.get(id) ?? 0) !== seq) return;
          const currentQueue = queues.current.get(id);
          if (currentQueue !== queue) return;
          const hasPendingEditorWork = displayedId.current === id && flushCanvasEditorsSync(id);
          if (currentQueue?.dirty || hasPendingEditorWork) {
            if (currentQueue) {
              currentQueue.gone = true;
              currentQueue.status = "error";
              currentQueue.error = caught instanceof Error ? caught.message : msg("Failed to open note.");
              refresh((value) => value + 1);
            }
            return;
          }
          invalidatePageCache(id);
          currentQueue.dispose();
          queues.current.delete(id);
          setPages((current) => current.filter((page) => page.id !== id));
          if (displayedId.current === id) {
            displayedId.current = null;
            setActiveId(null);
            setActive(undefined);
            // 別の未キャッシュページへ移動中（pendingId）なら、URL 変更や popstate でその遷移をキャンセルしない。
            if (!pendingId.current || pendingId.current === id) {
              setError(caught instanceof Error ? caught.message : msg("Failed to open note."));
              const url = new URL(window.location.href);
              if (url.searchParams.get("page") === id) {
                url.searchParams.delete("page");
                window.history.replaceState(window.history.state, "", url);
                window.dispatchEvent(new Event("popstate"));
              }
              onMissingRef.current?.(id);
            }
          }
        });
      }
      return true;
    }

    pendingId.current = id;
    setOpeningId(id);
    if (!keepCurrent) {
      displayedId.current = null;
      setActiveId(null);
      setActive(undefined);
    }
    try {
      let latestPage: NotePage;
      let startedMeta: number;
      while (true) {
        const seq = invalidationSeq.current.get(id) ?? 0;
        const fetched = await fetchPage(id);
        if (intent !== navigation.current) {
          cachePrefetched(id, fetched.page, seq, fetched.startedMeta);
          return true;
        }
        // ホバー先読みに相乗りしている間に AI 編集・アイコン変更等で無効化された場合は、取り直して最新版を開く。
        if ((invalidationSeq.current.get(id) ?? 0) !== seq) continue;
        latestPage = fetched.page;
        startedMeta = fetched.startedMeta;
        break;
      }
      const existingAfter = queues.current.get(id);
      let queue: NoteSaveQueue;
      if (existingAfter?.gone) {
        // 復元されたページを再度開いたとき：古い gone 状態を消し、未保存下書きは通常の版照合で引き継ぐ。
        const recovered = existingAfter.dirty ? existingAfter.draft : undefined;
        existingAfter.dispose();
        queue = install(latestPage, recovered);
      } else {
        queue = existingAfter ?? install(latestPage);
        if (existingAfter && latestPage.version > existingAfter.version) {
          const hasPendingEditorWork = displayedId.current === id && flushCanvasEditorsSync(id);
          if (!hasPendingEditorWork && !existingAfter.dirty && existingAfter.status !== "saving") {
            existingAfter.loadLatest(latestPage);
            setEditorEpoch((value) => value + 1);
          } else if (existingAfter.status !== "saving") {
            existingAfter.status = "conflict";
            existingAfter.latest = latestPage;
            existingAfter.error = msg("This note was changed in another tab. Save a copy or load the latest version.");
          }
        }
      }
      setActiveId(id);
      displayedId.current = id;
      setActive(queue);
      upsertSummary({ ...latestPage, title: queue.content.title.trim() || "Untitled", icon: queue.content.icon }, { since: startedMeta });
      syncPageUrl(id, historyMode);
      return true;
    } catch (caught) {
      if (intent !== navigation.current) return true;
      setError(caught instanceof Error ? caught.message : msg("Failed to open note."));
      const gone = caught instanceof NoteSaveError && caught.status === 404;
      // 別のタブで捨てた（または削除した）ノートが一覧に残っていたら外す。
      if (gone) {
        invalidatePageCache(id);
        setPages((current) => current.filter((page) => page.id !== id));
      }
      return !gone;
    }
    finally { if (intent === navigation.current) { pendingId.current = null; setOpeningId(null); } }
  }, [cachePrefetched, cancelPrefetch, fetchPage, install, invalidatePageCache, syncPageUrl, touchQueue, upsertSummary]);

  const load = useCallback(async () => {
    // 読み込み中のページ選択（pendingId）はそのまま残す。消すと、その後の cancelPending が効かず、取り消した選択が後から開く。
    setListLoading(true);
    setError("");
    try {
      const orderMark=orderSync.current.mark();
      const data = await pageRequest("/api/pages");
      data.pages=orderSync.current.reconcile(data.pages as NotePageSummary[],orderMark).sort(byPosition);
      loaded.current = true;
      const known = new Set<string>(data.pages.map((page: NotePageSummary) => page.id));
      const extra = createdWhileLoading.current.filter((page) => !known.has(page.id));
      createdWhileLoading.current = [];
      setPages(extra.length ? [...extra, ...data.pages].sort(byPosition) : data.pages);
      setGroups(data.groups ?? []);
      const url = new URL(window.location.href);
      const inPagesView = url.searchParams.get("view") === "pages";
      const requested = inPagesView ? url.searchParams.get("page") : null;
      const id = data.pages.find((page: NotePageSummary) => page.id === requested)?.id;
      if (id) await select(id, "replace");
      else if (inPagesView) {
        displayedId.current = null; setActiveId(null); setActive(undefined);
        if (requested) {
          // 存在しない（削除済みなど）ノートを指す URL を開いた：指定を外して Notes のホームに戻す。
          url.searchParams.delete("page");
          window.history.replaceState(null, "", url);
          window.dispatchEvent(new Event("popstate"));
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : msg("Failed to load notes."));
      // 失敗したら、次にノートを開く（分割表示を開き直すなど）ときにもう一度読み込めるようにする。
      started.current = false;
    }
    finally { setListLoading(false); }
  }, [select]);

  useEffect(() => {
    if (enabled && !loaded.current && !started.current) {
      started.current = true;
      queueMicrotask(() => { void load(); });
    }
  }, [enabled, load]);

  useEffect(() => {
    // チャットの編集案が適用された時に、読み込み済みのページを最新の版へそろえる（そうしないと次の保存が 409 になる）。
    function onPageUpdated(event: Event) {
      const page = (event as CustomEvent<NotePage | undefined>).detail;
      if (!page) return;
      invalidatePageCache(page.id);
      // まだ開いていないページでも、一覧の題名と版は最新にする。
      if (loaded.current) upsertSummary(page);
      const queue = queues.current.get(page.id);
      // 遅れて届いた古い版（自動適用の読み直しが前後したときなど）で、新しい版を古い版へ戻さない。
      if (!queue || page.version <= queue.version) return;
      if (!queue.dirty && queue.status !== "saving") {
        // ホワイトボード・スライドで本体（data）の無い応答が届いたら、古い本体と新しい版を組み合わせない（別のタブの保存を上書きさせる）。
        // 読み直してから替える。
        if (isCanvasKind(pageKindOf(page.kind ? page : queue.page)) && page.data === undefined) {
          void pageRequest(`/api/pages/${page.id}`).then((data) => {
            const current = queues.current.get(page.id);
            if (!current || current.dirty || current.status === "saving" || data.page.version <= current.version) return;
            current.loadLatest(data.page);
            if (displayedId.current === page.id) setEditorEpoch((value) => value + 1);
          }).catch(() => { /* 次に開いた時に読み直す。 */ });
          return;
        }
        queue.loadLatest(page);
        if (displayedId.current === page.id) setEditorEpoch((value) => value + 1);
      } else {
        // 未保存の編集は消さず、衝突として知らせる。
        queue.status = "conflict";
        queue.latest = page;
        queue.error = msg("This note was changed from the chat. Save a copy or load the latest version.");
        refresh((value) => value + 1);
      }
    }
    // チャットで作った新しいページを、読み込み済みの一覧へ加える（未読み込みなら後の取得に含まれる）。
    function onPageCreated(event: Event) {
      const page = (event as CustomEvent<NotePage | undefined>).detail;
      if (!page) return;
      // 一覧の取得中に作られたページは、取得結果に含まれないことがあるので覚えておいて合流させる。
      if (loaded.current) upsertSummary(page);
      else createdWhileLoading.current.push(page);
    }
    // アプリ（/note-embed）や別の画面から届いた表示設定・お気に入り。一覧を読んでいない埋め込みでも、開いたページの 1 件に効く。
    function onPageMeta(event: Event) {
      const page = (event as CustomEvent<NotePageSummary | undefined>).detail;
      if (page) markMeta(page.id);
      if (page) setPages((current) => current.map((entry) => entry.id === page.id ? {
        ...entry, favoritedAt: page.favoritedAt ?? null, fullWidth: page.fullWidth, smallText: page.smallText, font: page.font, locked: page.locked,
      } : entry));
    }
    // AI の提案で作ったページを「元に戻す」前に、そのページ（とサブページ）の入力中の内容を保存する（「ゴミ箱へ移す」と同じ）。
    // 保存できなければ false を返し、元に戻すのを止めてもらう（保存できない下書きを捨てない）。
    function onPagesWillTrash(event: Event) {
      const detail = (event as CustomEvent<PagesWillTrashDetail | undefined>).detail;
      if (!detail || !Array.isArray(detail.ids)) return;
      const ids = new Set<string>();
      for (const id of detail.ids) {
        if (typeof id !== "string") continue;
        ids.add(id);
        for (const childId of descendantIdsOf(pagesRef.current, id)) ids.add(childId);
      }
      // 開いているページ（ホワイトボードなど）が対象なら、エディターがまだ保存キューへ渡していない変更（アップロード中の画像も）を
      // 先に渡してもらう（「ゴミ箱へ移す」と同じ）。渡し切れなければ元に戻すのを止める。
      const openPage = displayedId.current !== null && ids.has(displayedId.current);
      const pending = [...ids].flatMap((id) => { const queue = queues.current.get(id); return queue ? [queue] : []; });
      if (!openPage && !pending.length) return;
      detail.waits.push((async () => {
        if (openPage && !(await flushCanvasEditors())) return false;
        return (await Promise.all(pending.map((queue) => queue.flush()))).every(Boolean);
      })());
    }
    // AI の提案で作ったページを「元に戻す」でゴミ箱へ移した（サブページも一緒）。一覧と保存キューから外し、開いていたら閉じる。
    function onPagesTrashed(event: Event) {
      const detail = (event as CustomEvent<{ ids?: unknown; preserveDrafts?: unknown } | undefined>).detail;
      const ids = detail?.ids;
      if (!Array.isArray(ids) || !ids.length) return;
      const preserveDrafts = detail?.preserveDrafts === true;
      const removed = new Set(ids.filter((id): id is string => typeof id === "string"));
      for (const id of removed) {
        invalidatePageCache(id);
        // 待っている保存も止める（送ると 404 になり、一覧に戻してしまう）。
        queues.current.get(id)?.dispose();
        queues.current.delete(id);
        // ネイティブの常駐キャッシュ通知（preserveDrafts）では未保存の下書きを消さない（ゴミ箱から復元したときに戻せるようにする）。
        if (!preserveDrafts) {
          try {
            localStorage.removeItem(DRAFT_PREFIX + id);
            localStorage.removeItem(CANVAS_DRAFT_PREFIX + id);
          } catch { /* 古い下書きを、復元後の本文に重ねない。 */ }
        }
      }
      // 一覧を読む前に作られたページとして覚えていたものからも外す（読んだときに一覧へ戻さない）。
      createdWhileLoading.current = createdWhileLoading.current.filter((page) => !removed.has(page.id));
      // 開こうとしている途中なら、届いた結果でゴミ箱のページを開き直さない（読み込み中の表示も終える）。
      if (pendingId.current && removed.has(pendingId.current)) cancelPending();
      runTransition(() => setPages((current) => current.filter((page) => !removed.has(page.id))), "list");
      if (displayedId.current && removed.has(displayedId.current)) {
        displayedId.current = null;
        setActiveId(null);
        setActive(undefined);
      }
      // URL がゴミ箱へ移ったページを指していたら外す（開いている途中のページも）。
      const url = new URL(window.location.href);
      const requested = url.searchParams.get("page");
      if (requested && removed.has(requested)) {
        url.searchParams.delete("page");
        window.history.replaceState(null, "", url);
      }
    }
    window.addEventListener("notefable:page-meta", onPageMeta);
    window.addEventListener("notefable:page-updated", onPageUpdated);
    window.addEventListener("notefable:page-created", onPageCreated);
    window.addEventListener(PAGES_TRASHED_EVENT, onPagesTrashed);
    window.addEventListener(PAGES_WILL_TRASH_EVENT, onPagesWillTrash);
    return () => {
      window.removeEventListener("notefable:page-meta", onPageMeta);
      window.removeEventListener("notefable:page-updated", onPageUpdated);
      window.removeEventListener("notefable:page-created", onPageCreated);
      window.removeEventListener(PAGES_TRASHED_EVENT, onPagesTrashed);
      window.removeEventListener(PAGES_WILL_TRASH_EVENT, onPagesWillTrash);
    };
  }, [upsertSummary, markMeta, invalidatePageCache, cancelPending]);

  useEffect(() => {
    function onPopState(event: PopStateEvent) {
      // タブレット等のドロワーを閉じた後始末（use-back-to-close の history.back）はユーザーの「戻る」ではないので、進行中のページ選択を消さない。
      if (isSheetCleanupPopState(event)) return;
      const url = new URL(window.location.href);
      const id = url.searchParams.get("page");
      if (url.searchParams.get("view") === "pages" && id) {
        // ホーム・チャットから戻るときは、前に開いていたページを読み込み中の画面に見せない。同じページへ戻るときも最新版を照合する。
        if (id !== displayedId.current) void select(id, "none", { keepCurrent: pageShown.current });
        else if (!pageShown.current) void select(id, "none");
        else if (pendingId.current) cancelPending();
      } else if (pendingId.current) {
        cancelPending();
      }
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [select, cancelPending]);

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if ([...queues.current.values()].some((queue) => queue.dirty)) { event.preventDefault(); }
    }
    function flushOnHide() {
      if (document.visibilityState === "hidden") for (const queue of queues.current.values()) void queue.flush();
    }
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", flushOnHide);
    const currentQueues = queues.current;
    return () => {
      if (prefetchTimer.current) { clearTimeout(prefetchTimer.current.timer); prefetchTimer.current = null; }
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", flushOnHide);
      for (const queue of currentQueues.values()) void queue.flush();
    };
  }, []);

  // kind の空のページを、parentId の中（サブページ）か groupId のプロジェクトの最上位（どちらもなければプロジェクトなし）に作る。
  // copy（衝突した下書きを新しいページとして保存）は、開いているページと同じ種類で、同じ親の下に作る。
  async function create(copy = false, parentId: string | null = null, kind: PageKind = "note", groupId: string | null = null) {
    if (actionBusy.current) return;
    actionBusy.current = true;
    setBusy(true);
    setError("");
    try {
      // 競合の副本は開いているページの今の中身を写す。ホワイトボードなどがまだ渡していない変更も先に渡してもらう。
      // 待っても終わらない画像のアップロードがあれば作らない（副本に画像が入らない）。
      if (copy && !(await flushCanvasEditors())) throw new Error(msg("Wait for images to finish uploading, then try again."));
      const current = activeId ? queues.current.get(activeId) : undefined;
      const content: NoteContent = copy && current ? { ...current.content, title: `${current.content.title.slice(0, 185)} (copy)` } : { title: "Untitled", icon: null, cover: null, coverPosition: null, blocks: [] };
      // 競合の副本は元のページと同じ親の下に作る（サブページなら同じ親、グループも親に従う）。
      const copyParent = copy && activeId ? pages.find((entry) => entry.id === activeId)?.parentId ?? null : null;
      const parent = copy ? copyParent : parentId;
      const pageKind = copy && current ? pageKindOf(current.page) : kind;
      // プロジェクトは親がないときだけ（サブページのプロジェクトは親に従う）。競合の副本には付けない：一覧の groupId は
      // 別の端末で消されたプロジェクトを指したままのことがあり、404 で下書きを救えなくなる（副本は今までどおりプロジェクトなし）。
      const group = copy || parent ? null : groupId;
      const { page } = await pageRequest("/api/pages", "POST", newPageBody(pageKind, content, parent, group));
      if (copy && current) {
        const latest = current.latest ?? current.page;
        if (isCanvasKind(pageKindOf(current.page)) && latest.data === undefined) {
          // ホワイトボード・スライドの 409 は本体を含まない。古い本体と新しい版を組み合わせないよう、元のページのキューと下書きを捨て、
          // 次に開いたときにサーバーから読み直す。
          queues.current.delete(current.page.id);
          try { localStorage.removeItem(CANVAS_DRAFT_PREFIX + current.page.id); } catch { /* 下書きが残っても、開き直したときに衝突として出るだけ。 */ }
          upsertSummary(latest);
        } else {
          current.loadLatest(latest);
          upsertSummary(current.page);
        }
      }
      invalidatePageCache(page.id);
      const queue = install(page);
      runTransition(() => upsertSummary(page), "list");
      ++navigation.current;
      pendingId.current = null;
      setOpeningId(null);
      setActiveId(page.id);
      displayedId.current = page.id;
      setActive(queue);
      const url = new URL(window.location.href);
      // アプリに埋め込んだ 1 ページだけの画面（/note-embed）は戻る履歴を持たないので、積まずに置き換える。
      // チャットの分割表示から作成した場合はチャットの URL に ?page= を足さない。
      if (embedded) {
        url.searchParams.set("page", page.id);
        window.history.replaceState(null, "", url);
      } else if (url.searchParams.get("view") === "pages") {
        url.searchParams.set("page", page.id);
        window.history.pushState(null, "", url);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : msg("Failed to create note.")); }
    finally { actionBusy.current = false; setBusy(false); }
  }

  // ノートをゴミ箱へ移す（サーバーの DELETE は deletedAt を付けるだけで、30 日間は復元できる）。名前は従来どおり remove。
  async function remove(id: string): Promise<boolean> {
    if (actionBusy.current) return false;
    actionBusy.current = true;
    setBusy(true);
    setError("");
    try {
      // ホワイトボードなどのエディターがまだ渡していない変更も先に渡してもらう（src/lib/canvas-flush.ts）。
      // 待っても終わらない画像のアップロードがあれば、ゴミ箱へ移さない（移すと画像の入っていない版が残る）。
      if (!(await flushCanvasEditors())) throw new Error(msg("Wait for images to finish uploading, then try again."));
      const queue = queues.current.get(id);
      if (queue && !(await queue.flush())) throw new Error(msg("Resolve the unsaved draft before moving this note to Trash."));
      // サブページも一緒にゴミ箱へ入る。開いている（未保存の）サブページも先に保存する。
      for (const childId of descendantIdsOf(pages, id)) {
        const child = queues.current.get(childId);
        if (child && !(await child.flush())) throw new Error(msg("Resolve the unsaved draft before moving this note to Trash."));
      }
      const data = await pageRequest(`/api/pages/${id}`, "DELETE");
      const removed = new Set<string>([id, ...(Array.isArray(data.ids) ? data.ids as string[] : [])]);
      for (const removedId of removed) {
        invalidatePageCache(removedId);
        queues.current.delete(removedId);
        if (pendingId.current === removedId) cancelPending();
        try {
          localStorage.removeItem(DRAFT_PREFIX + removedId);
          localStorage.removeItem(CANVAS_DRAFT_PREFIX + removedId);
        } catch { /* ゴミ箱へ移した後の古い下書きは、復元後の本文に重ねない。 */ }
      }
      const remaining = pages.filter((page) => !removed.has(page.id));
      runTransition(() => setPages(remaining), "list");
      if (activeId && removed.has(activeId)) {
        displayedId.current = null;
        setActiveId(null);
        setActive(undefined);
        const url = new URL(window.location.href);
        url.searchParams.delete("page");
        window.history.replaceState(null, "", url);
      }
      return true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : msg("Failed to move the note to Trash.")); return false; }
    finally { actionBusy.current = false; setBusy(false); }
  }

  // グループ操作は、失敗したら画面の状態を変えず、理由だけ groupError に出す。
  async function groupAction<T>(run: () => Promise<T>): Promise<T | null> {
    setGroupError("");
    try { return await run(); }
    catch (caught) { setGroupError(caught instanceof Error ? caught.message : msg("Could not change the group.")); return null; }
  }

  const createGroup = (name: string) => groupAction(async () => {
    const { group } = await pageRequest("/api/pages/groups", "POST", { name });
    runTransition(() => setGroups((current) => [...current, group]), "list");
    return group as NoteGroupSummary;
  });

  const renameGroup = (id: string, name: string) => groupAction(async () => {
    const { group } = await pageRequest(`/api/pages/groups/${id}`, "PATCH", { name });
    setGroups((current) => current.map((entry) => entry.id === id ? { ...entry, name: group.name } : entry));
    return true;
  });

  const deleteGroup = (id: string) => groupAction(async () => {
    await pageRequest(`/api/pages/groups/${id}`, "DELETE");
    // 中のノートは消えず、グループなしに戻る。
    runTransition(() => {
      setGroups((current) => current.filter((entry) => entry.id !== id));
      setPages((current) => current.map((page) => page.groupId === id ? { ...page, groupId: null } : page));
    }, "list");
    return true;
  });

  // グループへ移す。サブページだった場合は親から外れ、子孫も同じグループへ移る。
  const moveNote = (id: string, groupId: string | null) => groupAction(async () => {
    const data = await pageRequest(`/api/pages/${id}/group`, "PUT", { groupId });
    const moved = new Set<string>(Array.isArray(data.ids) ? data.ids : [id]);
    runTransition(() => setPages((current) => current.map((page) => page.id === id ? { ...page, groupId, parentId: null } : moved.has(page.id) ? { ...page, groupId } : page)), "list");
    return true;
  });

  // 別のページの中へ移す（null で最上位へ）。子孫も一緒に動き、グループは新しい親にそろう。
  const moveToPage = (id: string, parentId: string | null) => groupAction(async () => {
    const { pages: moved } = await pageRequest(`/api/pages/${id}/parent`, "PUT", { parentId });
    const byId = new Map((moved as NotePageSummary[]).map((page) => [page.id, page]));
    runTransition(() => setPages((current) => current.map((page) => {
      const next = byId.get(page.id);
      return next ? { ...page, parentId: next.parentId ?? null, groupId: next.groupId } : page;
    })), "list");
    return true;
  });

  // 一覧の 1 件を、サーバーが返したメタデータ（お気に入り・表示設定）で置き換える。
  const applyMeta = (page: NotePageSummary) => { markMeta(page.id); applyMetaRows(page); };
  const applyMetaRows = (page: NotePageSummary) => setPages((current) => current.map((entry) => entry.id === page.id ? {
    ...entry, favoritedAt: page.favoritedAt ?? null, fullWidth: page.fullWidth, smallText: page.smallText, font: page.font, locked: page.locked,
    ...(page.shareEnabled !== undefined ? { shareEnabled: page.shareEnabled, shareExpiresAt: page.shareExpiresAt ?? null } : {}),
  } : entry));

  // 1 ページのお気に入り・表示設定は 1 つずつ送る（続けて切り替えたとき、古い応答が後から届いて新しい設定を戻さないように）。
  const metaQueue = useRef(new Map<string, Promise<unknown>>());
  function serialMeta<T>(id: string, run: () => Promise<T>): Promise<T> {
    const previous = metaQueue.current.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(run);
    metaQueue.current.set(id, next);
    void next.finally(() => { if (metaQueue.current.get(id) === next) metaQueue.current.delete(id); }).catch(() => undefined);
    return next;
  }

  const setFavorite = (id: string, favorite: boolean) => serialMeta(id, () => groupAction(async () => {
    const { page } = await pageRequest(`/api/pages/${id}/favorite`, "PUT", { favorite });
    runTransition(() => applyMeta(page), "list");
    return true;
  }));

  const updateSettings = (id: string, settings: Partial<NotePageSettings>) => serialMeta(id, () => groupAction(async () => {
    const { page } = await pageRequest(`/api/pages/${id}/settings`, "PUT", settings);
    applyMeta(page);
    return true;
  }));

  // ページを（サブページも一緒に）複製して、複製を開く。サーバーは保存済みの本文を写すので、先に未保存の編集を保存する。
  async function duplicate(id: string) {
    if (actionBusy.current) return false;
    actionBusy.current = true;
    setBusy(true);
    setError("");
    try {
      // 待っても終わらない画像のアップロードがあれば複製しない（複製に画像が入らない）。
      if (!(await flushCanvasEditors())) throw new Error(msg("Wait for images to finish uploading, then try again."));
      for (const pageId of [id, ...descendantIdsOf(pages, id)]) {
        const queue = queues.current.get(pageId);
        if (queue && !(await queue.flush())) throw new Error(msg("Resolve the unsaved draft before duplicating this page."));
      }
      const data = await pageRequest(`/api/pages/${id}/duplicate`, "POST");
      const copies = data.pages as NotePageSummary[];
      // サーバーは一覧全体の並びを書き直すので、全件の新しい位置を当てはめる（並べ替えと同じ）。
      const items = (data.items ?? []) as { id: string; position: number }[];
      orderSync.current.saved(items);
      const positions = new Map(items.map((item) => [item.id, item.position]));
      runTransition(() => setPages((current) => [...current.filter((page) => !copies.some((copy) => copy.id === page.id)), ...copies]
        .map((page) => positions.has(page.id) ? { ...page, position: positions.get(page.id) } : page).sort(byPosition)), "list");
      actionBusy.current = false;
      await select(data.page.id);
      return true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : msg("Could not duplicate the page.")); return false; }
    finally { actionBusy.current = false; setBusy(false); }
  }

  // サイドバーのアイコンから変える。開いているノートは編集と同じ経路（自動保存）に乗せ、開いていないノートは専用の API で書く。
  const changeIcon = (id: string, icon: string | null) => groupAction(async () => {
    // 開いているページは編集と同じ自動保存に載せる。ホワイトボード・スライドはエディターがある種類だけ
    // （読み取り専用の仮の画面には保存の失敗・衝突を直す案内が無いので、専用の API で書く）。
    if (active && id === activeId && (!isCanvasKind(pageKindOf(active.page)) || pageKindFeatures(pageKindOf(active.page)).editor)) { active.edit({ ...active.content, icon }); return true; }
    const { page } = await pageRequest(`/api/pages/${id}/icon`, "PUT", { icon });
    // 一覧と、読み込み済みの編集内容を新しい版へそろえる（未保存の編集が残っていれば、上書きせず衝突として知らせる）。
    window.dispatchEvent(new CustomEvent<NotePage>("notefable:page-updated", { detail: page }));
    return true;
  });

  async function reorder(move:ReorderRequest) {
    if(reorderBusy.current) throw new Error(msg("Wait for the previous move to finish."));
    reorderBusy.current=true;
    try {
      const {items}=await pageRequest("/api/pages/reorder","POST",move);
      orderSync.current.saved(items);
      setPages(current=>current.map(page=>({...page,...items.find((item:{id:string})=>item.id===page.id)})).sort(byPosition));
      return true;
    } finally {reorderBusy.current=false;}
  }

  async function exportPage(id: string): Promise<boolean> {
    if (actionBusy.current) return false;
    actionBusy.current = true;
    setActionError("");
    try {
      await flushCanvasEditors();
      const queue = queues.current.get(id);
      if (queue && queue.dirty && !(await queue.flush())) {
        throw new Error(msg("Resolve the unsaved draft before exporting this page."));
      }
      const data = await pageRequest(`/api/pages/${encodeURIComponent(id)}/export`);
      const blob = new Blob([String(data.markdown ?? "")], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = typeof data.fileName === "string" && data.fileName ? data.fileName : "note.md";
      link.style.display = "none";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return true;
    } catch (caught) {
      // メニューは押した時点で閉じているので、メニューの中ではなくノートの上に出す。
      setActionError(caught instanceof Error && caught.message ? caught.message : msg("Could not export the page."));
      return false;
    } finally {
      actionBusy.current = false;
    }
  }

  // 選んだファイルを送る前に、数・拡張子・大きさを確かめる。合わなければ理由を出して false。
  // 取り込み先を尋ねる前にも呼ぶ（先を選ばせてから断らない）。
  // 一覧（プロジェクトを含む）を読み込めているか。読めていない間は、プロジェクトがあるかどうか分からない。
  // 読めていなければ理由を出し、読み直しを始めて false（取り込み先を尋ねずに「プロジェクトなし」へ入れない）。
  function ensureListLoaded(): boolean {
    if (loaded.current) return true;
    // 読み込みの途中なら、終わるのを待ってもらう（失敗の表示は出さない）。
    if (listLoading) return false;
    setActionError(msg("Failed to load notes."));
    if (!started.current) { started.current = true; void load(); }
    return false;
  }

  function checkImportFiles(fileList: File[]): boolean {
    // 別の操作（書き出しなど）の途中は取り込めない。取り込み先を選ばせてから黙って捨てないよう、ここで止める。
    if (actionBusy.current) return false;
    let problem = "";
    let totalBytes = 0;
    if (fileList.length > MAX_IMPORT_FILES) problem = fmt("You can import up to {max} files at once.", { max: MAX_IMPORT_FILES });
    for (const file of fileList) {
      if (problem) break;
      if (!isImportableMarkdownFile(file.name)) problem = msg("Only Markdown (.md, .markdown, .txt) files can be imported.");
      else if (file.size > MAX_IMPORT_FILE_BYTES) problem = msg("Note content exceeds 1 MiB.");
      totalBytes += file.size;
    }
    if (!problem && totalBytes > MAX_IMPORT_TOTAL_BYTES) problem = msg("Import exceeds 4 MB.");
    setActionError(problem);
    return !problem;
  }

  // groupId は取り込み先のプロジェクト。null は「プロジェクトなし」。
  async function importMarkdown(fileList: File[], groupId: string | null = null): Promise<NotePageSummary[]> {
    if (actionBusy.current || !fileList.length) return [];
    if (!checkImportFiles(fileList)) return [];
    actionBusy.current = true;
    setBusy(true);
    setActionError("");
    try {
      const files = await Promise.all(fileList.map(async (file) => ({ name: file.name, markdown: await file.text() })));
      // サーバーは JSON にした本文の大きさで断る（改行や引用符は 2 バイトになる）ので、送る形で測り直す。
      const payload = groupId ? { files, groupId } : { files };
      if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_IMPORT_TOTAL_BYTES) throw new Error(msg("Import exceeds 4 MB."));
      const data = await pageRequest("/api/pages/import", "POST", payload);
      const created = (data.pages ?? []) as NotePageSummary[];
      if (created.length) {
        runTransition(() => setPages((current) => {
          const ids = new Set(created.map((item) => item.id));
          return [...created, ...current.filter((item) => !ids.has(item.id))].sort(byPosition);
        }), "list");
      }
      return created;
    } catch (caught) {
      setActionError(caught instanceof Error && caught.message ? caught.message : msg("Could not import Markdown files."));
      return [];
    } finally {
      actionBusy.current = false;
      setBusy(false);
    }
  }

  async function flushSubtree(id: string, includeSubpages: boolean): Promise<boolean> {
    await flushCanvasEditors();
    const ids = includeSubpages ? [id, ...descendantIdsOf(pages, id)] : [id];
    for (const pageId of ids) {
      const queue = queues.current.get(pageId);
      if (queue && !(await queue.flush())) return false;
    }
    return true;
  }

  async function loadLatest() {
    const queue = active;
    const conflict = queue?.latest;
    let latest = conflict;
    if (!queue || !latest) return;
    // ホワイトボード・スライドの 409 は本体を含まない。新しい版と古い本体を組み合わせないよう、読み直してから替える。
    if (isCanvasKind(pageKindOf(queue.page)) && latest.data === undefined) {
      try { latest = (await pageRequest(`/api/pages/${queue.page.id}`)).page as NotePage; }
      catch (caught) { setActionError(caught instanceof Error && caught.message ? caught.message : msg("Failed to open note.")); return; }
      // 読み直している間に、別の操作（もう一度押した・新しいページとして保存した）で衝突が片付いていたら、その後の編集を消さない。
      if (queues.current.get(queue.page.id) !== queue || queue.latest !== conflict) return;
    }
    queue.loadLatest(latest);
    upsertSummary(queue.page);
    // 読み直している間に別のページへ移っていたら、そのページのエディターは作り直さない。
    if (displayedId.current === queue.page.id) setEditorEpoch((value) => value + 1);
  }

  return { pages, groups, groupError, reorder, createGroup, renameGroup, deleteGroup, moveNote, moveToPage, setFavorite, updateSettings, applyShareMeta: applyMeta, flushSubtree, duplicate, changeIcon, exportPage, importMarkdown, checkImportFiles, ensureListLoaded, activeId, active, loading, listLoading, openingId, busy, error, actionError, dismissActionError: () => setActionError(""), backupError, editorEpoch, select, prefetch, cancelPrefetch, hasCached, cancelPending, deactivate, setPageShown, create, remove, load, loadLatest };
}
