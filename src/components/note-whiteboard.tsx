"use client";

import type { BlockNoteEditor } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { ArrowUpRight, Shapes } from "lucide-react";
import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useT } from "@/components/i18n-provider";
import { NoteIcon } from "@/components/note-icon";
import type { MentionPage } from "@/components/note-mention";
import { PageKindIcon } from "@/components/page-kind-icon";
import { listWhiteboardFrames } from "@/lib/whiteboard/frames";

// ノートにホワイトボード（全体または指定の 1 枠）を埋め込むカスタムブロック（note-math.tsx と同じ構成）。
// 保存する props は pageId と任意の frameId のみ。プレビューは表示時に最新の白板からオフスクリーン描画し、複製を持たない。

const DynamicWhiteboardThumbnail = dynamic(
  () => import("@/components/whiteboard/whiteboard-thumbnail"),
  { ssr: false },
);

const DynamicWhiteboardFramePicker = dynamic(
  () => import("@/components/whiteboard/whiteboard-frame-picker"),
  { ssr: false },
);

// ---- 新規挿入直後の自動オープン制御 ----
let pendingNewWhiteboardBlock = false;

export function markNextWhiteboardBlockAutoOpen() {
  pendingNewWhiteboardBlock = true;
}

// ---- 白板データのクライアント共有キャッシュ ----
// 同じノートに同じ白板の複数枠が埋め込まれている場合、GET /api/pages/:id を 1 回にまとめる。
// 別のタブ・ページで白板を編集して戻った時は、画面のフォーカス・ページ更新イベントで最新内容へ再検証する。
type CachedWhiteboard =
  | { status: "loading"; fetchedAt: number }
  | { status: "ready"; title: string; icon: string | null; version: number; data: unknown; fetchedAt: number }
  | { status: "missing"; fetchedAt: number }
  | { status: "error"; fetchedAt: number };

const cache = new Map<string, CachedWhiteboard>();
const inflight = new Map<string, Promise<void>>();
const subscribers = new Map<string, Set<() => void>>();
let globalListenersAttached = false;

function notify(pageId: string) {
  subscribers.get(pageId)?.forEach((listener) => listener());
}

function setEntry(pageId: string, entry: CachedWhiteboard) {
  cache.set(pageId, entry);
  notify(pageId);
}

function fetchWhiteboard(pageId: string, force = false) {
  if (!pageId) return;
  if (inflight.has(pageId)) return;
  const current = cache.get(pageId);
  if (!force && current && current.status === "ready" && Date.now() - current.fetchedAt < 1500) return;
  if (!current) setEntry(pageId, { status: "loading", fetchedAt: Date.now() });

  const job = fetch(`/api/pages/${encodeURIComponent(pageId)}`, { cache: "no-store" })
    .then(async (response) => {
      if (response.status === 404) {
        setEntry(pageId, { status: "missing", fetchedAt: Date.now() });
        return;
      }
      if (!response.ok) {
        if (!cache.get(pageId) || cache.get(pageId)?.status === "loading") {
          setEntry(pageId, { status: "error", fetchedAt: Date.now() });
        }
        return;
      }
      const payload = await response.json().catch(() => null) as {
        page?: { id: string; kind?: string; title?: string; icon?: string | null; version?: number; data?: unknown };
      } | null;
      const page = payload?.page;
      if (!page || page.kind !== "whiteboard") {
        setEntry(pageId, { status: "missing", fetchedAt: Date.now() });
        return;
      }
      setEntry(pageId, {
        status: "ready",
        title: typeof page.title === "string" ? page.title : "",
        icon: page.icon ?? null,
        version: typeof page.version === "number" ? page.version : 0,
        data: page.data ?? { elements: [] },
        fetchedAt: Date.now(),
      });
    })
    .catch(() => {
      const existing = cache.get(pageId);
      if (!existing || existing.status === "loading") {
        setEntry(pageId, { status: "error", fetchedAt: Date.now() });
      }
    })
    .finally(() => {
      inflight.delete(pageId);
    });
  inflight.set(pageId, job);
}

function revalidateActive() {
  for (const [pageId, set] of subscribers) {
    if (set.size > 0) fetchWhiteboard(pageId, true);
  }
}

function attachGlobalListeners() {
  if (globalListenersAttached || typeof window === "undefined") return;
  globalListenersAttached = true;

  window.addEventListener("notefable:page-updated", (event) => {
    const detail = (event as CustomEvent<{ id?: string; kind?: string; title?: string; icon?: string | null; version?: number; data?: unknown } | undefined>).detail;
    const id = detail?.id;
    if (id && subscribers.get(id)?.size) {
      if (detail.kind === "whiteboard" && detail.data !== undefined) {
        const current = cache.get(id);
        setEntry(id, {
          status: "ready",
          title: typeof detail.title === "string" ? detail.title : (current?.status === "ready" ? current.title : ""),
          icon: detail.icon !== undefined ? detail.icon : (current?.status === "ready" ? current.icon : null),
          version: typeof detail.version === "number" ? detail.version : (current?.status === "ready" ? current.version : 0),
          data: detail.data,
          fetchedAt: Date.now(),
        });
      } else {
        fetchWhiteboard(id, true);
      }
    } else if (!id) {
      revalidateActive();
    }
  });

  window.addEventListener("notefable:page-meta", (event) => {
    const detail = (event as CustomEvent<{ id?: string; title?: string; icon?: string | null } | undefined>).detail;
    if (!detail?.id) return;
    const current = cache.get(detail.id);
    if (current?.status === "ready") {
      setEntry(detail.id, {
        ...current,
        title: typeof detail.title === "string" ? detail.title : current.title,
        icon: detail.icon !== undefined ? detail.icon : current.icon,
      });
    }
  });

  window.addEventListener("notefable:pages-trashed", (event) => {
    const detail = (event as CustomEvent<{ ids?: string[] } | string[] | undefined>).detail;
    const ids = Array.isArray(detail) ? detail : Array.isArray(detail?.ids) ? detail.ids : [];
    for (const id of ids) {
      if (subscribers.get(id)?.size || cache.has(id)) {
        setEntry(id, { status: "missing", fetchedAt: Date.now() });
      }
    }
  });

  window.addEventListener("notefable:page-created", (event) => {
    const detail = (event as CustomEvent<{ id?: string } | undefined>).detail;
    if (detail?.id && subscribers.get(detail.id)?.size) fetchWhiteboard(detail.id, true);
  });

  window.addEventListener("focus", revalidateActive);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") revalidateActive();
  });
}

const EMPTY_ENTRY: CachedWhiteboard = { status: "loading", fetchedAt: 0 };

function useWhiteboardEmbedData(pageId: string): CachedWhiteboard {
  const subscribe = useCallback((listener: () => void) => {
    if (!pageId) return () => {};
    attachGlobalListeners();
    let set = subscribers.get(pageId);
    if (!set) {
      set = new Set();
      subscribers.set(pageId, set);
    }
    set.add(listener);
    fetchWhiteboard(pageId, false);
    return () => {
      set.delete(listener);
      if (!set.size) subscribers.delete(pageId);
    };
  }, [pageId]);

  return useSyncExternalStore(
    subscribe,
    () => (pageId ? cache.get(pageId) ?? EMPTY_ENTRY : EMPTY_ENTRY),
    () => EMPTY_ENTRY,
  );
}

// ---- エディター単位のコンテキスト（ピッカー・遷移・ページ一覧） ----
type PickerSession = { blockId: string; pageId: string; frameId: string };

type NoteWhiteboardContextValue = {
  pages: MentionPage[] | null;
  openPicker: (blockId: string, pageId: string, frameId: string) => void;
  openWhiteboard: (pageId: string, frameId: string) => void;
};

const NoteWhiteboardContext = createContext<NoteWhiteboardContextValue | null>(null);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = BlockNoteEditor<any, any, any>;

export function NoteWhiteboardProvider({
  editor,
  editable,
  pages,
  openPage,
  children,
}: {
  editor: AnyEditor;
  editable: boolean;
  pages: MentionPage[] | null;
  openPage: (id: string, reveal?: string) => void;
  children: ReactNode;
}) {
  const [session, setSession] = useState<PickerSession | null>(null);
  const activeSession = editable ? session : null;

  // 親から渡された一覧（NotesWorkspace の notes.pages）で白板の版・削除を検知して即座に同期する。
  useEffect(() => {
    if (!pages || !pages.length) return;
    const byId = new Map(pages.map((page) => [page.id, page as MentionPage & { version?: number }]));
    for (const [pageId, set] of subscribers) {
      if (!set.size) continue;
      const summary = byId.get(pageId);
      const existing = cache.get(pageId);
      if (!summary || summary.kind !== "whiteboard") {
        if (existing?.status !== "missing") setEntry(pageId, { status: "missing", fetchedAt: Date.now() });
        continue;
      }
      if (existing?.status === "missing") {
        fetchWhiteboard(pageId, true);
      } else if (existing?.status === "ready") {
        if (typeof summary.version === "number" && summary.version !== existing.version) {
          fetchWhiteboard(pageId, true);
        } else if ((typeof summary.title === "string" && summary.title !== existing.title) || (summary.icon !== undefined && summary.icon !== existing.icon)) {
          setEntry(pageId, {
            ...existing,
            title: typeof summary.title === "string" ? summary.title : existing.title,
            icon: summary.icon !== undefined ? summary.icon : existing.icon,
          });
        }
      }
    }
  }, [pages]);

  const openPicker = useCallback((blockId: string, pageId: string, frameId: string) => {
    if (!editable) return;
    setSession({ blockId, pageId, frameId });
  }, [editable]);

  const openWhiteboard = useCallback((pageId: string, frameId: string) => {
    if (!pageId) return;
    openPage(pageId, frameId || undefined);
  }, [openPage]);

  const closePicker = useCallback(() => {
    setSession(null);
    window.setTimeout(() => { if (editor.isEditable) editor.focus(); }, 0);
  }, [editor]);

  const handlePick = useCallback((choice: { pageId: string; frameId: string }) => {
    if (!activeSession || !editor.isEditable) return;
    if (editor.getBlock(activeSession.blockId)) {
      editor.updateBlock(activeSession.blockId, {
        props: { pageId: choice.pageId, frameId: choice.frameId },
      });
    }
    fetchWhiteboard(choice.pageId, true);
    setSession(null);
  }, [activeSession, editor]);

  const value = useMemo<NoteWhiteboardContextValue>(
    () => ({ pages, openPicker, openWhiteboard }),
    [pages, openPicker, openWhiteboard],
  );

  return (
    <NoteWhiteboardContext.Provider value={value}>
      {children}
      {activeSession && (
        <DynamicWhiteboardFramePicker
          mode="embed"
          initialPageId={activeSession.pageId || undefined}
          initialFrameId={activeSession.frameId || undefined}
          pages={pages ?? undefined}
          onPickEmbed={handlePick}
          onClose={closePicker}
        />
      )}
    </NoteWhiteboardContext.Provider>
  );
}

// ---- ホワイトボード埋め込みブロック（whiteboard） ----
export const createWhiteboardBlockSpec = createReactBlockSpec(
  {
    type: "whiteboard",
    propSchema: {
      pageId: { default: "" },
      frameId: { default: "" },
    },
    content: "none",
  },
  {
    render: function WhiteboardBlock({ block, editor }) {
      const t = useT();
      const ctx = useContext(NoteWhiteboardContext);
      const pageId = block.props.pageId.trim();
      const frameId = block.props.frameId.trim();
      const entry = useWhiteboardEmbedData(pageId);
      const autoOpenedRef = useRef(false);

      useEffect(() => {
        if (!ctx || !editor.isEditable || !pendingNewWhiteboardBlock || pageId || autoOpenedRef.current) return;
        const id = window.requestAnimationFrame(() => {
          if (!pendingNewWhiteboardBlock) return;
          pendingNewWhiteboardBlock = false;
          autoOpenedRef.current = true;
          ctx.openPicker(block.id, "", "");
        });
        return () => window.cancelAnimationFrame(id);
      }, [ctx, editor, block.id, pageId]);

      const frames = useMemo(
        () => (entry.status === "ready" ? listWhiteboardFrames(entry.data) : []),
        [entry],
      );
      const matchedFrame = useMemo(() => {
        if (!frameId || entry.status !== "ready") return null;
        const index = frames.findIndex((item) => item.id === frameId);
        if (index < 0) return null;
        return { frame: frames[index], index };
      }, [frameId, entry.status, frames]);

      // 未選択（/whiteboard を入れた直後でキャンセルした場合など）。
      if (!pageId) {
        return (
          <div
            contentEditable={false}
            className={`note-whiteboard-embed is-empty${editor.isEditable ? " is-editable" : ""}`}
            role={editor.isEditable ? "button" : undefined}
            tabIndex={editor.isEditable ? 0 : undefined}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => { if (editor.isEditable) ctx?.openPicker(block.id, "", ""); }}
            onKeyDown={(event) => {
              if (editor.isEditable && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                ctx?.openPicker(block.id, "", "");
              }
            }}
          >
            <Shapes size={17} aria-hidden="true" className="shrink-0" />
            <span>{t("Choose a whiteboard or frame")}</span>
          </div>
        );
      }

      // 削除済み・ゴミ箱にある白板。
      if (entry.status === "missing") {
        return (
          <div contentEditable={false} className="note-whiteboard-embed is-unavailable" onMouseDown={(event) => event.preventDefault()}>
            <Shapes size={18} aria-hidden="true" className="shrink-0" />
            <div className="note-whiteboard-embed-unavailable-text">
              <strong>{t("Whiteboard unavailable")}</strong>
              <span>{t("This whiteboard was moved to Trash or deleted.")}</span>
            </div>
            {editor.isEditable && (
              <button
                type="button"
                className="note-whiteboard-embed-action"
                onClick={() => ctx?.openPicker(block.id, "", "")}
              >
                {t("Change")}
              </button>
            )}
          </div>
        );
      }

      const summary = ctx?.pages?.find((item) => item.id === pageId);
      const displayTitle = (entry.status === "ready" ? entry.title : summary?.title ?? "").trim() || t("Untitled");
      const displayIcon = entry.status === "ready" ? entry.icon : summary?.icon ?? null;
      const frameLabel = frameId
        ? (matchedFrame ? (matchedFrame.frame.name || t("Frame {number}", { number: matchedFrame.index + 1 })) : null)
        : null;

      const openTarget = () => {
        ctx?.openWhiteboard(pageId, frameId);
      };

      return (
        <div
          contentEditable={false}
          className="note-whiteboard-embed is-card"
          onMouseDown={(event) => event.preventDefault()}
        >
          <div className="note-whiteboard-embed-header">
            <button type="button" className="note-whiteboard-embed-link" onClick={openTarget}>
              <span className="note-whiteboard-embed-icon" aria-hidden="true">
                <NoteIcon icon={displayIcon} fallback={<PageKindIcon kind="whiteboard" size={15} />} />
              </span>
              <span className="note-whiteboard-embed-title">
                <span className="truncate">{displayTitle}</span>
                {frameLabel && (
                  <>
                    <span className="note-whiteboard-embed-sep" aria-hidden="true">/</span>
                    <span className="note-whiteboard-embed-frame truncate">{frameLabel}</span>
                  </>
                )}
              </span>
              <ArrowUpRight size={14} className="note-whiteboard-embed-arrow rtl-mirror" aria-hidden="true" />
            </button>
            {editor.isEditable && (
              <button
                type="button"
                className="note-whiteboard-embed-action"
                onClick={(event) => {
                  event.stopPropagation();
                  ctx?.openPicker(block.id, pageId, frameId);
                }}
              >
                {t("Change")}
              </button>
            )}
          </div>

          <div
            className="note-whiteboard-embed-preview"
            role="button"
            tabIndex={0}
            aria-label={t("Open whiteboard")}
            onClick={openTarget}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openTarget();
              }
            }}
          >
            {entry.status === "loading" ? (
              <p className="note-whiteboard-embed-status">{t("Loading whiteboard…")}</p>
            ) : entry.status === "error" ? (
              <div className="note-whiteboard-embed-error">
                <span>{t("Could not load whiteboard.")}</span>
                <button
                  type="button"
                  className="note-whiteboard-embed-action"
                  onClick={(event) => {
                    event.stopPropagation();
                    fetchWhiteboard(pageId, true);
                  }}
                >
                  {t("Retry")}
                </button>
              </div>
            ) : (
              <DynamicWhiteboardThumbnail
                data={entry.data}
                frameId={frameId || null}
                fileUrlMode="owner"
                canvasBackgroundColor={false}
                ariaLabel={frameLabel ? `${displayTitle} / ${frameLabel}` : displayTitle}
                className="is-embed"
              />
            )}
          </div>
        </div>
      );
    },
    toExternalHTML: function WhiteboardBlockExternal({ block }) {
      return <span>{block.props.pageId ? "[Whiteboard]" : ""}</span>;
    },
  },
);
