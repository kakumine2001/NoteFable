"use client";

import { MessageSquareQuote } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/i18n-provider";
import { normalizeQuote } from "@/lib/chat-quote";

const BUTTON_HEIGHT = 36;
const GAP = 8;
const EDGE = 8;
const TOUCH_BOTTOM_GAP = 12;

type Placement = { top: number; left: number; centered: boolean; range: Range };

/** 選択した範囲が 1 つの引用できる回答（data-quotable）の中に収まっているときの、その回答の要素。 */
function quotableOf(node: Node | null, container: HTMLElement): HTMLElement | null {
  const element = node instanceof Element ? node : node?.parentElement;
  const quotable = element?.closest<HTMLElement>("[data-quotable]");
  return quotable && container.contains(quotable) ? quotable : null;
}

/**
 * 選んだ範囲の文字。selection.toString() だと数式（KaTeX）の読み上げ用 MathML と TeX が重なり、
 * コードブロックの見出し（言語名・コピー）も混ざるので、複製した範囲から作り直す：
 * 数式は TeX ソース（$…$ / $$…$$）に置き換え、コードの見出しは落とし、改行は画面上の段落に合わせる（innerText）。
 */
function selectedText(range: Range) {
  const fragment = range.cloneContents();
  fragment.querySelectorAll(".markdown-code-header").forEach((node) => node.replaceWith());
  fragment.querySelectorAll(".katex").forEach((node) => {
    const tex = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim();
    const visible = node.querySelector(".katex-html")?.textContent ?? node.textContent ?? "";
    const display = node.parentElement?.classList.contains("katex-display") ?? false;
    node.replaceWith(document.createTextNode(tex ? (display ? `$$${tex}$$` : `$${tex}$`) : visible));
  });
  // innerText は配置された要素でしか段落の改行を出さないので、画面外に一度置いて読む。
  const holder = document.createElement("div");
  holder.className = "markdown-body";
  holder.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;pointer-events:none;";
  holder.setAttribute("aria-hidden", "true");
  holder.append(fragment);
  document.body.append(holder);
  try {
    return holder.innerText;
  } finally {
    holder.replaceWith();
  }
}

function placementFor(container: HTMLElement): Placement | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const from = quotableOf(selection.anchorNode, container);
  if (!from || from !== quotableOf(selection.focusNode, container)) return null;
  const range = selection.getRangeAt(0);
  // 文字の組み立て（複製と配置）は押したときだけ。ここでは空でないことだけ見る。
  if (!selection.toString().trim()) return null;
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width || rect.height);
  const first = rects[0] ?? range.getBoundingClientRect();
  const last = rects.at(-1) ?? first;
  const view = container.getBoundingClientRect();
  // 選択が会話の見えている範囲の外へ出ていたら出さない。
  if (last.bottom < view.top || first.top > view.bottom) return null;
  // タッチ端末では OS の選択メニュー（iOS の「コピー・調べる」など）が選択の上か下に出て、選択の近くに置くと隠れる。
  // ウェブからはそのメニューに項目を足せないので、会話の下端（入力欄のすぐ上）の中央に固定して出す。
  if (window.matchMedia("(hover: none) and (pointer: coarse)").matches) {
    return { top: view.bottom - BUTTON_HEIGHT - TOUCH_BOTTOM_GAP, left: (view.left + view.right) / 2, centered: true, range };
  }
  // マウスでは選択の上（上が足りなければ下）に置く。
  let top = first.top - BUTTON_HEIGHT - GAP;
  if (top < view.top + EDGE) top = last.bottom + GAP;
  const left = Math.min(Math.max(first.left, EDGE), window.innerWidth - EDGE);
  return { top, left, centered: false, range };
}

/**
 * 回答の一部を選んだときに、選択の近くに「NoteFable に聞く」を出す。押すと選んだ文字を引用として入力欄へ渡す。
 * 見る範囲は container（会話のスクロール領域）の中の data-quotable の回答だけ。
 */
export function QuoteSelectionButton({ container, disabled, onQuote }: {
  container: RefObject<HTMLElement | null>;
  disabled?: boolean;
  onQuote: (text: string) => void;
}) {
  const t = useT();
  const [placement, setPlacement] = useState<Placement | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState(0);
  // タッチで押している間。iOS Safari はタップの始まりで選択を外すことがあるので、その間はボタンを消さずに押した位置で待つ。
  const pressedRef = useRef(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (pressedRef.current) return;
        const element = container.current;
        setPlacement(element && !disabled ? placementFor(element) : null);
      });
    };
    update();
    document.addEventListener("selectionchange", update);
    window.addEventListener("resize", update);
    // 会話のスクロールでも位置を合わせ直す（capture で中のスクロールも拾う）。
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [container, disabled]);

  useEffect(() => {
    if (placement && button.current) setWidth(button.current.offsetWidth);
  }, [placement]);

  if (!placement || typeof document === "undefined") return null;
  const start = placement.centered ? placement.left - width / 2 : placement.left;
  const left = Math.max(EDGE, Math.min(start, window.innerWidth - width - EDGE));
  const activate = () => {
    const text = normalizeQuote(selectedText(placement.range));
    // iOS ではタップの処理の中で同期してフォーカスしないと画面キーボードが開かない。onQuote が入力欄へフォーカスする。
    if (text) onQuote(text);
    window.getSelection()?.removeAllRanges();
    setPlacement(null);
  };
  return createPortal(
    <button
      ref={button}
      type="button"
      className="quote-selection-button"
      style={{ top: placement.top, left }}
      // 押した瞬間に選択が外れないよう、フォーカス移動を止める。
      onPointerDown={(event) => {
        event.preventDefault();
        if (event.pointerType !== "mouse") pressedRef.current = true;
      }}
      // iOS Safari（WebKit）はタッチで押したこのボタンに click を送らないことがある。タッチは指を離したときに引用する。
      onPointerUp={(event) => {
        if (event.pointerType === "mouse" || !pressedRef.current) return;
        pressedRef.current = false;
        event.preventDefault();
        activate();
      }}
      onPointerCancel={() => {
        pressedRef.current = false;
      }}
      onMouseDown={(event) => event.preventDefault()}
      // マウスとキーボード（Enter / Space）はいつもの click。タッチは上で済んでいる（ボタンはもう消えている）。
      onClick={activate}
    >
      <MessageSquareQuote size={15} aria-hidden="true" />
      <span>{t("Ask NoteFable")}</span>
    </button>,
    document.body,
  );
}
