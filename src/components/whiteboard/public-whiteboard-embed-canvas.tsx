"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/theme";
import { listWhiteboardFrames } from "@/lib/whiteboard/frames";
import { renderWhiteboardSvg } from "@/lib/whiteboard/render-frame";
import type { StoredWhiteboard } from "@/lib/whiteboard/scene";

export type PublicWhiteboardEmbedLabels = {
  loading: string;
  empty: string;
  missingFrame: string;
  unavailable: string;
  preview: string;
  untitled: string;
  frameFallback: string;
};

// 同じ公開ノートに同じホワイトボードの複数枠が埋め込まれている場合、/s/:token/scene の取得を 1 回にまとめる。
// 短い TTL でキャッシュし、別のページへ移って戻った時は最新の白板を読み直す。
const SCENE_CACHE_TTL_MS = 5_000;
const sceneCache = new Map<string, { fetchedAt: number; promise: Promise<StoredWhiteboard | null> }>();

function loadPublicScene(token: string, pageId: string, locale: string): Promise<StoredWhiteboard | null> {
  const key = `${token}\0${pageId}\0${locale}`;
  const now = Date.now();
  const cached = sceneCache.get(key);
  if (cached && now - cached.fetchedAt < SCENE_CACHE_TTL_MS) return cached.promise;
  const params = new URLSearchParams({ page: pageId });
  if (locale) params.set("lang", locale);
  const promise = fetch(`/s/${encodeURIComponent(token)}/scene?${params.toString()}`, { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return null;
      const data = await response.json().catch(() => null) as { scene?: StoredWhiteboard } | null;
      return data?.scene ?? { elements: [] };
    })
    .catch(() => null);
  sceneCache.set(key, { fetchedAt: now, promise });
  void promise.then((value) => {
    if (!value && sceneCache.get(key)?.promise === promise) sceneCache.delete(key);
  });
  return promise;
}

export default function PublicWhiteboardEmbedCanvas({
  token,
  pageId,
  frameId,
  locale,
  labels,
  onFrameName,
}: {
  token: string;
  pageId: string;
  frameId: string | null;
  locale: string;
  labels: PublicWhiteboardEmbedLabels;
  onFrameName?: (name: string | null) => void;
}) {
  const { resolved: theme } = useTheme();
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "missing-frame" | "error">("loading");
  const onFrameNameRef = useRef(onFrameName);
  useEffect(() => { onFrameNameRef.current = onFrameName; }, [onFrameName]);

  useEffect(() => {
    let cancelled = false;
    hostRef.current?.replaceChildren();
    queueMicrotask(() => { if (!cancelled) setState("loading"); });

    void loadPublicScene(token, pageId, locale).then(async (scene) => {
      if (cancelled) return;
      if (!scene) {
        setState("error");
        return;
      }
      if (frameId) {
        const frames = listWhiteboardFrames(scene);
        const index = frames.findIndex((item) => item.id === frameId);
        const frame = index >= 0 ? frames[index] : null;
        onFrameNameRef.current?.(
          frame ? (frame.name || labels.frameFallback.replace("{number}", String(index + 1))) : null,
        );
      } else {
        onFrameNameRef.current?.(null);
      }
      const result = await renderWhiteboardSvg(scene, {
        frameId,
        theme,
        // 公開プレビューは /s/:token/file のみ許可し、持ち主の /api/pages/files は決して読まない。
        fileUrlMode: "public",
        canvasBackgroundColor: false,
        ariaLabel: labels.preview,
      });
      const host = hostRef.current;
      if (cancelled || !host) return;
      if (result.status === "ready") {
        host.replaceChildren(result.svg);
        setState("ready");
      } else {
        setState(result.status);
      }
    }).catch(() => {
      if (!cancelled) setState("error");
    });

    return () => { cancelled = true; };
  }, [token, pageId, frameId, locale, theme, labels.preview, labels.frameFallback]);

  return (
    <div className="note-whiteboard-embed-body" data-state={state}>
      <div ref={hostRef} className="note-whiteboard-embed-svg" />
      {state === "loading" && <p className="note-whiteboard-embed-status">{labels.loading}</p>}
      {state === "empty" && <p className="note-whiteboard-embed-status">{labels.empty}</p>}
      {state === "missing-frame" && <p className="note-whiteboard-embed-status">{labels.missingFrame}</p>}
      {state === "error" && <p className="note-whiteboard-embed-status">{labels.unavailable}</p>}
    </div>
  );
}
