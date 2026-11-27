"use client";

import { ArrowLeft, Check, Frame, LoaderCircle, Search, Shapes, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/components/i18n-provider";
import { NoteIcon } from "@/components/note-icon";
import { PageKindIcon } from "@/components/page-kind-icon";
import WhiteboardThumbnail from "@/components/whiteboard/whiteboard-thumbnail";
import { localizeSystemText } from "@/lib/i18n/translate";
import type { WhiteboardFrame, WhiteboardPickerPage } from "@/lib/slides/whiteboard-embed";
import { useBackToClose } from "@/lib/use-back-to-close";
import { StorageLimitError } from "@/lib/usage-plans";
import { listWhiteboardFrames, toRenderableScene, type WhiteboardFrameInfo } from "@/lib/whiteboard/frames";
import { renderWhiteboardSnapshot } from "@/lib/whiteboard/render-frame";
import { uploadImageBlob } from "@/lib/whiteboard/upload";

// 2 段階ピッカー（白板を選ぶ → 全体または枠を選ぶ）。
// ノート埋め込み（mode="embed"）と、スライドへの静止画スナップショット挿入（mode="snapshot"）で共用する。

export type WhiteboardFramePickerProps =
  | {
      mode: "embed";
      initialPageId?: string;
      initialFrameId?: string;
      pages?: WhiteboardPickerPage[];
      onPickEmbed: (choice: { pageId: string; frameId: string }) => void;
      onClose: () => void;
    }
  | {
      mode: "snapshot";
      initialPageId?: string;
      initialFrameId?: string;
      pages?: WhiteboardPickerPage[];
      onPickSnapshot: (frame: WhiteboardFrame) => void;
      onClose: () => void;
    };

type LoadedBoard = {
  id: string;
  title: string;
  icon: string | null;
  version: number;
  data: unknown;
  frames: WhiteboardFrameInfo[];
  hasContent: boolean;
};

type BoardItem = { id: string; title: string; icon: string | null; updatedAt?: string };

function filterWhiteboards(list: WhiteboardPickerPage[] | undefined): BoardItem[] {
  if (!list) return [];
  return list
    .filter((page) => page.kind === "whiteboard")
    .map((page) => ({ id: page.id, title: page.title, icon: page.icon, updatedAt: page.updatedAt }));
}

export default function WhiteboardFramePicker(props: WhiteboardFramePickerProps) {
  const { mode, initialPageId, initialFrameId = "", pages, onClose } = props;
  const t = useT();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openRef = useRef(true);

  const initialBoards = useMemo(() => filterWhiteboards(pages), [pages]);
  const [boards, setBoards] = useState<BoardItem[] | null>(() => (pages ? initialBoards : null));
  const [listError, setListError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialPageId?.trim() || null);
  const [loaded, setLoaded] = useState<LoadedBoard | null>(null);
  const [boardErrorState, setBoardErrorState] = useState<{ id: string; message: string } | null>(null);
  const [capturingKey, setCapturingKey] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState("");
  const activeLoaded = selectedId && loaded?.id === selectedId ? loaded : null;
  const boardError = selectedId && boardErrorState?.id === selectedId ? boardErrorState.message : "";
  const boardLoading = Boolean(selectedId && !activeLoaded && !boardError);

  const selectBoard = (nextId: string | null) => {
    setSelectedId(nextId);
    setCaptureError("");
    setBoardErrorState(null);
  };

  useEffect(() => {
    openRef.current = true;
    const el = dialogRef.current;
    if (el && !el.open) el.showModal();
    return () => { openRef.current = false; };
  }, []);

  // スマホの戻るキーでピッカーだけを閉じる（アップロード中は閉じない）。
  useBackToClose(true, () => (capturingKey ? false : onClose()));

  // 最新の一覧を取得する（/note-embed や新しく作った白板も確実に並ぶ）。
  useEffect(() => {
    let cancelled = false;
    fetch("/api/pages", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as { pages?: WhiteboardPickerPage[]; error?: string } | null;
        if (!response.ok) throw new Error(data?.error || t("Could not load whiteboards."));
        if (cancelled) return;
        const next = filterWhiteboards(data?.pages ?? []);
        setBoards(next);
        setListError("");
        // 既存の埋め込み元がすでにゴミ箱・削除済みなら、一覧画面へ戻す。
        setSelectedId((current) => (current && !next.some((item) => item.id === current) ? null : current));
      })
      .catch((caught) => {
        if (cancelled) return;
        if (!boards) setBoards([]);
        setListError(caught instanceof Error ? caught.message : t("Could not load whiteboards."));
      });
    return () => { cancelled = true; };
    // 初回マウント時だけ一覧を読む（親の pages は初期値として使う）。
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 選んだ白板の本体と枠一覧を取得する。
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    fetch(`/api/pages/${encodeURIComponent(selectedId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as { page?: { id: string; kind?: string; title: string; icon: string | null; version: number; data?: unknown }; error?: string } | null;
        if (!response.ok || !data?.page || data.page.kind !== "whiteboard") {
          throw new Error(data?.error || t("This whiteboard is no longer available."));
        }
        if (cancelled) return;
        const scene = toRenderableScene(data.page.data, { fileUrlMode: "owner" });
        setBoardErrorState(null);
        setLoaded({
          id: data.page.id,
          title: data.page.title,
          icon: data.page.icon ?? null,
          version: typeof data.page.version === "number" ? data.page.version : 0,
          data: data.page.data ?? { elements: [] },
          frames: listWhiteboardFrames(data.page.data),
          hasContent: scene.elements.length > 0,
        });
      })
      .catch((caught) => {
        if (!cancelled) {
          setBoardErrorState({
            id: selectedId,
            message: caught instanceof Error ? caught.message : t("This whiteboard is no longer available."),
          });
        }
      });
    return () => { cancelled = true; };
  }, [selectedId, t]);

  const filteredBoards = useMemo(() => {
    const list = boards ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((board) => (board.title.trim() || t("Untitled")).toLowerCase().includes(q));
  }, [boards, query, t]);

  const selectedSummary = useMemo(
    () => (selectedId ? boards?.find((item) => item.id === selectedId) ?? null : null),
    [boards, selectedId],
  );

  async function pickChoice(frame: WhiteboardFrameInfo | null, index: number) {
    if (!activeLoaded || capturingKey) return;
    const frameId = frame ? frame.id : "";
    if (mode === "embed") {
      props.onPickEmbed({ pageId: activeLoaded.id, frameId });
      onClose();
      return;
    }
    const key = frameId || "__whole__";
    setCapturingKey(key);
    setCaptureError("");
    try {
      const snapshot = await renderWhiteboardSnapshot(activeLoaded.data, { frameId: frameId || null });
      if (!openRef.current) return;
      if (!snapshot.ok) {
        setCaptureError(
          snapshot.reason === "missing-frame"
            ? t("This frame is no longer on the whiteboard.")
            : snapshot.reason === "empty"
              ? t("This whiteboard is empty.")
              : t("Could not capture the whiteboard."),
        );
        return;
      }
      const fallbackTitle = activeLoaded.title.trim() || t("Untitled");
      const frameName = frame
        ? (snapshot.frameName || frame.name || t("Frame {number}", { number: index + 1 }))
        : fallbackTitle;
      const uploaded = await uploadImageBlob(snapshot.blob, frameId ? `whiteboard-frame-${frameId.slice(0, 12)}` : `whiteboard-${activeLoaded.id.slice(0, 12)}`);
      if (!openRef.current) return;
      props.onPickSnapshot({
        pageId: activeLoaded.id,
        frameId,
        frameName,
        boardTitle: activeLoaded.title,
        src: uploaded.url,
        width: snapshot.width,
        height: snapshot.height,
        sourceVersion: activeLoaded.version,
      });
      onClose();
    } catch (caught) {
      if (!openRef.current) return;
      if (caught instanceof StorageLimitError) {
        onClose();
        return;
      }
      setCaptureError(caught instanceof Error ? caught.message : t("Upload failed. Try again."));
    } finally {
      if (openRef.current) setCapturingKey(null);
    }
  }

  const dialogTitle = mode === "snapshot" ? t("Insert whiteboard frame") : t("Embed whiteboard");
  const currentTitle = activeLoaded?.title.trim() || selectedSummary?.title.trim() || t("Untitled");

  return (
    <dialog
      ref={dialogRef}
      className="notes-dialog whiteboard-picker-dialog"
      aria-label={dialogTitle}
      onCancel={(event) => {
        event.preventDefault();
        if (!capturingKey) onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current && !capturingKey) onClose();
      }}
    >
      <div className="whiteboard-picker-head">
        {selectedId ? (
          <button
            type="button"
            className="whiteboard-picker-back"
            disabled={Boolean(capturingKey)}
            onClick={() => selectBoard(null)}
            aria-label={t("All whiteboards")}
            title={t("All whiteboards")}
          >
            <ArrowLeft size={16} className="rtl-mirror" aria-hidden="true" />
          </button>
        ) : (
          <span className="whiteboard-picker-head-icon" aria-hidden="true">
            <Shapes size={18} />
          </span>
        )}
        <div className="whiteboard-picker-head-text">
          <h2>{selectedId ? currentTitle : dialogTitle}</h2>
          <p>{selectedId ? t("Choose the whole whiteboard or a frame") : t("Choose a whiteboard")}</p>
        </div>
        <button
          type="button"
          className="whiteboard-picker-close"
          disabled={Boolean(capturingKey)}
          onClick={onClose}
          aria-label={t("Close")}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {!selectedId ? (
        <div className="whiteboard-picker-step">
          <label className="whiteboard-picker-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder={t("Search whiteboards…")}
              aria-label={t("Search whiteboards…")}
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {listError && <p role="alert" className="whiteboard-picker-error">{localizeSystemText(listError, t)}</p>}
          {boards === null ? (
            <p className="whiteboard-picker-empty">
              <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
              <span>{t("Loading…")}</span>
            </p>
          ) : !boards.length ? (
            <p className="whiteboard-picker-empty">{t("No whiteboards yet.")}</p>
          ) : !filteredBoards.length ? (
            <p className="whiteboard-picker-empty">{t("No results")}</p>
          ) : (
            <ul className="whiteboard-picker-list">
              {filteredBoards.map((board) => {
                const isCurrent = initialPageId === board.id;
                return (
                  <li key={board.id}>
                    <button
                      type="button"
                      className={`whiteboard-picker-board${isCurrent ? " is-selected" : ""}`}
                      onClick={() => selectBoard(board.id)}
                    >
                      <span className="whiteboard-picker-board-icon" aria-hidden="true">
                        <NoteIcon icon={board.icon} fallback={<PageKindIcon kind="whiteboard" size={16} />} />
                      </span>
                      <span className="whiteboard-picker-board-title">{board.title.trim() || t("Untitled")}</span>
                      {isCurrent && <Check size={15} className="whiteboard-picker-check" aria-hidden="true" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        <div className="whiteboard-picker-step">
          {boardError && <p role="alert" className="whiteboard-picker-error">{localizeSystemText(boardError, t)}</p>}
          {captureError && <p role="alert" className="whiteboard-picker-error">{localizeSystemText(captureError, t)}</p>}
          {boardLoading ? (
            <p className="whiteboard-picker-empty">
              <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
              <span>{t("Loading whiteboard…")}</span>
            </p>
          ) : activeLoaded ? (
            <div className="whiteboard-picker-grid">
              <button
                type="button"
                className={`whiteboard-picker-card${initialPageId === activeLoaded.id && !initialFrameId ? " is-selected" : ""}`}
                disabled={Boolean(capturingKey) || (mode === "snapshot" && !activeLoaded.hasContent)}
                onClick={() => void pickChoice(null, -1)}
              >
                <div className="whiteboard-picker-thumb">
                  <WhiteboardThumbnail data={activeLoaded.data} padding={12} ariaLabel={t("Whole whiteboard")} />
                  {capturingKey === "__whole__" && (
                    <span className="whiteboard-picker-busy">
                      <LoaderCircle size={20} className="animate-spin" aria-hidden="true" />
                    </span>
                  )}
                </div>
                <span className="whiteboard-picker-card-label">
                  <Shapes size={14} aria-hidden="true" />
                  <span className="truncate">{t("Whole whiteboard")}</span>
                </span>
              </button>

              {activeLoaded.frames.map((frame, index) => {
                const label = frame.name || t("Frame {number}", { number: index + 1 });
                const isCurrent = initialPageId === activeLoaded.id && initialFrameId === frame.id;
                return (
                  <button
                    key={frame.id}
                    type="button"
                    className={`whiteboard-picker-card${isCurrent ? " is-selected" : ""}`}
                    disabled={Boolean(capturingKey)}
                    onClick={() => void pickChoice(frame, index)}
                  >
                    <div className="whiteboard-picker-thumb">
                      <WhiteboardThumbnail data={activeLoaded.data} frameId={frame.id} ariaLabel={label} />
                      {capturingKey === frame.id && (
                        <span className="whiteboard-picker-busy">
                          <LoaderCircle size={20} className="animate-spin" aria-hidden="true" />
                        </span>
                      )}
                    </div>
                    <span className="whiteboard-picker-card-label">
                      <Frame size={14} aria-hidden="true" />
                      <span className="truncate">{label}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      )}

      <div className="whiteboard-picker-foot">
        <button type="button" className="notion-button" disabled={Boolean(capturingKey)} onClick={onClose}>
          {t("Cancel")}
        </button>
      </div>
    </dialog>
  );
}
