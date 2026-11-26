"use client";

import { Info } from "lucide-react";
import { useMemo } from "react";
import { useT } from "@/components/i18n-provider";
import { NoteIcon } from "@/components/note-icon";
import { PageKindIcon } from "@/components/page-kind-icon";
import { extractCanvasSegments } from "@/lib/canvas-document";
import { msg } from "@/lib/i18n/translate";
import type { CanvasKind } from "@/lib/page-kinds";

export const CANVAS_COMING_SOON: Record<CanvasKind, string> = {
  whiteboard: msg("Whiteboard editing is coming soon."),
  slides: msg("Slide deck editing is coming soon."),
};

// ホワイトボード・スライドのエディター（#152・#149）ができるまでの、読み取り専用の仮の画面。
// /app のノート画面・分割表示・/note-embed（古いアプリも含む）で、ノートのエディターの代わりに出す。本文は書き換えない（保存しない）。
// 移動・お気に入り・複製・ゴミ箱・ロック・履歴はいつもの場所（サイドバー・「…」メニュー）から使える。
// 中身は保存された本体から取り出した文字（検索と同じ取り出し方）。スライドはページの番号を付ける。
export function CanvasPagePlaceholder({ kind, title, icon, data }: { kind: CanvasKind; title: string; icon: string | null; data: unknown }) {
  const t = useT();
  const segments = useMemo(() => extractCanvasSegments(kind, data), [kind, data]);
  return (
    <div className="notes-column canvas-placeholder" data-page-kind={kind}>
      <div className="notes-header-inner">
        <div className="notes-icon canvas-placeholder-icon" aria-hidden="true">
          <NoteIcon icon={icon} fallback={<PageKindIcon kind={kind} size={56} strokeWidth={1.4} />} />
        </div>
        <h1 className="notes-title canvas-placeholder-title">{title.trim() && title !== "Untitled" ? title : t("Untitled")}</h1>
      </div>
      <p className="canvas-placeholder-notice" role="status"><Info size={16} aria-hidden="true" />{t(CANVAS_COMING_SOON[kind])}</p>
      <section aria-labelledby="canvas-placeholder-heading">
        <h2 id="canvas-placeholder-heading" className="canvas-placeholder-heading">{t("Text on this page")}</h2>
        {segments.length ? (
          <ol className="canvas-placeholder-text">
            {segments.map((segment, index) => (
              <li key={`${index}:${segment.id}`}>
                {kind === "slides" && <span className="canvas-placeholder-index" aria-hidden="true">{index + 1}</span>}
                <span>{segment.text}</span>
              </li>
            ))}
          </ol>
        ) : <p className="canvas-placeholder-empty">{t("This page has no text yet.")}</p>}
      </section>
    </div>
  );
}
