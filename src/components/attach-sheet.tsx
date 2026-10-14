"use client";

import { Check, ImagePlus, Paperclip } from "lucide-react";
import { type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { useBackToClose } from "@/lib/use-back-to-close";
import { useSwipeDismiss } from "@/lib/use-swipe-dismiss";

// スマホで「＋」を押したときに画面下から出るシート。ファイルを足すか、画像を作るモードに切り替えるかを選ぶ。
// 画像作成の行は、選んでいるチャットモデルに関係なく常に出す（画像生成は OpenAI の画像 API を直接呼ぶ）。
export function AttachSheet({
  open,
  onClose,
  onFilesChange,
  imageMode,
  onToggleImageMode,
}: {
  open: boolean;
  onClose: () => void;
  onFilesChange: (event: ChangeEvent<HTMLInputElement>) => void;
  imageMode: boolean;
  onToggleImageMode: () => void;
}) {
  useBackToClose(open, onClose);
  const { attach, bind } = useSwipeDismiss<HTMLDivElement>({ axis: "y", direction: 1, onDismiss: onClose, focusOnAttach: true });

  if (!open) return null;

  return createPortal(
    <div className="model-sheet-root">
      <button type="button" className="model-sheet-backdrop" aria-label="Close" onClick={onClose} />
      <div className="model-sheet" role="dialog" aria-modal="true" aria-label="Add" tabIndex={-1}
        ref={attach}>
        <div className="sheet-grip" {...bind}><div className="model-sheet-grab" aria-hidden="true" /></div>

        <label className="attach-row">
          <Paperclip size={22} />
          <span>
            <strong>Add files or photos</strong>
            <small>Photos, PDFs and text files</small>
          </span>
          <input
            type="file"
            multiple
            className="sr-only"
            onChange={(event) => {
              onFilesChange(event);
              onClose();
            }}
          />
        </label>

        <button
          type="button"
          className="attach-row"
          aria-pressed={imageMode}
          onClick={() => {
            onToggleImageMode();
            onClose();
          }}
        >
          <ImagePlus size={22} />
          <span>
            <strong>Create an image</strong>
            <small>{imageMode ? "On — your next message creates an image" : "Describe it and it is drawn for you"}</small>
          </span>
          {imageMode && <Check size={20} />}
        </button>
      </div>
    </div>,
    document.body,
  );
}
