"use client";

import { ArrowUpRight } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { NoteIcon } from "@/components/note-icon";
import { PageKindIcon } from "@/components/page-kind-icon";
import type { PublicWhiteboardEmbedLabels } from "@/components/whiteboard/public-whiteboard-embed-canvas";
import { noteIconText } from "@/lib/note-icon";

// 公開ノートに埋め込まれた、同じ公開ツリー内のホワイトボード。
// Excalidraw のオフスクリーン描画は埋め込みがある公開ノートだけで遅延読み込みする（SSR しない）。
const PublicWhiteboardEmbedCanvas = dynamic(
  () => import("@/components/whiteboard/public-whiteboard-embed-canvas"),
  { ssr: false },
);

export function PublicWhiteboardEmbed({
  token,
  pageId,
  frameId,
  title,
  icon,
  iconUrl,
  href,
  labels,
}: {
  token: string;
  pageId: string;
  frameId: string | null;
  title: string;
  icon: string | null;
  iconUrl: string | null;
  href: string;
  labels: PublicWhiteboardEmbedLabels;
}) {
  const [frameName, setFrameName] = useState<string | null>(null);
  const displayTitle = title.trim() || labels.untitled;

  return (
    <Link href={href} className="note-whiteboard-embed is-public">
      <div className="note-whiteboard-embed-header">
        <span className="note-whiteboard-embed-icon" aria-hidden="true">
          <NoteIcon icon={noteIconText(icon)} imageUrl={iconUrl} fallback={<PageKindIcon kind="whiteboard" size={15} />} />
        </span>
        <span className="note-whiteboard-embed-title">
          <span className="truncate">{displayTitle}</span>
          {frameName ? (
            <>
              <span className="note-whiteboard-embed-sep" aria-hidden="true">/</span>
              <span className="note-whiteboard-embed-frame truncate">{frameName}</span>
            </>
          ) : null}
        </span>
        <ArrowUpRight size={15} className="note-whiteboard-embed-arrow rtl-mirror" aria-hidden="true" />
      </div>
      <PublicWhiteboardEmbedCanvas
        token={token}
        pageId={pageId}
        frameId={frameId}
        labels={labels}
        onFrameName={setFrameName}
      />
    </Link>
  );
}
