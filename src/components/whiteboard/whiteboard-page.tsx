"use client";

import { RefreshCw } from "lucide-react";
import dynamic from "next/dynamic";
import type { Ref } from "react";
import { useT } from "@/components/i18n-provider";
import { localizeSystemText } from "@/lib/i18n/translate";
import type { NoteSaveQueue } from "@/lib/note-save-queue";
import type { StoredWhiteboard } from "@/lib/whiteboard/scene";
import type { WhiteboardEditorHandle } from "@/components/whiteboard/whiteboard-editor";
import type { MentionPage } from "@/components/note-mention";

// Excalidraw（約 1 MB）はホワイトボードを開いた時だけ読む。SSR しない（/、/app、/note-embed の静的な生成に影響させない）。
const WhiteboardEditor = dynamic(() => import("@/components/whiteboard/whiteboard-editor"), { ssr: false, loading: () => <WhiteboardLoading /> });

function WhiteboardLoading() {
  const t = useT();
  return <div className="whiteboard-loading"><p className="notes-loading">{t("Loading whiteboard…")}</p></div>;
}

// ノート画面（NotesWorkspace）の中のホワイトボード。保存は NoteSaveQueue（本体は content.data）。保存の失敗・衝突はキャンバスの上に出す。
export function WhiteboardPage({ queue, pageId, epoch, editable, embedded, busy, backupError, pages, onOpenPage, onSaveAsNew, onLoadLatest, handleRef }: {
  queue: NoteSaveQueue;
  pageId: string;
  epoch: number;
  editable: boolean;
  embedded: boolean;
  busy: boolean;
  backupError: string;
  pages?: MentionPage[];
  onOpenPage: (id: string) => boolean;
  onSaveAsNew: () => void;
  onLoadLatest: () => void;
  handleRef?: Ref<WhiteboardEditorHandle>;
}) {
  const t = useT();
  const content = queue.content;
  return <div className="whiteboard-page">
    <WhiteboardEditor key={`${pageId}:${epoch}`} pageId={pageId} data={content.data} editable={editable} embedded={embedded} pages={pages}
      onChange={(data: StoredWhiteboard) => queue.edit({ ...queue.content, data })}
      onOpenPage={onOpenPage}
      title={content.title} icon={content.icon}
      onTitleChange={(title) => queue.edit({ ...queue.content, title })}
      onIconChange={(icon) => queue.edit({ ...queue.content, icon })}
      handleRef={handleRef} />
    {(backupError || queue.error) && <div className="whiteboard-save-alert" role="alert">
      {backupError && <p>{t(backupError)}</p>}
      {queue.error && <>
        <p>{localizeSystemText(queue.error, t)}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {queue.status === "conflict" ? <>
            <button type="button" className="notion-button" disabled={busy} onClick={onSaveAsNew}>{t("Save as new whiteboard")}</button>
            <button type="button" className="notion-button" onClick={() => { if (window.confirm(t("Discard this unsaved draft and load the latest version?"))) onLoadLatest(); }}>{t("Load latest")}</button>
          </> : <button type="button" className="notion-button inline-flex items-center gap-2" onClick={() => void queue.flush()}><RefreshCw size={13} />{t("Retry save")}</button>}
        </div>
      </>}
    </div>}
  </div>;
}
