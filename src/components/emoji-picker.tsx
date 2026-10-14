"use client";

import { Shuffle } from "lucide-react";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBackToClose } from "@/lib/use-back-to-close";
import { useMediaQuery } from "@/lib/use-media-query";

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
// trigger を渡すとその 1 つだけを開閉ボタンとして扱う（同じ画面に開閉ボタンが複数あるとき、別のボタンは外側のクリックにする）。
// 開いたらダイアログへフォーカスを移し、閉じたときにフォーカスが行き場を失っていれば開閉ボタンへ戻す。
export function Popover({ className, label, style, trigger, onClose, children }: {
  className: string;
  label?: string;
  style?: CSSProperties;
  trigger?: { current: HTMLElement | null };
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    function onDown(event: MouseEvent) {
      const target = event.target as HTMLElement;
      const onTrigger = trigger ? !!trigger.current?.contains(target) : !!target.closest("[data-popover-trigger]");
      if (!ref.current?.contains(target) && !onTrigger) closeRef.current();
    }
    function onKey(event: globalThis.KeyboardEvent) { if (event.key === "Escape") closeRef.current(); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    const opener = trigger?.current ?? (document.activeElement as HTMLElement | null);
    ref.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      // ほかの入力欄をクリックして閉じた場合はそのフォーカスを奪わない。
      setTimeout(() => { if (opener?.isConnected && (!document.activeElement || document.activeElement === document.body)) opener.focus({ preventScroll: true }); });
    };
  }, [trigger]);
  return <div ref={ref} className={`notes-popover ${className}`} style={style} role="dialog" aria-label={label} tabIndex={-1}>{children}</div>;
}

// 端末の「戻る」でアプリを閉じず、選択画面だけを閉じる（サイドバーが抽屉になる 1024px 未満で有効）。
// 抽屉の上に重なっても、Esc と「戻る」は先にこちらだけを閉じる。
// ポップオーバーの開閉ではなく、常に描画されている側（開閉ボタンを持つコンポーネント）で呼ぶ。
export function usePickerBackToClose(open: boolean, onClose: () => void) {
  const drawerLayout = useMediaQuery("(max-width: 1023px)");
  useBackToClose(open && drawerLayout, onClose);
}

// 絵文字の一覧（上のバーに Random / Remove、下に絵文字の格子）。ポップオーバーの中にも、プロフィールのように画面の中にもそのまま置ける。
// 選ぶと閉じ、Random は開いたまま、Remove は null を返して閉じる。
export function EmojiPickerBody({ current, removeLabel = "Remove", onChange, onClose }: {
  current: string | null;
  removeLabel?: string;
  onChange: (icon: string | null) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="notes-picker-bar">
        <span>Emoji</span>
        <div className="flex gap-1">
          <button type="button" onClick={() => onChange(randomOf(EMOJIS))}><Shuffle size={13} />Random</button>
          <button type="button" onClick={() => { onChange(null); onClose(); }}>{removeLabel}</button>
        </div>
      </div>
      <div className="notes-emoji-grid">
        {EMOJIS.map((emoji) => (
          <button key={emoji} type="button" className={emoji === current ? "is-active" : ""}
            onClick={() => { onChange(emoji); onClose(); }}>{emoji}</button>
        ))}
      </div>
    </>
  );
}

// 絵文字の選択ポップオーバー。
export function EmojiPopover({ current, className, style, trigger, onChange, onClose }: {
  current: string | null;
  className: string;
  style?: CSSProperties;
  trigger?: { current: HTMLElement | null };
  onChange: (icon: string | null) => void;
  onClose: () => void;
}) {
  return (
    <Popover className={className} label="Choose an emoji" style={style} trigger={trigger} onClose={onClose}>
      <EmojiPickerBody current={current} onChange={onChange} onClose={onClose} />
    </Popover>
  );
}

export type FloatingPosition = { top: number; left: number; width: number };

// 押したボタンの位置から、画面内に収まる選択画面の位置を求める。下に入らなければボタンの上に出す。
export function floatingPositionFor(anchor: DOMRect): FloatingPosition {
  const margin = 12;
  const height = 332;
  const width = Math.min(408, window.innerWidth - margin * 2);
  const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin));
  const below = anchor.bottom + 6;
  const top = below + height <= window.innerHeight - margin ? below : Math.max(margin, anchor.top - height - 6);
  return { top, left, width };
}

// スクロールする一覧（サイドバーなど）の中のボタンから開く選択画面。裁ち切られないよう body に固定位置で出す。
// 位置は開いた時点で決めるので、一覧がスクロールされたり画面サイズが変わったら閉じる。
export function FloatingEmojiPopover({ position, trigger, current, onChange, onClose }: {
  position: FloatingPosition;
  trigger: { current: HTMLElement | null };
  current: string | null;
  onChange: (icon: string | null) => void;
  onClose: () => void;
}) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    const width = window.innerWidth;
    // 幅が変わったときだけ閉じる（アドレスバーの出し入れによる高さだけの変化では閉じない）。
    const close = () => { if (window.innerWidth !== width) closeRef.current(); };
    window.addEventListener("resize", close);
    // スクロールは子要素のものも拾う（capture）。選択画面自身の中のスクロールでは閉じない。
    const onScroll = (event: Event) => {
      if (!(event.target as Element | null)?.closest?.(".chat-floating-picker")) close();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, []);
  return createPortal(
    <EmojiPopover className="chat-floating-picker" style={position} trigger={trigger} current={current} onChange={onChange} onClose={onClose} />,
    document.body,
  );
}
