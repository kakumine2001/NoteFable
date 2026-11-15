"use client";

import { Check, FileText, ImagePlus, Paperclip, Plus } from "lucide-react";
import { type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBackToClose } from "@/lib/use-back-to-close";
import { useSwipeDismiss } from "@/lib/use-swipe-dismiss";
import { ATTACHMENT_ACCEPT } from "@/lib/client-files";
import { useT } from "@/components/i18n-provider";

// スマホで「＋」を押したときに画面下から出るシート。ファイルを足すか、自分のノートを添付するか、画像を作るモードに切り替えるかを選ぶ。
// 画像作成の行は、選んでいるチャットモデルに関係なく常に出す（画像生成は OpenAI の画像 API を直接呼ぶ）。
export function AttachSheet({
  open,
  onClose,
  onFilesChange,
  imageMode,
  onToggleImageMode,
  onAttachPages,
}: {
  open: boolean;
  onClose: () => void;
  onFilesChange: (event: ChangeEvent<HTMLInputElement>) => void;
  imageMode: boolean;
  onToggleImageMode: () => void;
  // ノートを選ぶダイアログを開く。シートは先に閉じる。
  onAttachPages: () => void;
}) {
  const t = useT();
  useBackToClose(open, onClose);
  const { attach, bind } = useSwipeDismiss<HTMLDivElement>({ axis: "y", direction: 1, onDismiss: onClose, focusOnAttach: true });

  if (!open) return null;

  return createPortal(
    <div className="model-sheet-root">
      <button type="button" className="model-sheet-backdrop" aria-label={t("Close")} onClick={onClose} />
      <div className="model-sheet" role="dialog" aria-modal="true" aria-label={t("Add")} tabIndex={-1}
        ref={attach}>
        <div className="sheet-grip" {...bind}><div className="model-sheet-grab" aria-hidden="true" /></div>

        <label className="attach-row">
          <Paperclip size={22} />
          <span>
            <strong>{t("Add files or photos")}</strong>
          </span>
          <input
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            aria-label={t("Add files or photos")}
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
          aria-haspopup="dialog"
          onClick={() => {
            onClose();
            onAttachPages();
          }}
        >
          <FileText size={22} />
          <span>
            <strong>{t("Attach pages")}</strong>
            <small>{t("Let the AI read your notes")}</small>
          </span>
        </button>

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
            <strong>{t("Create an image")}</strong>
            <small>{imageMode ? t("On — your next message creates an image") : t("Describe it and it is drawn for you")}</small>
          </span>
          {imageMode && <Check size={20} />}
        </button>
      </div>
    </div>,
    document.body,
  );
}

// 「＋」を押したときに、その上へ開く小さなメニュー。ファイルを足すか、画像を作るモードに切り替えるかを選ぶ。
// チャットではノートの添付は入力欄の下の段にボタンとして出ているので、ここには入れない。
// ノートの AI パネルは幅が狭いので、ノートの添付をこのメニューに入れ（onAttachPages）、画像作成の行は出さない（onToggleImageMode なし）。
export function AttachMenu({
  disabled,
  onFilesChange,
  imageMode = false,
  onToggleImageMode,
  onAttachPages,
  className = "relative col-start-1 row-start-2",
  backToClose = false,
}: {
  disabled: boolean;
  onFilesChange: (event: ChangeEvent<HTMLInputElement>) => void;
  imageMode?: boolean;
  onToggleImageMode?: () => void;
  onAttachPages?: () => void;
  className?: string;
  // スマホのシートの中で使うとき：端末の「戻る」と Esc で、下のシートより先にこのメニューだけを閉じる。
  backToClose?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // アップロード中は「＋」が押せないので、開いていたメニューも出さない。
  const shown = open && !disabled;
  // 隠している間に開いたままの状態を残すと、アップロードが終わったときに勝手に開き直してしまう。
  if (open && disabled) setOpen(false);
  useBackToClose(shown && backToClose, () => setOpen(false));

  useEffect(() => {
    if (!shown) return;

    function closeOnOutsideClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    // キーボードで開いた人がそのまま矢印キーで選べるよう、最初の行へフォーカスを移す。
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();

    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [shown]);

  function moveFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === "ArrowDown") next = (index + 1) % rows.length;
    else if (event.key === "ArrowUp") next = (index - 1 + rows.length) % rows.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = rows.length - 1;
    else if (event.key === "Tab") {
      // 行が消える前に「＋」へフォーカスを戻し、Tab はそこから次へ進ませる。
      triggerRef.current?.focus();
      setOpen(false);
      return;
    } else return;
    event.preventDefault();
    rows[next]?.focus();
  }

  return (
    <div ref={rootRef} className={className}>
      <button
        ref={triggerRef}
        type="button"
        className="notion-icon-button grid"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={shown}
        aria-label={t("Add")}
        title={t("Add")}
        disabled={disabled}
      >
        <Plus size={18} strokeWidth={1.8} />
      </button>
      {/* メニューを閉じても選択結果を受け取れるよう、ファイル入力はメニューの外に置いたままにする。 */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        disabled={disabled}
        accept={ATTACHMENT_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onFilesChange}
      />
      {shown && (
        <div ref={menuRef} className="codex-model-menu attach-menu" role="menu" aria-label={t("Add")} onKeyDown={moveFocus}>
          <button
            type="button"
            role="menuitem"
            className="attach-row"
            onClick={() => {
              setOpen(false);
              triggerRef.current?.focus();
              fileInputRef.current?.click();
            }}
          >
            <Paperclip size={18} />
            <span>
              <strong>{t("Add files or photos")}</strong>
            </span>
          </button>
          {onAttachPages && (
            <button
              type="button"
              role="menuitem"
              aria-haspopup="dialog"
              className="attach-row"
              onClick={() => {
                setOpen(false);
                onAttachPages();
              }}
            >
              <FileText size={18} />
              <span>
                <strong>{t("Attach pages")}</strong>
                <small>{t("Let the AI read your notes")}</small>
              </span>
            </button>
          )}
          {onToggleImageMode && (
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={imageMode}
              className="attach-row"
              onClick={() => {
                // 切り替えたあとのフォーカスは呼び出し側が入力欄へ移す。
                onToggleImageMode();
                setOpen(false);
              }}
            >
              <ImagePlus size={18} />
              <span>
                <strong>{t("Create an image")}</strong>
                <small>{imageMode ? t("On — your next message creates an image") : t("Describe it and it is drawn for you")}</small>
              </span>
              {imageMode && <Check size={16} />}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
