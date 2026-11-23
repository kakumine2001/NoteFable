"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { validateNoteContent } from "@/lib/note-document";
import { NoteSaveError, NoteSaveQueue, type NoteDraft } from "@/lib/note-save-queue";
import { byPosition, OrderRefreshSync, type ReorderRequest } from "@/lib/list-order";
import { runTransition } from "@/lib/view-transition";
import { descendantIdsOf } from "@/lib/note-tree";
import { isImportableMarkdownFile, MAX_IMPORT_FILE_BYTES, MAX_IMPORT_FILES, MAX_IMPORT_TOTAL_BYTES } from "@/lib/note-io";
import { isCanvasKind, pageKindOf } from "@/lib/page-kinds";
import type { NoteGroupSummary, NotePage, NotePageSettings, NotePageSummary } from "@/types/notes";
import { fmt, msg } from "@/lib/i18n/translate";

const DRAFT_PREFIX = "notefable:page-draft:v1:";

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
export function useNotePages(enabled: boolean, { embedded = false }: { embedded?: boolean } = {}) {
  const orderSync=useRef(new OrderRefreshSync());
  const reorderBusy=useRef(false);
  const [pages, setPages] = useState<NotePageSummary[]>([]);
  const [groups, setGroups] = useState<NoteGroupSummary[]>([]);
  const [groupError, setGroupError] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<NoteSaveQueue>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // 書き出し・取り込みの失敗。一覧の読み込み失敗（error）と分けて、画面を隠さず、閉じられる帯で出す。
  const [actionError, setActionError] = useState("");
  const [backupError, setBackupError] = useState("");
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [, refresh] = useState(0);
  const queues = useRef(new Map<string, NoteSaveQueue>());
  const createdWhileLoading = useRef<NotePageSummary[]>([]);
  const loaded = useRef(false);
  const started = useRef(false);
  const navigation = useRef(0);
  const actionBusy = useRef(false);
  const displayedId = useRef<string | null>(null);
  const pendingId = useRef<string | null>(null);

  // local: 編集中の内容（queue.page は開いた時点の古い行）から作った 1 件。お気に入り・表示設定は一覧の値を残す。
  // それ以外（サーバーから読んだ・保存した行）は、お気に入り・表示設定をサーバーの値にそろえる（別タブ・アプリでの変更を拾う）。
  // この画面で表示設定・お気に入りを変えるたびに進める番号。ページごとに最後に変えた番号を覚える（保存の応答が古い値で戻さないため）。
  const metaSequence = useRef(0);
  const metaChanged = useRef(new Map<string, number>());
  const markMeta = useCallback((id: string) => { metaChanged.current.set(id, ++metaSequence.current); }, []);

  // local: 編集中の内容（queue.page は開いた時点の古い行）から作った 1 件。お気に入り・表示設定は一覧の値を残す。
  // since: 保存を始めた時点の番号。その後にこの画面で設定を変えていたら一覧の値を残し、変えていなければサーバーの値（別のタブ・アプリでの変更）を使う。
  const upsertSummary = useCallback((page: NotePageSummary, { local = false, since }: { local?: boolean; since?: number } = {}) => {
    // 保存のたびに行が動かないよう、作成順を保つ。
    setPages((current) => {
      const existing = current.find((entry) => entry.id === page.id);
      if (!existing) return [{ ...page, groupId: page.groupId ?? null }, ...current].sort(byPosition);
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
      return current.map((entry) => entry.id === page.id ? { ...page, ...meta, kind: page.kind ?? entry.kind, groupId: entry.groupId, position: entry.position, parentId: entry.parentId } : entry);
    });
  }, []);

  const install = useCallback((page: NotePage) => {
    let draft: NoteDraft | undefined;
    try {
      // ホワイトボード・スライドにノートの下書きは無い（古い画面が残したものは、ノートの本文として送ると断られ続けるので捨てる）。
      if (isCanvasKind(pageKindOf(page))) localStorage.removeItem(DRAFT_PREFIX + page.id);
      const cached = isCanvasKind(pageKindOf(page)) ? null : localStorage.getItem(DRAFT_PREFIX + page.id);
      if (cached) {
        const parsed = JSON.parse(cached);
        // 新しい項目を持たない旧下書きは、保存済みページの値で補ってから検証する。
        if (Number.isSafeInteger(parsed.version)) draft = { ...validateNoteContent({ icon: page.icon, cover: page.cover, coverPosition: page.coverPosition, ...parsed }), version: parsed.version };
      }
    } catch { /* 壊れた端末キャッシュは DB の本文に影響させない。 */ }
    const queue = new NoteSaveQueue(page, async (content, version) => {
      const started = metaSequence.current;
      const data = await pageRequest(`/api/pages/${page.id}`, "PATCH", { ...content, version });
      // 保存の間にこの画面でロックなどを変えていたら、応答の（変更前かもしれない）値で戻さない。変えていなければ別のタブ・アプリでの変更を拾う。
      upsertSummary(data.page, { since: started });
      return data.page;
    }, () => {
      upsertSummary({ ...queue.page, title: queue.content.title.trim() || "Untitled", icon: queue.content.icon }, { local: true });
      try {
        if (queue.dirty) localStorage.setItem(DRAFT_PREFIX + page.id, JSON.stringify(queue.draft));
        else localStorage.removeItem(DRAFT_PREFIX + page.id);
        setBackupError("");
      } catch { setBackupError(msg("Browser draft backup is unavailable. Keep this tab open until Saved appears.")); }
      refresh((value) => value + 1);
    }, draft);
    queues.current.set(page.id, queue);
    queue.schedule();
    return queue;
  }, [upsertSummary]);

  // 開けたら true。ノートが無い（ゴミ箱に入った・削除された）ときだけ false で、呼び出し側が古いリンクを片付けられる。
  const select = useCallback(async (id: string, historyMode: "push" | "replace" | "none" = "push"): Promise<boolean> => {
    if (historyMode === "push" && displayedId.current === id) {
      // 読み込み中に元のページへ戻った操作も、後から来る応答で上書きしない。
      if (pendingId.current) { ++navigation.current; pendingId.current = null; setLoading(false); setError(""); }
      return true;
    }
    const intent = ++navigation.current;
    pendingId.current = id;
    setLoading(true);
    setError("");
    try {
      // キャッシュを表示しても、再取得した版を照合して別タブの更新を拾う。
      const data = await pageRequest(`/api/pages/${id}`);
      if (intent !== navigation.current) return true;
      const existing = queues.current.get(id);
      const queue = existing ?? install(data.page);
      if (existing && !existing.dirty && existing.version !== data.page.version) {
        existing.loadLatest(data.page);
        setEditorEpoch((value) => value + 1);
      }
      else if (existing && existing.version !== data.page.version && existing.status !== "saving") {
        existing.status = "conflict";
        existing.latest = data.page;
        existing.error = msg("This note was changed in another tab. Save a copy or load the latest version.");
      }
      setActiveId(id);
      displayedId.current = id;
      setActive(queue);
      upsertSummary({ ...data.page, title: queue.content.title.trim() || "Untitled", icon: queue.content.icon });
      const url = new URL(window.location.href);
      url.searchParams.set("page", id);
      if (historyMode !== "none" && url.searchParams.get("view") === "pages" && url.href !== window.location.href) {
        if (historyMode === "push") window.history.pushState(null, "", url);
        else window.history.replaceState(null, "", url);
      }
      return true;
    } catch (caught) {
      if (intent !== navigation.current) return true;
      setError(caught instanceof Error ? caught.message : msg("Failed to open note."));
      const gone = caught instanceof NoteSaveError && caught.status === 404;
      // 別のタブで捨てた（または削除した）ノートが一覧に残っていたら外す。
      if (gone) setPages((current) => current.filter((page) => page.id !== id));
      return !gone;
    }
    finally { if (intent === navigation.current) { pendingId.current = null; setLoading(false); } }
  }, [install, upsertSummary]);

  const load = useCallback(async () => {
    setLoading(true);
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
    finally { setLoading(false); }
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
      // まだ開いていないページでも、一覧の題名と版は最新にする。
      if (loaded.current) upsertSummary(page);
      const queue = queues.current.get(page.id);
      if (!queue || queue.version === page.version) return;
      if (!queue.dirty && queue.status !== "saving") {
        // ホワイトボード・スライドで本体（data）の無い応答が届いたら、古い本体と新しい版を組み合わせない（別のタブの保存を上書きさせる）。
        // 読み直してから替える。
        if (isCanvasKind(pageKindOf(page.kind ? page : queue.page)) && page.data === undefined) {
          void pageRequest(`/api/pages/${page.id}`).then((data) => {
            const current = queues.current.get(page.id);
            if (!current || current.dirty || current.status === "saving" || current.version === data.page.version) return;
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
    window.addEventListener("notefable:page-meta", onPageMeta);
    window.addEventListener("notefable:page-updated", onPageUpdated);
    window.addEventListener("notefable:page-created", onPageCreated);
    return () => {
      window.removeEventListener("notefable:page-meta", onPageMeta);
      window.removeEventListener("notefable:page-updated", onPageUpdated);
      window.removeEventListener("notefable:page-created", onPageCreated);
    };
  }, [upsertSummary, markMeta]);

  useEffect(() => {
    function onPopState() {
      const url = new URL(window.location.href);
      const id = url.searchParams.get("page");
      if (url.searchParams.get("view") === "pages" && id && id !== displayedId.current) void select(id, "none");
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [select]);

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
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", flushOnHide);
      for (const queue of currentQueues.values()) void queue.flush();
    };
  }, []);

  // parentId を渡すと、そのページの中にサブページを作る。
  async function create(copy = false, parentId: string | null = null) {
    if (actionBusy.current) return;
    actionBusy.current = true;
    setBusy(true);
    setError("");
    try {
      const current = activeId ? queues.current.get(activeId) : undefined;
      const content = copy && current ? { ...current.content, title: `${current.content.title.slice(0, 185)} (copy)` } : { title: "Untitled", icon: null, cover: null, coverPosition: null, blocks: [] };
      // 競合の副本は元のページと同じ親の下に作る（サブページなら同じ親、グループも親に従う）。
      const copyParent = copy && activeId ? pages.find((entry) => entry.id === activeId)?.parentId ?? null : null;
      const parent = copy ? copyParent : parentId;
      const { page } = await pageRequest("/api/pages", "POST", { ...content, ...(parent ? { parentId: parent } : {}) });
      if (copy && current) {
        current.loadLatest(current.latest ?? current.page);
        upsertSummary(current.page);
      }
      const queue = install(page);
      runTransition(() => upsertSummary(page), "list");
      ++navigation.current;
      pendingId.current = null;
      setActiveId(page.id);
      displayedId.current = page.id;
      setActive(queue);
      setLoading(false);
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
        queues.current.delete(removedId);
        try { localStorage.removeItem(DRAFT_PREFIX + removedId); } catch { /* ゴミ箱へ移した後の古い下書きは、復元後の本文に重ねない。 */ }
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
    // ホワイトボード・スライドはノートの自動保存に乗せられない（本文の形が違う）ので、開いていても専用の API で書く。
    if (active && id === activeId && !isCanvasKind(pageKindOf(active.page))) { active.edit({ ...active.content, icon }); return true; }
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
    if (loading) return false;
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
    const ids = includeSubpages ? [id, ...descendantIdsOf(pages, id)] : [id];
    for (const pageId of ids) {
      const queue = queues.current.get(pageId);
      if (queue && !(await queue.flush())) return false;
    }
    return true;
  }

  function loadLatest() {
    if (active?.latest) { active.loadLatest(active.latest); upsertSummary(active.page); setEditorEpoch((value) => value + 1); }
  }

  return { pages, groups, groupError, reorder, createGroup, renameGroup, deleteGroup, moveNote, moveToPage, setFavorite, updateSettings, applyShareMeta: applyMeta, flushSubtree, duplicate, changeIcon, exportPage, importMarkdown, checkImportFiles, ensureListLoaded, activeId, active, loading, busy, error, actionError, dismissActionError: () => setActionError(""), backupError, editorEpoch, select, create, remove, load, loadLatest };
}
