"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { validateNoteContent } from "@/lib/note-document";
import { NoteSaveError, NoteSaveQueue, type NoteDraft } from "@/lib/note-save-queue";
import type { NoteGroupSummary, NotePage, NotePageSummary } from "@/types/notes";

const DRAFT_PREFIX = "studymate:page-draft:v1:";

async function pageRequest(url: string, method = "GET", body?: unknown) {
  const response = await fetch(url, {
    method, cache: "no-store",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new NoteSaveError(data.error || "Note request failed. Your draft has been kept.", response.status, data.page);
  return data;
}

// スマホ（640px 未満）では Notes を開いたときにノート一覧を出すので、URL にノートの指定がなければ自動では開かない。
function isPhone() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;
}

export function useNotePages(enabled: boolean) {
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

  const upsertSummary = useCallback((page: NotePageSummary) => {
    // 保存のたびに行が動かないよう、作成順を保つ。
    setPages((current) => {
      const existing = current.find((entry) => entry.id === page.id);
      if (!existing) return [{ ...page, groupId: page.groupId ?? null }, ...current].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      if (existing.title === page.title && existing.icon === page.icon && existing.version === page.version && existing.updatedAt === page.updatedAt) return current;
      // 所属グループは移動の操作だけが決める。保存の応答や古い編集中データの値で上書きしない。
      return current.map((entry) => entry.id === page.id ? { ...page, groupId: entry.groupId } : entry);
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
      upsertSummary({ ...queue.page, title: queue.content.title.trim() || "Untitled", icon: queue.content.icon });
      try {
        if (queue.dirty) localStorage.setItem(DRAFT_PREFIX + page.id, JSON.stringify(queue.draft));
        else localStorage.removeItem(DRAFT_PREFIX + page.id);
        setBackupError("");
      } catch { setBackupError("Browser draft backup is unavailable. Keep this tab open until Saved appears."); }
      refresh((value) => value + 1);
    }, draft);
    queues.current.set(page.id, queue);
    queue.schedule();
    return queue;
  }, [upsertSummary]);

  const select = useCallback(async (id: string, historyMode: "push" | "replace" | "none" = "push") => {
    if (historyMode === "push" && displayedId.current === id) {
      // 読み込み中に元のページへ戻った操作も、後から来る応答で上書きしない。
      if (pendingId.current) { ++navigation.current; pendingId.current = null; setLoading(false); setError(""); }
      return;
    }
    const intent = ++navigation.current;
    pendingId.current = id;
    setLoading(true);
    setError("");
    try {
      // キャッシュを表示しても、再取得した版を照合して別タブの更新を拾う。
      const data = await pageRequest(`/api/pages/${id}`);
      if (intent !== navigation.current) return;
      const existing = queues.current.get(id);
      const queue = existing ?? install(data.page);
      if (existing && !existing.dirty && existing.version !== data.page.version) {
        existing.loadLatest(data.page);
        setEditorEpoch((value) => value + 1);
      }
      else if (existing && existing.version !== data.page.version && existing.status !== "saving") {
        existing.status = "conflict";
        existing.latest = data.page;
        existing.error = "This note was changed in another tab. Save a copy or load the latest version.";
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
    } catch (caught) { if (intent === navigation.current) setError(caught instanceof Error ? caught.message : "Failed to open note."); }
    finally { if (intent === navigation.current) { pendingId.current = null; setLoading(false); } }
  }, [install, upsertSummary]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await pageRequest("/api/pages");
      loaded.current = true;
      const known = new Set<string>(data.pages.map((page: NotePageSummary) => page.id));
      const extra = createdWhileLoading.current.filter((page) => !known.has(page.id));
      createdWhileLoading.current = [];
      setPages(extra.length ? [...extra, ...data.pages].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)) : data.pages);
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
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Failed to load notes."); }
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
        queue.error = "This note was changed from the chat. Save a copy or load the latest version.";
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

  async function create(copy = false) {
    if (actionBusy.current) return;
    actionBusy.current = true;
    setBusy(true);
    setError("");
    try {
      const current = activeId ? queues.current.get(activeId) : undefined;
      const content = copy && current ? { ...current.content, title: `${current.content.title.slice(0, 185)} (copy)` } : { title: "Untitled", icon: null, cover: null, coverPosition: null, blocks: [] };
      const { page } = await pageRequest("/api/pages", "POST", content);
      if (copy && current) {
        current.loadLatest(current.latest ?? current.page);
        upsertSummary(current.page);
      }
      const queue = install(page);
      upsertSummary(page);
      ++navigation.current;
      pendingId.current = null;
      setActiveId(page.id);
      displayedId.current = page.id;
      setActive(queue);
      setLoading(false);
      const url = new URL(window.location.href);
      url.searchParams.set("page", page.id);
      window.history.pushState(null, "", url);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Failed to create note."); }
    finally { actionBusy.current = false; setBusy(false); }
  }

  async function remove(id: string) {
    if (actionBusy.current) return;
    actionBusy.current = true;
    setBusy(true);
    setError("");
    try {
      const queue = queues.current.get(id);
      if (queue && !(await queue.flush())) throw new Error("Resolve the unsaved draft before deleting this note.");
      await pageRequest(`/api/pages/${id}`, "DELETE");
      queues.current.delete(id);
      try { localStorage.removeItem(DRAFT_PREFIX + id); } catch { /* 削除後の古いキャッシュは復元しない。 */ }
      const remaining = pages.filter((page) => page.id !== id);
      setPages(remaining);
      if (activeId === id) {
        displayedId.current = null;
        setActiveId(null);
        setActive(undefined);
        const url = new URL(window.location.href);
        url.searchParams.delete("page");
        window.history.replaceState(null, "", url);
        if (remaining[0] && !isPhone()) await select(remaining[0].id, "replace");
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Failed to delete note."); }
    finally { actionBusy.current = false; setBusy(false); }
  }

  // グループ操作は、失敗したら画面の状態を変えず、理由だけ groupError に出す。
  async function groupAction<T>(run: () => Promise<T>): Promise<T | null> {
    setGroupError("");
    try { return await run(); }
    catch (caught) { setGroupError(caught instanceof Error ? caught.message : "Could not change the group."); return null; }
  }

  const createGroup = (name: string) => groupAction(async () => {
    const { group } = await pageRequest("/api/pages/groups", "POST", { name });
    setGroups((current) => [...current, group]);
    return group as NoteGroupSummary;
  });

  const renameGroup = (id: string, name: string) => groupAction(async () => {
    const { group } = await pageRequest(`/api/pages/groups/${id}`, "PATCH", { name });
    setGroups((current) => current.map((entry) => entry.id === id ? { ...entry, name: group.name } : entry));
    return true;
  });

  const deleteGroup = (id: string) => groupAction(async () => {
    await pageRequest(`/api/pages/groups/${id}`, "DELETE");
    setGroups((current) => current.filter((entry) => entry.id !== id));
    // 中のノートは消えず、グループなしに戻る。
    setPages((current) => current.map((page) => page.groupId === id ? { ...page, groupId: null } : page));
    return true;
  });

  const moveNote = (id: string, groupId: string | null) => groupAction(async () => {
    await pageRequest(`/api/pages/${id}/group`, "PUT", { groupId });
    setPages((current) => current.map((page) => page.id === id ? { ...page, groupId } : page));
    return true;
  });

  function loadLatest() {
    if (active?.latest) { active.loadLatest(active.latest); upsertSummary(active.page); setEditorEpoch((value) => value + 1); }
  }

  return { pages, groups, groupError, createGroup, renameGroup, deleteGroup, moveNote, activeId, active, loading, busy, error, backupError, editorEpoch, select, create, remove, load, loadLatest };
}
