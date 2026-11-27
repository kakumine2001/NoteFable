import type { ReactNode } from "react";

// ホワイトボード（#152）の 1 つの枠を、スライドに静止画として置くための接続点。
// ホワイトボードの側が registerWhiteboardFrameProvider で「枠を選んで画像にする」部品を登録すると、
// スライドのツールバーに「ホワイトボードの枠」のボタンが出る（開いているエディターにも、登録した時点で出る）。登録が無いあいだはボタンを出さない。
// 選んだ枠の画像は、ホワイトボード側が note-files にアップロードしてから onPick に渡す（src は /api/pages/files?key=… の URL）。

export type WhiteboardFrame = {
  pageId: string;
  frameId: string;
  frameName: string;
  boardTitle?: string;
  src: string;
  width: number;
  height: number;
  sourceVersion?: number;
};

export type WhiteboardPickerPage = {
  id: string;
  kind?: string;
  title: string;
  icon: string | null;
  updatedAt?: string;
  version?: number;
};

export type WhiteboardFramePickerProps = {
  initialPageId?: string;
  initialFrameId?: string;
  pages?: WhiteboardPickerPage[];
  onPick: (frame: WhiteboardFrame) => void;
  onClose: () => void;
};

export type WhiteboardFrameRefreshResult =
  | { ok: true; frame: WhiteboardFrame }
  | { ok: false; reason: "not-found" | "empty" | "missing-frame" | "storage-limit" | "error"; message?: string };

export type WhiteboardFrameProvider = {
  renderPicker: (props: WhiteboardFramePickerProps) => ReactNode;
  refreshFrame?: (target: { pageId: string; frameId: string }) => Promise<WhiteboardFrameRefreshResult>;
};

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

export async function refreshWhiteboardFrame(target: { pageId: string; frameId: string }): Promise<WhiteboardFrameRefreshResult> {
  if (!provider?.refreshFrame) return { ok: false, reason: "error" };
  return provider.refreshFrame(target);
}
