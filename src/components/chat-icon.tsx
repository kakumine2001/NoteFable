"use client";

import { MessageSquareText } from "lucide-react";
import { useRef, useState } from "react";
import { FloatingEmojiPopover, floatingPositionFor, usePickerBackToClose, type FloatingPosition } from "@/components/emoji-picker";

type ChatIconProps = {
  icon: string | null | undefined;
  onChange: (icon: string | null) => void;
};

// 上部バーのタイトル横のアイコン。スマホでも押せる大きさにし、押すと絵文字の選択を開く。
export function ChatTopbarIcon({ icon, onChange }: ChatIconProps) {
  const [position, setPosition] = useState<FloatingPosition | null>(null);
  const open = position !== null;
  const triggerRef = useRef<HTMLButtonElement>(null);
  usePickerBackToClose(open, () => setPosition(null));
  return (
    <span className="chat-icon-wrap">
      <button type="button" className="chat-icon-button" aria-label="Change chat icon" title="Change icon" aria-haspopup="dialog" aria-expanded={open} ref={triggerRef}
        onClick={(event) => setPosition(open ? null : floatingPositionFor(event.currentTarget.getBoundingClientRect()))}>
        {icon ? <span className="chat-icon-emoji">{icon}</span> : <MessageSquareText size={15} />}
      </button>
      {position && <FloatingEmojiPopover position={position} trigger={triggerRef} current={icon ?? null} onChange={onChange} onClose={() => setPosition(null)} />}
    </span>
  );
}

// 見出しの左に出すアイコン。未設定のときは既定の吹き出しを出し、最初の送信前でも押して変えられる。
// 見出しの文字サイズに合わせて大きさが変わるので、<h1> の中の先頭に置く。
export function ChatTitleIcon({ icon, onChange }: ChatIconProps) {
  const [position, setPosition] = useState<FloatingPosition | null>(null);
  const open = position !== null;
  const triggerRef = useRef<HTMLButtonElement>(null);
  usePickerBackToClose(open, () => setPosition(null));
  return (
    <span className="chat-icon-wrap chat-title-icon">
      <button type="button" className="chat-title-icon-button" aria-label="Change chat icon" title="Change icon" aria-haspopup="dialog" aria-expanded={open} ref={triggerRef}
        onClick={(event) => setPosition(open ? null : floatingPositionFor(event.currentTarget.getBoundingClientRect()))}>
        {icon ? <span className="chat-title-emoji">{icon}</span> : <MessageSquareText size="0.7em" strokeWidth={1.8} />}
      </button>
      {position && <FloatingEmojiPopover position={position} trigger={triggerRef} current={icon ?? null} onChange={onChange} onClose={() => setPosition(null)} />}
    </span>
  );
}
