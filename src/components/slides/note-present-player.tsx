"use client";

import "@/components/slides/slides.css";
import { Loader2, Presentation } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/components/i18n-provider";
import { SlidePlayer, type PlayerControl } from "@/components/slides/slide-player";
import { SlideRenderRoot } from "@/components/slides/slide-render";
import { MAX_SLIDES, type CanvasData } from "@/lib/canvas-document";
import { newPageBody } from "@/lib/canvas-save";
import { localizeSystemText, msg } from "@/lib/i18n/translate";
import { nativeCanOpenPage, nativeCanPresent, postToNative } from "@/lib/native-bridge";
import { MAX_NOTE_TITLE } from "@/lib/note-document";
import { SLIDES_EVENTS } from "@/lib/slides/ai-context";
import { noteToDeckResult } from "@/lib/slides/note-to-deck";
import { resolveTheme } from "@/lib/slides/themes";
import type { NotePage } from "@/types/notes";

function documentThemeMode(): "light" | "dark" {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export type NotePresentPlayerProps = {
  title: string;
  icon: string | null;
  blocks: unknown;
  parentId: string | null;
  groupId: string | null;
  embedded: boolean;
  onExit: () => void;
  onSaved: (pageId: string) => void;
};

// ノートをその場でスライド形式に変換して放映する。放映だけでは DB に書かず、「スライドとして保存」で初めてページを作る。
export default function NotePresentPlayer({
  title, icon, blocks, parentId, groupId, embedded, onExit, onSaved,
}: NotePresentPlayerProps) {
  const t = useT();
  // 放映中の裏同期や編集通知でページ構成が急に変わらないよう、開始時のスナップショットを固定する。
  const [{ deck, totalSlides, truncatedSlides }] = useState(() => noteToDeckResult({
    title,
    blocks,
    theme: { id: "simple", mode: documentThemeMode() },
    labels: { untitled: t("Untitled"), file: t("File"), image: t("Image") },
  }));
  const theme = useMemo(() => resolveTheme(deck.theme), [deck.theme]);
  const playerControl = useRef<PlayerControl | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const nativeEndedRef = useRef(false);

  const endNativePresentation = useCallback(() => {
    if (!embedded || nativeEndedRef.current) return;
    nativeEndedRef.current = true;
    if (nativeCanPresent()) {
      postToNative({ type: "presentation", state: "end", index: 0, count: deck.slides.length });
    }
  }, [deck.slides.length, embedded]);

  useEffect(() => {
    mountedRef.current = true;
    nativeEndedRef.current = false;
    if (embedded && nativeCanPresent()) {
      postToNative({ type: "presentation", state: "start", index: 0, count: deck.slides.length });
    }
    return () => {
      mountedRef.current = false;
      endNativePresentation();
    };
  }, [deck.slides.length, embedded, endNativePresentation]);

  useEffect(() => {
    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string; index?: number }>).detail;
      if (!detail) return;
      if (detail.action === "end") playerControl.current?.end();
      else if (detail.action === "next") playerControl.current?.next();
      else if (detail.action === "previous") playerControl.current?.previous();
      else if (detail.action === "goto" && typeof detail.index === "number") playerControl.current?.goTo(detail.index + 1);
    };
    window.addEventListener(SLIDES_EVENTS.command, onCommand);
    return () => window.removeEventListener(SLIDES_EVENTS.command, onCommand);
  }, []);

  const handleSlideChange = useCallback((_slide: unknown, index: number, count: number) => {
    if (embedded && nativeCanPresent() && !nativeEndedRef.current) {
      postToNative({ type: "presentation", state: "slide", index, count });
    }
  }, [embedded]);

  const handleSaveAsDeck = useCallback(async () => {
    if (savingRef.current) return;
    if (
      truncatedSlides > 0
      && typeof window !== "undefined"
      && !window.confirm(t("This note exceeds the {max}-slide limit. Save only the first {max} slides?", { max: MAX_SLIDES }))
    ) {
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    try {
      const cleanTitle = (title.trim() || "Untitled").slice(0, MAX_NOTE_TITLE);
      const body = newPageBody(
        "slides",
        {
          title: cleanTitle,
          icon,
          cover: null,
          coverPosition: null,
          blocks: [],
          data: deck as unknown as CanvasData,
        },
        parentId,
        parentId ? null : groupId,
      );
      const response = await fetch("/api/pages", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({})) as { page?: NotePage; error?: unknown };
      if (!response.ok || !data.page?.id) {
        const message = typeof data.error === "string" && data.error.trim()
          ? localizeSystemText(data.error, t)
          : t(msg("Could not save as slide deck."));
        if (mountedRef.current) setSaveError(message);
        return;
      }
      window.dispatchEvent(new CustomEvent<NotePage>("notefable:page-created", { detail: data.page }));
      if (!mountedRef.current) return;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      endNativePresentation();
      if (embedded && nativeCanOpenPage()) {
        onExit();
        postToNative({ type: "openPage", id: data.page.id });
      } else {
        onSaved(data.page.id);
      }
    } catch {
      if (mountedRef.current) setSaveError(t(msg("Could not save as slide deck.")));
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }, [deck, embedded, endNativePresentation, groupId, icon, onExit, onSaved, parentId, t, title, truncatedSlides]);

  const header = (
    <div className={`slides-player-header${saving || saveError || truncatedSlides > 0 ? " is-pinned" : ""}`}>
      {truncatedSlides > 0 && !saveError && (
        <span className="slides-player-notice" role="status">
          {t("Only the first {max} slides are shown ({total} total).", { max: MAX_SLIDES, total: totalSlides })}
        </span>
      )}
      {saveError && <span className="slides-player-error" role="alert">{saveError}</span>}
      <button
        type="button"
        className="slides-player-action"
        disabled={saving}
        onClick={() => void handleSaveAsDeck()}
      >
        {saving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Presentation size={15} aria-hidden="true" />}
        <span>{saving ? t("Saving…") : t("Save as slide deck")}</span>
      </button>
    </div>
  );

  return (
    <SlideRenderRoot theme={theme} mode="view">
      <SlidePlayer
        deck={deck}
        startId={deck.slides[0]?.id ?? null}
        allowPresenter={false}
        fullscreen={!embedded && !nativeCanPresent()}
        controlRef={playerControl}
        onChange={handleSlideChange}
        onExit={onExit}
        header={header}
      />
    </SlideRenderRoot>
  );
}
