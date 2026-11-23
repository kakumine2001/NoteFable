"use client";

import { exportScene } from "@excalidraw/excalidraw";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import type { NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/i18n-provider";
import { useTheme } from "@/lib/theme";
import { storedToScene } from "@/lib/whiteboard/scene";

// ホワイトボードの 1 つの版を、絵として見せる（編集履歴のプレビュー）。Excalidraw は開いた時だけ読む（呼び出し側が next/dynamic で読む）。
if (typeof window !== "undefined") (window as unknown as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = "/whiteboard/";

export default function WhiteboardThumbnail({ data }: { data: unknown }) {
  const t = useT();
  const { resolved: theme } = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  useEffect(() => {
    let cancelled = false;
    const scene = storedToScene(data);
    if (!scene.elements.length) { queueMicrotask(() => setState("empty")); return; }
    exportScene({
      type: "svg",
      data: {
        elements: scene.elements as unknown as NonDeletedExcalidrawElement[],
        files: scene.files as unknown as BinaryFiles,
        appState: { viewBackgroundColor: scene.appState.viewBackgroundColor ?? "#ffffff" },
      } as never,
      config: { padding: 16, theme, canvasBackgroundColor: false },
    }).then((svg) => {
      const host = ref.current;
      if (cancelled || !host) return;
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", t("Whiteboard preview"));
      host.replaceChildren(svg);
      setState("ready");
    }).catch(() => { if (!cancelled) setState("error"); });
    return () => { cancelled = true; };
  }, [data, theme, t]);
  return <div className="whiteboard-thumbnail" data-state={state}>
    <div ref={ref} className="whiteboard-thumbnail-image" />
    {state === "loading" && <p className="notes-loading">{t("Loading whiteboard…")}</p>}
    {state === "empty" && <p className="canvas-placeholder-empty">{t("This whiteboard is empty.")}</p>}
    {state === "error" && <p className="canvas-placeholder-empty">{t("Could not show this version.")}</p>}
  </div>;
}
