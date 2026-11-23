"use client";

import "@/components/slides/slides.css";
import { ChevronLeft, ChevronRight, Globe, Play } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/components/i18n-provider";
import { SlidePlayer } from "@/components/slides/slide-player";
import { SlideFrame, SlideRenderRoot } from "@/components/slides/slide-render";
import type { Deck } from "@/lib/slides/model";
import { publicImageSrc } from "@/lib/slides/public-deck";
import { resolveTheme } from "@/lib/slides/themes";

// 公開の放映ページ（/s/:token）：1 枚ずつ大きく見せ、下に縮小図を並べる。「放映」で全画面にする。読み取り専用。
export function PublicSlidesPlayer({ deck, mathHtml, token, pageId, title, homeHref }: {
  deck: Deck; mathHtml: Record<string, string>; token: string; pageId: string; title: string; homeHref: string;
}) {
  const t = useT();
  const theme = useMemo(() => resolveTheme(deck.theme), [deck.theme]);
  const imageSrc = useMemo(() => publicImageSrc(token, pageId), [token, pageId]);
  const [index, setIndex] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(960);
  useLayoutEffect(() => {
    const node = stage.current;
    if (!node) return;
    const update = () => setWidth(Math.max(120, Math.min(node.clientWidth, ((node.clientHeight || 540) * 16) / 9)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const go = useCallback((delta: number) => setIndex((current) => Math.max(0, Math.min(deck.slides.length - 1, current + delta))), [deck.slides.length]);
  useEffect(() => {
    if (presenting) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // ボタンなどにフォーカスがあるときのスペース・Enter はそのボタンのもの。
      const onControl = event.target instanceof Element && !!event.target.closest("button, a, input, textarea, select, [role='button']");
      if (["ArrowRight", "ArrowDown", "PageDown"].includes(event.key) || (event.key === " " && !onControl)) { event.preventDefault(); go(1); }
      if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) { event.preventDefault(); go(-1); }
      if (deck.slides.length && (event.key === "F5" || (event.key === "Enter" && !onControl))) { event.preventDefault(); setPresenting(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deck.slides.length, go, presenting]);
  const slide = deck.slides[index] ?? null;
  return <SlideRenderRoot theme={theme} mode="view" imageSrc={imageSrc} mathHtml={mathHtml}>
    <div className="public-slides">
      <header className="public-slides-topbar">
        <h1 className="public-slides-title">{title.trim() && title !== "Untitled" ? title : t("Untitled")}</h1>
        <button type="button" className="slides-present-button is-standalone" disabled={!slide} onClick={() => setPresenting(true)}><Play size={16} aria-hidden="true" />{t("Present")}</button>
        <a href={homeHref} className="public-note-brand"><Globe size={14} aria-hidden="true" /><span>{t("Made with NoteFable")}</span></a>
      </header>
      <main className="public-slides-main">
        <div ref={stage} className="public-slides-stage">
          {slide ? <SlideFrame key={slide.id} slide={slide} width={width} link className="public-slides-frame" /> : <p className="slides-player-empty">{t("This deck has no slides to show.")}</p>}
        </div>
        {deck.slides.length > 0 && <div className="public-slides-nav">
          <button type="button" onClick={() => go(-1)} disabled={index <= 0} aria-label={t("Previous slide")} title={t("Previous slide")}><ChevronLeft size={20} className="rtl-mirror" /></button>
          <span className="public-slides-counter">{index + 1} / {deck.slides.length}</span>
          <button type="button" onClick={() => go(1)} disabled={index >= deck.slides.length - 1} aria-label={t("Next slide")} title={t("Next slide")}><ChevronRight size={20} className="rtl-mirror" /></button>
        </div>}
        <ol className="public-slides-strip" aria-label={t("Slides")}>
          {deck.slides.map((entry, number) => <li key={entry.id}>
            <button type="button" className={`slides-thumb-button${number === index ? " is-current" : ""}`} aria-current={number === index || undefined}
              aria-label={t("Slide {number}", { number: number + 1 })} onClick={() => setIndex(number)}>
              <SlideFrame slide={entry} width={128} />
            </button>
          </li>)}
        </ol>
      </main>
      {presenting && <SlidePlayer deck={deck} startId={slide?.id ?? null} allowPresenter={false} onExit={() => setPresenting(false)}
        onChange={(current) => setIndex(Math.max(0, deck.slides.findIndex((entry) => entry.id === current.id)))} />}
    </div>
  </SlideRenderRoot>;
}
