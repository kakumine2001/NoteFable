"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBackToClose } from "@/lib/use-back-to-close";
import { useMediaQuery } from "@/lib/use-media-query";
import { useT } from "@/components/i18n-provider";

// Load the full dataset only when a picker opens, never during server rendering.
const FullEmojiPicker = dynamic(() => import("./full-emoji-picker"), {
  ssr: false,
  loading: () => <EmojiLoading />,
});

function EmojiLoading() {
  const t = useT();
  return <div className="emoji-picker-loading" role="status">{t("Loading emoji…")}</div>;
}

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
export function EmojiPickerBody({ current, removeLabel, onChange, onClose }: {
  current: string | null;
  removeLabel?: string;
  onChange: (icon: string | null) => void;
  onClose: () => void;
}) {
  const t = useT();
  return <FullEmojiPicker current={current} removeLabel={removeLabel ?? t("Remove")} onChange={onChange} onClose={onClose} />;
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
  const t = useT();
  return (
    <Popover className={className} label={t("Choose an emoji")} style={style} trigger={trigger} onClose={onClose}>
      <EmojiPickerBody current={current} onChange={onChange} onClose={onClose} />
    </Popover>
  );
}

export type FloatingPosition = { top: number; left: number; width: number };

// 押したボタンの位置から、画面内に収まる選択画面の位置を求める。下に入らなければボタンの上に出す。
export function floatingPositionFor(anchor: DOMRect): FloatingPosition {
  const margin = 12;
  const viewport = window.visualViewport;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const height = Math.min(416, viewportHeight - margin * 2);
  const width = Math.min(408, viewportWidth - margin * 2);
  const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  const preferredLeft = rtl ? anchor.right - width : anchor.left;
  const left = Math.max(viewportLeft + margin, Math.min(preferredLeft, viewportLeft + viewportWidth - width - margin));
  const below = anchor.bottom + 6;
  const preferredTop = below + height <= viewportTop + viewportHeight - margin ? below : anchor.top - height - 6;
  const top = Math.max(viewportTop + margin, Math.min(preferredTop, viewportTop + viewportHeight - height - margin));
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
  const [livePosition, setLivePosition] = useState(position);
  const [availableHeight, setAvailableHeight] = useState(() => Math.max(80, (window.visualViewport?.height ?? window.innerHeight) - 60));
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    const width = window.innerWidth;
    // 幅が変わったときだけ閉じる（アドレスバーの出し入れによる高さだけの変化では閉じない）。
    const reposition = () => {
      if (trigger.current) setLivePosition(floatingPositionFor(trigger.current.getBoundingClientRect()));
      setAvailableHeight(Math.max(80, (window.visualViewport?.height ?? window.innerHeight) - 60));
    };
    const onResize = () => { if (window.innerWidth !== width) closeRef.current(); else reposition(); };
    window.addEventListener("resize", onResize);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", reposition);
    // スクロールは子要素のものも拾う（capture）。選択画面自身の中のスクロールでは閉じない。
    const onScroll = (event: Event) => {
      if (!(event.target as Element | null)?.closest?.(".chat-floating-picker")) closeRef.current();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onResize);
      viewport?.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [trigger]);
  return createPortal(
    <EmojiPopover className="chat-floating-picker" style={{ ...livePosition, "--emoji-picker-available-height": `${availableHeight}px` } as CSSProperties} trigger={trigger} current={current} onChange={onChange} onClose={onClose} />,
    document.body,
  );
}
