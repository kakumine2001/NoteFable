"use client";

import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import "@excalidraw/excalidraw/index.css";
import "./whiteboard.css";
import type { Locale, TextDirection } from "@/lib/i18n/locale";
import { sharePagePath } from "@/lib/note-share";
import { useTheme } from "@/lib/theme";
import { pageIdFromLink } from "@/lib/whiteboard/links";
import type { StoredWhiteboard } from "@/lib/whiteboard/scene";
import { excalidrawLang, useKeepDocumentLanguage } from "@/components/whiteboard/excalidraw-locale";

// 公開リンク（/s/:token）のホワイトボード：拡大縮小・移動だけができる読み取り専用のビュー。
// 文言は公開ページ（サーバー）が訳して渡す（公開ページには I18nProvider が無い）。
if (typeof window !== "undefined") (window as unknown as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = "/whiteboard/";

export type PublicWhiteboardLabels = { zoomIn: string; zoomOut: string; fit: string; loading: string; failed: string; empty: string };

export default function PublicWhiteboardCanvas({ token, pageId, locale, dir, labels }: {
  token: string; pageId: string; locale: Locale; dir: TextDirection; labels: PublicWhiteboardLabels;
}) {
  const { resolved: theme } = useTheme();
  const [scene, setScene] = useState<StoredWhiteboard | null>(null);
  const [failed, setFailed] = useState(false);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [zoom, setZoom] = useState(1);
  useKeepDocumentLanguage(locale, dir);

  useEffect(() => {
    let cancelled = false;
    fetch(`/s/${encodeURIComponent(token)}/scene?page=${encodeURIComponent(pageId)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
      .then((data: { scene?: StoredWhiteboard }) => { if (!cancelled) setScene(data.scene ?? { elements: [] }); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [token, pageId]);

  useEffect(() => {
    if (!api) return;
    return api.onScrollChange((_x, _y, value) => setZoom(value.value));
  }, [api]);

  const fit = useCallback(() => {
    const elements = api?.getSceneElements();
    if (api && elements?.length) api.setViewport({ target: elements, fit: "scale-down", animation: true });
  }, [api]);

  // ページへのリンクは、同じ公開リンクの中のページとして開く（公開されていなければ「表示できません」）。
  const onLinkOpen = useCallback((element: NonDeletedExcalidrawElement, event: CustomEvent<{ nativeEvent: MouseEvent | React.PointerEvent<HTMLCanvasElement> }>) => {
    const id = pageIdFromLink(element.link, window.location.origin);
    if (!id) return;
    event.preventDefault();
    window.location.assign(sharePagePath(token, id));
  }, [token]);

  const zoomBy = (factor: number) => {
    if (!api) return;
    const state = api.getAppState();
    const next = Math.min(30, Math.max(0.1, state.zoom.value * factor));
    // 見えている範囲の中心を保ったまま拡大縮小する。
    const centerX = -state.scrollX + state.width / state.zoom.value / 2;
    const centerY = -state.scrollY + state.height / state.zoom.value / 2;
    api.updateScene({ appState: { zoom: { value: next as AppState["zoom"]["value"] }, scrollX: -(centerX - state.width / next / 2), scrollY: -(centerY - state.height / next / 2) } });
  };

  if (failed) return <p className="public-whiteboard-status" role="alert">{labels.failed}</p>;
  if (!scene) return <p className="public-whiteboard-status">{labels.loading}</p>;
  return <div className="whiteboard is-readonly public-whiteboard" data-theme={theme}>
    <Excalidraw
      onExcalidrawAPI={setApi}
      initialData={{ elements: scene.elements as unknown as ExcalidrawElement[], files: (scene.files ?? {}) as unknown as BinaryFiles, appState: scene.appState as Partial<AppState>, scrollToContent: true }}
      ui={false}
      viewModeEnabled
      theme={theme}
      langCode={excalidrawLang(locale)}
      onLinkOpen={onLinkOpen}
    />
    {!scene.elements.length && <p className="public-whiteboard-empty">{labels.empty}</p>}
    <div className="whiteboard-zoombar public-whiteboard-zoom">
      <div className="whiteboard-group">
        <button type="button" className="whiteboard-tool" aria-label={labels.zoomOut} title={labels.zoomOut} onClick={() => zoomBy(1 / 1.25)}><ZoomOut size={17} /></button>
        <span className="whiteboard-zoom-value" aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" className="whiteboard-tool" aria-label={labels.zoomIn} title={labels.zoomIn} onClick={() => zoomBy(1.25)}><ZoomIn size={17} /></button>
        <button type="button" className="whiteboard-tool" aria-label={labels.fit} title={labels.fit} onClick={fit}><Maximize size={16} /></button>
      </div>
    </div>
  </div>;
}
