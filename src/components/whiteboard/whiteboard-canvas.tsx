"use client";

import type { Ref } from "react";
import type { CanvasEditorProps } from "@/components/canvas-editors";
import type { CanvasData } from "@/lib/canvas-document";
import WhiteboardEditor, { type WhiteboardEditorHandle } from "@/components/whiteboard/whiteboard-editor";

// ノート画面（NotesWorkspace → CANVAS_EDITORS）から開くホワイトボード。保存・保存の失敗や衝突の案内は NotesWorkspace が持つ。
const noop = () => {};

export default function WhiteboardCanvas(props: CanvasEditorProps & { handleRef?: Ref<WhiteboardEditorHandle> }) {
  return <WhiteboardEditor pageId={props.pageId} data={props.data} generation={props.generation} editable={props.editable} embedded={props.embedded}
    onChange={(data) => props.onChange(data as unknown as CanvasData)} onOpenPage={props.onOpenPage} pages={props.pages}
    title={props.title} icon={props.icon} onTitleChange={props.onTitleChange} onIconChange={props.onIconChange ?? noop}
    onAskAi={props.onAskAi} onSelectionChange={props.onSelectionChange} handleRef={props.handleRef}
    // AI ボタン（#158 の PageAssistant）の置き場所。右下（スマホでは道具のツールバーが空けた所）に置く。
    aiSlot={props.aiSlot}
    generateImageSignal={props.generateImageSignal}
    onConsumeGenerateImage={props.onConsumeGenerateImage} />;
}
