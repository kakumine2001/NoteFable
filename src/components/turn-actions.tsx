"use client";

import { Check, ChevronLeft, ChevronRight, Copy, Pencil } from "lucide-react";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import "@/components/answer-actions.css";
import { useT } from "@/components/i18n-provider";
import type { MessageVersions } from "@/lib/chat-branches";
import { writeClipboardText } from "@/lib/clipboard";

// この会話が返答中、または送信の途中か。その間は編集・再生成・版の切り替えを押せない。
// メッセージ（memo 化している）の props にせず、操作の部品だけがここから読む：返答の開始・終了で会話全体を描き直さないため。
export const TurnBusyContext = createContext(false);

// 発言ごとの操作。画面（page.tsx）が同じオブジェクトを渡し続けるので、メッセージの再描画を起こさない。
export type TurnActions = {
  // 回答を、いま選んでいるモデルで作り直す。
  regenerate: (messageId: string) => void;
  // 自分の発言を書き直して送り直す。
  edit: (messageId: string, text: string) => void;
  // 断られて戻ってきた書き直し（editDraft）を、取り消しで捨てる。
  dismissEditDraft: () => void;
  // 別の版（編集前の発言・前の回答）を表示する。
  showVersion: (messageId: string) => void;
  // ここまでの会話を新しいチャットに複製する。
  branch: (messageId: string) => void;
};

// 「‹ 2/3 ›」。編集した発言・再生成した回答の版を行き来する。
export function VersionNav({ versions, onShow }: { versions: MessageVersions; onShow: (messageId: string) => void }) {
  const t = useT();
  const busy = useContext(TurnBusyContext);
  return (
    <span className="version-nav" role="group" aria-label={t("Versions")}>
      <button type="button" className="answer-action" disabled={busy || !versions.prevId} aria-label={t("Previous version")} title={t("Previous version")}
        onClick={() => { if (versions.prevId) onShow(versions.prevId); }}>
        <ChevronLeft size={16} strokeWidth={1.9} />
      </button>
      <span className="version-nav-count">{versions.index}/{versions.total}</span>
      <button type="button" className="answer-action" disabled={busy || !versions.nextId} aria-label={t("Next version")} title={t("Next version")}
        onClick={() => { if (versions.nextId) onShow(versions.nextId); }}>
        <ChevronRight size={16} strokeWidth={1.9} />
      </button>
    </span>
  );
}

// 自分の発言の下の操作：コピー、編集、版の切り替え。コピーと編集は、マウスのある端末では発言に乗せたときだけ見せる。
export function UserTurnActions({ content, versions, canEdit, onEdit, onShowVersion }: {
  content: string; versions?: MessageVersions; canEdit: boolean; onEdit: () => void; onShowVersion: (messageId: string) => void;
}) {
  const t = useT();
  const busy = useContext(TurnBusyContext);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    if (!await writeClipboardText(content)) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="answer-actions user-turn-actions" role="group" aria-label={t("Message actions")}>
      {versions && <VersionNav versions={versions} onShow={onShowVersion} />}
      {!!content && (
        <button type="button" className="answer-action is-on-hover" onClick={() => void copy()} aria-label={t("Copy message")} title={t("Copy message")}>
          {copied ? <Check size={16} strokeWidth={2} /> : <Copy size={16} strokeWidth={1.9} />}
        </button>
      )}
      {canEdit && (
        <button type="button" className="answer-action is-on-hover" disabled={busy} onClick={onEdit} aria-label={t("Edit message")} title={t("Edit message")}>
          <Pencil size={16} strokeWidth={1.9} />
        </button>
      )}
      <span role="status" aria-live="polite" className="sr-only">{copied ? t("Copied") : ""}</span>
    </div>
  );
}

// 発言をその場で書き直す欄。送ると、元の発言は版として残り、ここから先の会話が作り直される。
export function UserMessageEditor({ initial, onCancel, onSubmit }: { initial: string; onCancel: () => void; onSubmit: (text: string) => void }) {
  const t = useT();
  // 返答中は送れない（押しても何も起きず、書いた文が消えるのを防ぐ）。書き続けることはできる。
  const busy = useContext(TurnBusyContext);
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  // 行数に合わせて高さを伸ばす（上限を超えたら欄の中でスクロールする）。
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [text]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.focus({ preventScroll: true });
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);

  const trimmed = text.trim();
  return (
    <form className="user-message-editor" onSubmit={(event) => { event.preventDefault(); if (trimmed && !busy) onSubmit(trimmed); }}>
      <textarea ref={ref} value={text} rows={1} aria-label={t("Edit message")} onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); onCancel(); return; }
          // 入力欄と同じ：IME の確定は送らず、画面キーボードの端末では Enter を改行にして Ctrl/Cmd+Enter かボタンで送る。
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229
            && (event.ctrlKey || event.metaKey || !window.matchMedia("(hover: none) and (pointer: coarse)").matches)) {
            event.preventDefault();
            if (trimmed && !busy) onSubmit(trimmed);
          }
        }} />
      <div className="user-message-editor-buttons">
        <button type="button" className="notion-button" onClick={onCancel}>{t("Cancel")}</button>
        <button type="submit" className="notion-button notion-button-primary" disabled={!trimmed || busy}>{t("Send")}</button>
      </div>
    </form>
  );
}
