"use client";

import { MessageSquareText } from "lucide-react";
import { useRef, useState } from "react";
import { EmojiPopover, usePickerBackToClose } from "@/components/emoji-picker";

type ChatIconProps = {
  icon: string | null | undefined;
  onChange: (icon: string | null) => void;
};

// 上部バーのタイトル横のアイコン。スマホでも押せる大きさにし、押すと絵文字の選択を開く。
export function ChatTopbarIcon({ icon, onChange }: ChatIconProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  usePickerBackToClose(open, () => setOpen(false));
  return (
    <span className="chat-icon-wrap">
      <button type="button" className="chat-icon-button" aria-label="Change chat icon" title="Change icon" aria-haspopup="dialog" aria-expanded={open} ref={triggerRef}
        onClick={() => setOpen(!open)}>
        {icon ? <span className="chat-icon-emoji">{icon}</span> : <MessageSquareText size={15} />}
      </button>
      {open && <EmojiPopover className="notes-icon-picker chat-icon-picker" trigger={triggerRef} current={icon ?? null} onChange={onChange} onClose={() => setOpen(false)} />}
    </span>
  );
}

// 見出しの左に出すアイコン。未設定のときは既定の吹き出しを出し、最初の送信前でも押して変えられる。
// 見出しの文字サイズに合わせて大きさが変わるので、<h1> の中の先頭に置く。
export function ChatTitleIcon({ icon, onChange }: ChatIconProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  usePickerBackToClose(open, () => setOpen(false));
  return (
    <span className="chat-icon-wrap chat-title-icon">
      <button type="button" className="chat-title-icon-button" aria-label="Change chat icon" title="Change icon" aria-haspopup="dialog" aria-expanded={open} ref={triggerRef}
        onClick={() => setOpen(!open)}>
        {icon ? <span className="chat-title-emoji">{icon}</span> : <MessageSquareText size="0.7em" strokeWidth={1.8} />}
      </button>
      {open && <EmojiPopover className="notes-icon-picker chat-title-picker" trigger={triggerRef} current={icon ?? null} onChange={onChange} onClose={() => setOpen(false)} />}
    </span>
  );
}
