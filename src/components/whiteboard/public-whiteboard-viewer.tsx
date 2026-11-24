"use client";

import dynamic from "next/dynamic";
import type { PublicWhiteboardLabels } from "@/components/whiteboard/public-whiteboard-canvas";
import type { Locale, TextDirection } from "@/lib/i18n/locale";

// 公開ページのホワイトボード。Excalidraw は開いた時だけ読む（SSR しない）。
const PublicWhiteboardCanvas = dynamic(() => import("@/components/whiteboard/public-whiteboard-canvas"), { ssr: false });

export function PublicWhiteboardViewer(props: { token: string; pageId: string; locale: Locale; dir: TextDirection; labels: PublicWhiteboardLabels }) {
  return <div className="public-whiteboard-frame"><PublicWhiteboardCanvas {...props} /></div>;
}
