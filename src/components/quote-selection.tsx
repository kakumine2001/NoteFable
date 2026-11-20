"use client";

import { MessageSquareQuote } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/i18n-provider";
import { normalizeQuote } from "@/lib/chat-quote";

const BUTTON_HEIGHT = 36;
const GAP = 8;
const EDGE = 8;

type Placement = { top: number; left: number; range: Range };

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
  // タッチ端末では OS の選択メニューが選択の上に出るので、ボタンは選択の下に置く。マウスでは選択の上に置く。
  const touch = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  let top = touch ? last.bottom + GAP + 18 : first.top - BUTTON_HEIGHT - GAP;
  if (!touch && top < view.top + EDGE) top = last.bottom + GAP;
  if (touch && top + BUTTON_HEIGHT > view.bottom - EDGE) top = first.top - BUTTON_HEIGHT - GAP;
  // 選択が会話の見えている範囲の外へ出ていたら出さない。
  if (top < view.top - BUTTON_HEIGHT || top > view.bottom) return null;
  const anchor = touch ? last : first;
  const left = Math.min(Math.max(anchor.left, EDGE), window.innerWidth - EDGE);
  return { top, left, range };
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

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
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
  const left = Math.max(EDGE, Math.min(placement.left, window.innerWidth - width - EDGE));
  return createPortal(
    <button
      ref={button}
      type="button"
      className="quote-selection-button"
      style={{ top: placement.top, left }}
      // 押した瞬間に選択が外れないよう、フォーカス移動を止める。
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        const text = normalizeQuote(selectedText(placement.range));
        if (text) onQuote(text);
        window.getSelection()?.removeAllRanges();
        setPlacement(null);
      }}
    >
      <MessageSquareQuote size={15} aria-hidden="true" />
      <span>{t("Ask NoteFable")}</span>
    </button>,
    document.body,
  );
}
