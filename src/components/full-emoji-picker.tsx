"use client";

import EmojiPicker, { EmojiStyle, SuggestionMode, Theme } from "emoji-picker-react";
import emojiData from "emoji-picker-react/data/emojis-en";
import { Shuffle } from "lucide-react";
import { isEmojiIcon } from "@/lib/emoji-icon";

const randomEmojis = Object.values(emojiData.emojis).flat()
  .map((item) => String.fromCodePoint(...item.u.split("-").map((part) => parseInt(part, 16))))
  .filter(isEmojiIcon);

export default function FullEmojiPicker({ current, removeLabel, onChange, onClose }: {
  current: string | null;
  removeLabel: string;
  onChange: (icon: string | null) => void;
  onClose: () => void;
}) {
  return <div className="full-emoji-picker">
    <div className="notes-picker-bar">
      <span>Emoji{current && <span className="emoji-picker-current" aria-label="Current emoji"> {current}</span>}</span>
      <div className="flex gap-1">
        <button type="button" onClick={() => onChange(randomEmojis[Math.floor(Math.random() * randomEmojis.length)])}><Shuffle size={13} />Random</button>
        <button type="button" onClick={() => { onChange(null); onClose(); }}>{removeLabel}</button>
      </div>
    </div>
    <EmojiPicker width="100%" height="var(--emoji-picker-height)" theme={Theme.LIGHT}
      emojiStyle={EmojiStyle.NATIVE} suggestedEmojisMode={SuggestionMode.RECENT}
      previewConfig={{ showPreview: false }} searchPlaceholder="Search emoji…"
      onEmojiClick={(item) => { onChange(item.emoji); onClose(); }} />
  </div>;
}
