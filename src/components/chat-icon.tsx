"use client";

import { MessageSquareText, Smile } from "lucide-react";
import { useState } from "react";
import { EMOJIS, EmojiPopover, randomOf, usePickerBackToClose } from "@/components/emoji-picker";

type ChatIconProps = {
  icon: string | null | undefined;
  onChange: (icon: string | null) => void;
};

// 上部バーのタイトル横のアイコン。スマホでも押せる大きさにし、押すと絵文字の選択を開く。
export function ChatTopbarIcon({ icon, onChange }: ChatIconProps) {
  const [open, setOpen] = useState(false);
  usePickerBackToClose(open, () => setOpen(false));
  return (
    <span className="chat-icon-wrap">
      <button type="button" className="chat-icon-button" aria-label="Change chat icon" title="Change icon" aria-haspopup="dialog" aria-expanded={open} data-popover-trigger
        onClick={() => setOpen(!open)}>
        {icon ? <span className="chat-icon-emoji">{icon}</span> : <MessageSquareText size={15} />}
      </button>
      {open && <EmojiPopover className="notes-icon-picker chat-icon-picker" current={icon ?? null} onChange={onChange} onClose={() => setOpen(false)} />}
    </span>
  );
}

// 会話の見出し（デスクトップ）に出す大きなアイコン。Notes と同じく、未設定のときはホバーで「Add icon」を出す。
export function ChatTitleIcon({ icon, onChange }: ChatIconProps) {
  const [open, setOpen] = useState(false);
  usePickerBackToClose(open, () => setOpen(false));
  if (!icon) {
    return (
      <div className="chat-title-controls">
        <button type="button" onClick={() => onChange(randomOf(EMOJIS))}><Smile size={15} />Add icon</button>
      </div>
    );
  }
  return (
    <div className="notes-icon-wrap chat-title-icon">
      <button type="button" className="notes-icon" aria-label="Change icon" aria-haspopup="dialog" aria-expanded={open} data-popover-trigger onClick={() => setOpen(!open)}>{icon}</button>
      {open && <EmojiPopover className="notes-icon-picker" current={icon} onChange={onChange} onClose={() => setOpen(false)} />}
    </div>
  );
}
