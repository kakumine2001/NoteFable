"use client";

import dynamic from "next/dynamic";
import {
  hasWhiteboardFrameProvider,
  registerWhiteboardFrameProvider,
  type WhiteboardFramePickerProps,
  type WhiteboardFrameRefreshResult,
} from "@/lib/slides/whiteboard-embed";
import { StorageLimitError } from "@/lib/usage-plans";
import { listWhiteboardFrames } from "@/lib/whiteboard/frames";

// スライドエディターへホワイトボード側の枠ピッカー・手動刷新プロバイダーを登録する。
// ピッカーとオフスクリーン描画は開いた時・刷新した時だけ動的読み込みするため、スライドの初期バンドルに Excalidraw を含めない。

const DynamicWhiteboardFramePicker = dynamic(
  () => import("@/components/whiteboard/whiteboard-frame-picker"),
  { ssr: false },
);

async function refreshFrame({ pageId, frameId }: { pageId: string; frameId: string }): Promise<WhiteboardFrameRefreshResult> {
  if (!pageId) return { ok: false, reason: "not-found" };
  try {
    const response = await fetch(`/api/pages/${encodeURIComponent(pageId)}`, { cache: "no-store" });
    if (response.status === 404) return { ok: false, reason: "not-found" };
    const payload = await response.json().catch(() => null) as {
      page?: { id: string; kind?: string; title: string; version: number; data?: unknown };
      error?: string;
    } | null;
    if (!response.ok || !payload?.page || payload.page.kind !== "whiteboard") {
      return { ok: false, reason: response.status === 404 ? "not-found" : "error", message: payload?.error };
    }
    const [{ renderWhiteboardSnapshot }, { uploadImageBlob }] = await Promise.all([
      import("@/lib/whiteboard/render-frame"),
      import("@/lib/whiteboard/upload"),
    ]);
    const snapshot = await renderWhiteboardSnapshot(payload.page.data, { frameId: frameId || null });
    if (!snapshot.ok) return { ok: false, reason: snapshot.reason };
    const uploaded = await uploadImageBlob(
      snapshot.blob,
      frameId ? `whiteboard-frame-${frameId.slice(0, 12)}` : `whiteboard-${payload.page.id.slice(0, 12)}`,
    );
    const frameInfo = frameId ? listWhiteboardFrames(payload.page.data).find((item) => item.id === frameId) : null;
    const frameName = frameId
      ? (snapshot.frameName || frameInfo?.name || "")
      : payload.page.title.trim();
    return {
      ok: true,
      frame: {
        pageId: payload.page.id,
        frameId,
        frameName,
        boardTitle: payload.page.title,
        src: uploaded.url,
        width: snapshot.width,
        height: snapshot.height,
        sourceVersion: typeof payload.page.version === "number" ? payload.page.version : 0,
      },
    };
  } catch (caught) {
    if (caught instanceof StorageLimitError) {
      return { ok: false, reason: "storage-limit", message: caught.message };
    }
    return { ok: false, reason: "error", message: caught instanceof Error ? caught.message : undefined };
  }
}

export function ensureWhiteboardSlidesEmbedRegistered() {
  if (hasWhiteboardFrameProvider()) return;
  registerWhiteboardFrameProvider({
    renderPicker: (props: WhiteboardFramePickerProps) => (
      <DynamicWhiteboardFramePicker
        mode="snapshot"
        initialPageId={props.initialPageId}
        initialFrameId={props.initialFrameId}
        pages={props.pages}
        onPickSnapshot={props.onPick}
        onClose={props.onClose}
      />
    ),
    refreshFrame,
  });
}
