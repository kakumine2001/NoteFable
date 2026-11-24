"use client";

import type { CanvasEditorProps } from "@/components/canvas-editors";
import type { CanvasData } from "@/lib/canvas-document";
import WhiteboardEditor from "@/components/whiteboard/whiteboard-editor";

// ノート画面（NotesWorkspace → CANVAS_EDITORS）から開くホワイトボード。保存・保存の失敗や衝突の案内は NotesWorkspace が持つ。
const noop = () => {};

export default function WhiteboardCanvas(props: CanvasEditorProps) {
  return <WhiteboardEditor pageId={props.pageId} data={props.data} editable={props.editable} embedded={props.embedded}
    onChange={(data) => props.onChange(data as unknown as CanvasData)} onOpenPage={props.onOpenPage} pages={props.pages}
    title={props.title} icon={props.icon} onTitleChange={props.onTitleChange} onIconChange={props.onIconChange ?? noop}
    aiSlot={props.aiSlot} />;
}
