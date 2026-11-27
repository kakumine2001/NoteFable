"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/i18n-provider";
import { useTheme } from "@/lib/theme";
import type { WhiteboardFileUrlMode } from "@/lib/whiteboard/frames";
import { renderWhiteboardSvg } from "@/lib/whiteboard/render-frame";

// 保存済みのホワイトボード（全体または 1 つの枠）を、エディターを開かずに絵として見せる。
// Excalidraw は開いた時だけ読む（呼び出し側が next/dynamic で読む）。

export type WhiteboardThumbnailProps = {
  data: unknown;
  frameId?: string | null;
  fileUrlMode?: WhiteboardFileUrlMode;
  padding?: number;
  canvasBackgroundColor?: string | false;
  ariaLabel?: string;
  loadingLabel?: string;
  emptyLabel?: string;
  missingFrameLabel?: string;
  errorLabel?: string;
  className?: string;
  onStatusChange?: (status: "loading" | "ready" | "empty" | "missing-frame" | "error") => void;
};

export default function WhiteboardThumbnail({
  data,
  frameId = null,
  fileUrlMode = "owner",
  padding,
  canvasBackgroundColor = false,
  ariaLabel,
  loadingLabel,
  emptyLabel,
  missingFrameLabel,
  errorLabel,
  className = "",
  onStatusChange,
}: WhiteboardThumbnailProps) {
  const t = useT();
  const { resolved: theme } = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "missing-frame" | "error">("loading");
  const statusCallbackRef = useRef(onStatusChange);
  useEffect(() => { statusCallbackRef.current = onStatusChange; }, [onStatusChange]);

  const resolvedAriaLabel = ariaLabel ?? t("Whiteboard preview");

  useEffect(() => {
    let cancelled = false;
    const report = (next: "loading" | "ready" | "empty" | "missing-frame" | "error") => {
      if (cancelled) return;
      setState(next);
      statusCallbackRef.current?.(next);
    };
    // 別の版・別の枠に切り替えたとき、前の絵を残さない。
    ref.current?.replaceChildren();
    queueMicrotask(() => report("loading"));
    renderWhiteboardSvg(data, {
      frameId,
      theme,
      fileUrlMode,
      padding,
      canvasBackgroundColor,
      ariaLabel: resolvedAriaLabel,
    }).then((result) => {
      const host = ref.current;
      if (cancelled || !host) return;
      if (result.status === "ready") {
        host.replaceChildren(result.svg);
        report("ready");
      } else {
        report(result.status);
      }
    }).catch(() => report("error"));
    return () => { cancelled = true; };
  }, [data, frameId, fileUrlMode, padding, canvasBackgroundColor, theme, resolvedAriaLabel]);

  return (
    <div className={`whiteboard-thumbnail${className ? ` ${className}` : ""}`} data-state={state}>
      <div ref={ref} className="whiteboard-thumbnail-image" />
      {state === "loading" && <p className="notes-loading">{loadingLabel ?? t("Loading whiteboard…")}</p>}
      {state === "empty" && <p className="canvas-placeholder-empty">{emptyLabel ?? t("This whiteboard is empty.")}</p>}
      {state === "missing-frame" && <p className="canvas-placeholder-empty">{missingFrameLabel ?? t("This frame is no longer on the whiteboard.")}</p>}
      {state === "error" && <p className="canvas-placeholder-empty">{errorLabel ?? t("Could not show this version.")}</p>}
    </div>
  );
}
