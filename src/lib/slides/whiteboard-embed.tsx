import type { ReactNode } from "react";

// ホワイトボード（#152）の 1 つの枠を、スライドに静止画として置くための接続点。
// ホワイトボードの側が registerWhiteboardFrameProvider で「枠を選んで画像にする」部品を登録すると、
// スライドのツールバーに「ホワイトボードの枠」のボタンが出る（開いているエディターにも、登録した時点で出る）。登録が無いあいだはボタンを出さない。
// 選んだ枠の画像は、ホワイトボード側が note-files にアップロードしてから onPick に渡す（src は /api/pages/files?key=… の URL）。

export type WhiteboardFrame = { pageId: string; frameId: string; frameName: string; src: string; width: number; height: number };
export type WhiteboardFramePickerProps = { onPick: (frame: WhiteboardFrame) => void; onClose: () => void };
export type WhiteboardFrameProvider = { renderPicker: (props: WhiteboardFramePickerProps) => ReactNode };

let provider: WhiteboardFrameProvider | null = null;
const listeners = new Set<() => void>();

export function registerWhiteboardFrameProvider(next: WhiteboardFrameProvider | null) {
  provider = next;
  listeners.forEach((listener) => listener());
}

// 登録が変わったら知らせる（useSyncExternalStore 用）。
export function subscribeWhiteboardFrameProvider(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function hasWhiteboardFrameProvider() {
  return provider !== null;
}

export function renderWhiteboardFramePicker(props: WhiteboardFramePickerProps): ReactNode {
  return provider ? provider.renderPicker(props) : null;
}
