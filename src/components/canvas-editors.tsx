"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import { useT } from "@/components/i18n-provider";
import type { CanvasData } from "@/lib/canvas-document";
import type { CanvasKind } from "@/lib/page-kinds";
import type { NoteSaveStatus } from "@/types/notes";

// ホワイトボード・スライドのエディターが受け取るもの（docs/architecture/notes-flow.md の「页面类型」）。
// 保存は NotesWorkspace が持つ保存キュー（ノートと同じ NoteSaveQueue）がする。エディターは変わった本体を onChange で渡すだけ。
// 履歴の復元・チャットからの更新・「最新版を読み込む」のときは、NotesWorkspace が key を替えて作り直す（data が新しい本体になる）。
export type CanvasEditorProps = {
  pageId: string;
  kind: CanvasKind;
  title: string;
  icon: string | null;
  // 開いた時点の本体（保存キューが持つ最新の内容）。
  data: CanvasData;
  // 保存済みの版（保存のたびに進む）。0 は作ってから一度も保存していないページ。
  version: number;
  // ロック中・作成や削除の途中は false（見る・放映する・書き出すだけ）。
  editable: boolean;
  // Android / iOS アプリの WebView（/note-embed）。上部バーとメニューはアプリが描く。
  embedded: boolean;
  // デスクトップの分割表示（チャットと並べた狭い枠）。
  split: boolean;
  saveStatus: NoteSaveStatus;
  onChange: (data: CanvasData) => void;
  onTitleChange: (title: string) => void;
};

// 種類ごとのエディター。PAGE_KIND_FEATURES[kind].editor が true で、ここに登録があるときだけ使う（無ければ読み取り専用の仮の画面）。
// エディターは大きいので、それぞれ next/dynamic で開いたときに読み込む。
function EditorLoading() {
  const t = useT();
  return <p className="notes-loading canvas-editor-loading">{t("Loading editor…")}</p>;
}

export const CANVAS_EDITORS: Partial<Record<CanvasKind, ComponentType<CanvasEditorProps>>> = {
  slides: dynamic(() => import("@/components/slides/slides-editor"), { ssr: false, loading: () => <EditorLoading /> }),
};
