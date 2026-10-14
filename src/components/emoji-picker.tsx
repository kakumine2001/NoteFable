"use client";

import { Shuffle } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

// よく使う絵文字だけを並べる。Notion の「Emoji」タブの簡易版。Notes とチャットのアイコンで共有する。
export const EMOJIS = [
  "📄", "📝", "📒", "📓", "📔", "📕", "📗", "📘", "📙", "📚", "🗂️", "📁", "📌", "📎", "🔖", "🏷️",
  "✏️", "🖊️", "🖋️", "✒️", "📐", "📏", "🧮", "🧪", "🔬", "🔭", "💡", "🧠", "🎯", "🚀", "⭐", "🌟",
  "✅", "☑️", "❗", "❓", "⚠️", "🔥", "💯", "🎉", "🏆", "🥇", "📈", "📊", "🗓️", "⏰", "⌛", "🕒",
  "💻", "🖥️", "⌨️", "🖱️", "📱", "🔧", "🛠️", "⚙️", "🧩", "🔑", "🔒", "🌐", "📡", "🤖", "👾", "🐛",
  "🗾", "🏯", "🗼", "⛩️", "🍣", "🍜", "🍵", "☕", "🍙", "🍱", "🍎", "🍊",
  "🌸", "🌱", "🌿", "🍀", "🌳", "🌊", "⛰️", "🌙", "☀️", "🌈", "❄️", "⚡", "🎵", "🎨", "🎬", "📷",
  "😀", "😄", "😊", "🙂", "😎", "🤔", "😴", "🥳", "😭", "😤", "🙏", "👍", "👀", "💪", "❤️", "💬",
  "🐱", "🐶", "🐼", "🦊", "🐧", "🐢", "🦄", "🐝",
];

export function randomOf<T>(items: readonly T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

// 外側クリックと Esc で閉じる小さなポップオーバー。開閉ボタン自身のクリックは外側扱いにしない。
export function Popover({ className, onClose, children }: { className: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    function onDown(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (!ref.current?.contains(target) && !target.closest("[data-popover-trigger]")) closeRef.current();
    }
    function onKey(event: globalThis.KeyboardEvent) { if (event.key === "Escape") closeRef.current(); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, []);
  return <div ref={ref} className={`notes-popover ${className}`} role="dialog">{children}</div>;
}

// 絵文字の選択ポップオーバー。選ぶと閉じ、Random は開いたまま、Remove は null を返して閉じる。
export function EmojiPopover({ current, className, onChange, onClose }: {
  current: string | null;
  className: string;
  onChange: (icon: string | null) => void;
  onClose: () => void;
}) {
  return (
    <Popover className={className} onClose={onClose}>
      <div className="notes-picker-bar">
        <span>Emoji</span>
        <div className="flex gap-1">
          <button type="button" onClick={() => onChange(randomOf(EMOJIS))}><Shuffle size={13} />Random</button>
          <button type="button" onClick={() => { onChange(null); onClose(); }}>Remove</button>
        </div>
      </div>
      <div className="notes-emoji-grid">
        {EMOJIS.map((emoji) => (
          <button key={emoji} type="button" className={emoji === current ? "is-active" : ""}
            onClick={() => { onChange(emoji); onClose(); }}>{emoji}</button>
        ))}
      </div>
    </Popover>
  );
}
