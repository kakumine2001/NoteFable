"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { validateNoteContent } from "@/lib/note-document";
import { NoteSaveError, NoteSaveQueue, type NoteDraft } from "@/lib/note-save-queue";
import { byPosition, OrderRefreshSync, type ReorderRequest } from "@/lib/list-order";
import { runTransition } from "@/lib/view-transition";
import { descendantIdsOf, rootPages } from "@/lib/note-tree";
import type { NoteGroupSummary, NotePage, NotePageSettings, NotePageSummary } from "@/types/notes";
import { msg } from "@/lib/i18n/translate";

const DRAFT_PREFIX = "studymate:page-draft:v1:";

async function pageRequest(url: string, method = "GET", body?: unknown) {
  const response = await fetch(url, {
    method, cache: "no-store",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new NoteSaveError(data.error || msg("Note request failed. Your draft has been kept."), response.status, data.page);
  return data;
}

// スマホ（640px 未満）では Notes を開いたときにノート一覧を出すので、URL にノートの指定がなければ自動では開かない。
function isPhone() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;
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
  const upsertSummary = useCallback((page: NotePageSummary, { local = false }: { local?: boolean } = {}) => {
    // 保存のたびに行が動かないよう、作成順を保つ。
    setPages((current) => {
      const existing = current.find((entry) => entry.id === page.id);
      if (!existing) return [{ ...page, groupId: page.groupId ?? null }, ...current].sort(byPosition);
      const meta = local || page.locked === undefined
        ? { favoritedAt: existing.favoritedAt, fullWidth: existing.fullWidth, smallText: existing.smallText, font: existing.font, locked: existing.locked }
        : { favoritedAt: page.favoritedAt ?? null, fullWidth: page.fullWidth, smallText: page.smallText, font: page.font, locked: page.locked };
      if (existing.title === page.title && existing.icon === page.icon && existing.version === page.version && existing.updatedAt === page.updatedAt
        && existing.favoritedAt === meta.favoritedAt && existing.fullWidth === meta.fullWidth && existing.smallText === meta.smallText && existing.font === meta.font && existing.locked === meta.locked) return current;
      // 所属グループ・親・位置は移動と並べ替えの操作だけが決める（並べ替えの最中に届いた古い値で戻さない）。
      return current.map((entry) => entry.id === page.id ? { ...page, ...meta, groupId: entry.groupId, position: entry.position, parentId: entry.parentId } : entry);
    });
  }, []);

  const install = useCallback((page: NotePage) => {
    let draft: NoteDraft | undefined;
    try {
      const cached = localStorage.getItem(DRAFT_PREFIX + page.id);
      if (cached) {
        const parsed = JSON.parse(cached);
        // 新しい項目を持たない旧下書きは、保存済みページの値で補ってから検証する。
        if (Number.isSafeInteger(parsed.version)) draft = { ...validateNoteContent({ icon: page.icon, cover: page.cover, coverPosition: page.coverPosition, ...parsed }), version: parsed.version };
      }
    } catch { /* 壊れた端末キャッシュは DB の本文に影響させない。 */ }
    const queue = new NoteSaveQueue(page, async (content, version) => {
      const data = await pageRequest(`/api/pages/${page.id}`, "PATCH", { ...content, version });
      upsertSummary(data.page);
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
      const requested = new URL(window.location.href).searchParams.get("page");
      const id = data.pages.find((page: NotePageSummary) => page.id === requested)?.id ?? (isPhone() ? undefined : data.pages[0]?.id);
      if (id) await select(id, "replace");
      else {
        displayedId.current = null; setActiveId(null); setActive(undefined);
        if (requested && isPhone()) {
          // スマホで、存在しない（削除済みなど）ノートを指す URL を開いた：指定を外して一覧に戻す。
          const url = new URL(window.location.href);
          url.searchParams.delete("page");
          window.history.replaceState(null, "", url);
          window.dispatchEvent(new Event("popstate"));
        }
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : msg("Failed to load notes.")); }
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
    window.addEventListener("studymate:page-updated", onPageUpdated);
    window.addEventListener("studymate:page-created", onPageCreated);
    return () => {
      window.removeEventListener("studymate:page-updated", onPageUpdated);
      window.removeEventListener("studymate:page-created", onPageCreated);
    };
  }, [upsertSummary]);

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
      url.searchParams.set("page", page.id);
      // アプリに埋め込んだ 1 ページだけの画面（/note-embed）は戻る履歴を持たないので、積まずに置き換える。
      if (embedded) window.history.replaceState(null, "", url);
      else window.history.pushState(null, "", url);
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
        // サイドバーの一番上に見えている最上位のページを開く。
        const next = rootPages(remaining)[0];
        if (next && !isPhone()) await select(next.id, "replace");
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
  const applyMeta = (page: NotePageSummary) => setPages((current) => current.map((entry) => entry.id === page.id ? {
    ...entry, favoritedAt: page.favoritedAt ?? null, fullWidth: page.fullWidth, smallText: page.smallText, font: page.font, locked: page.locked,
  } : entry));

  const setFavorite = (id: string, favorite: boolean) => groupAction(async () => {
    const { page } = await pageRequest(`/api/pages/${id}/favorite`, "PUT", { favorite });
    runTransition(() => applyMeta(page), "list");
    return true;
  });

  const updateSettings = (id: string, settings: Partial<NotePageSettings>) => groupAction(async () => {
    const { page } = await pageRequest(`/api/pages/${id}/settings`, "PUT", settings);
    applyMeta(page);
    return true;
  });

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
    if (active && id === activeId) { active.edit({ ...active.content, icon }); return true; }
    const { page } = await pageRequest(`/api/pages/${id}/icon`, "PUT", { icon });
    // 一覧と、読み込み済みの編集内容を新しい版へそろえる（未保存の編集が残っていれば、上書きせず衝突として知らせる）。
    window.dispatchEvent(new CustomEvent<NotePage>("studymate:page-updated", { detail: page }));
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

  function loadLatest() {
    if (active?.latest) { active.loadLatest(active.latest); upsertSummary(active.page); setEditorEpoch((value) => value + 1); }
  }

  return { pages, groups, groupError, reorder, createGroup, renameGroup, deleteGroup, moveNote, moveToPage, setFavorite, updateSettings, duplicate, changeIcon, activeId, active, loading, busy, error, backupError, editorEpoch, select, create, remove, load, loadLatest };
}
