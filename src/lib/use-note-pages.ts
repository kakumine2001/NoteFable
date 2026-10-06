"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { validateNoteContent } from "@/lib/note-document";
import { NoteSaveError, NoteSaveQueue, type NoteDraft } from "@/lib/note-save-queue";
import type { NotePage, NotePageSummary } from "@/types/notes";

const DRAFT_PREFIX = "studymate:page-draft:v1:";

async function pageRequest(url: string, method = "GET", body?: unknown) {
  const response = await fetch(url, {
    method, cache: "no-store",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new NoteSaveError(data.error || "Page request failed. Your draft has been kept.", response.status, data.page);
  return data;
}

export function useNotePages(enabled: boolean) {
  const [pages, setPages] = useState<NotePageSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<NoteSaveQueue>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [backupError, setBackupError] = useState("");
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [, refresh] = useState(0);
  const queues = useRef(new Map<string, NoteSaveQueue>());
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
      if (!existing) return [page, ...current].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      if (existing.title === page.title && existing.icon === page.icon && existing.version === page.version && existing.updatedAt === page.updatedAt) return current;
      return current.map((entry) => entry.id === page.id ? page : entry);
    });
  }, []);

  const install = useCallback((page: NotePage) => {
    let draft: NoteDraft | undefined;
    try {
      const cached = localStorage.getItem(DRAFT_PREFIX + page.id);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Number.isSafeInteger(parsed.version)) draft = { ...validateNoteContent(parsed), version: parsed.version };
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
        existing.error = "This page was changed in another tab. Save a copy or load the latest version.";
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
    } catch (caught) { if (intent === navigation.current) setError(caught instanceof Error ? caught.message : "Failed to open page."); }
    finally { if (intent === navigation.current) { pendingId.current = null; setLoading(false); } }
  }, [install, upsertSummary]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await pageRequest("/api/pages");
      loaded.current = true;
      setPages(data.pages);
      const requested = new URL(window.location.href).searchParams.get("page");
      const id = data.pages.find((page: NotePageSummary) => page.id === requested)?.id ?? data.pages[0]?.id;
      if (id) await select(id, "replace");
      else { displayedId.current = null; setActiveId(null); setActive(undefined); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Failed to load pages."); }
    finally { setLoading(false); }
  }, [select]);

  useEffect(() => {
    if (enabled && !loaded.current && !started.current) {
      started.current = true;
      queueMicrotask(() => { void load(); });
    }
  }, [enabled, load]);

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
      const content = copy && current ? { ...current.content, title: `${current.content.title.slice(0, 185)} (copy)` } : { title: "Untitled", icon: null, cover: null, blocks: [] };
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
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Failed to create page."); }
    finally { actionBusy.current = false; setBusy(false); }
  }

  async function remove(id: string) {
    if (actionBusy.current) return;
    actionBusy.current = true;
    setBusy(true);
    setError("");
    try {
      const queue = queues.current.get(id);
      if (queue && !(await queue.flush())) throw new Error("Resolve the unsaved draft before deleting this page.");
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
        if (remaining[0]) await select(remaining[0].id, "replace");
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Failed to delete page."); }
    finally { actionBusy.current = false; setBusy(false); }
  }

  function loadLatest() {
    if (active?.latest) { active.loadLatest(active.latest); upsertSummary(active.page); setEditorEpoch((value) => value + 1); }
  }

  return { pages, activeId, active, loading, busy, error, backupError, editorEpoch, select, create, remove, load, loadLatest };
}
