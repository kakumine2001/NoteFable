"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/components/i18n-provider";
import { SlideFrame, SlideRenderRoot } from "@/components/slides/slide-render";
import "@/components/slides/slides.css";
import { normalizeDeck } from "@/lib/slides/model";
import { resolveTheme } from "@/lib/slides/themes";

// スライド提案のプレビュー（PR 7 のスライド AI 編集・作成がそのまま差し込めるよう SlideFrame を使う）。
// focusIds があれば対象スライドを優先して表示し、無ければ先頭スライドを表示する。
export default function SlidesProposalPreview({ data, focusIds }: { data: unknown; focusIds?: readonly string[] }) {
  const t = useT();
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(280);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => {
      const next = Math.floor(el.clientWidth);
      if (next > 0) setWidth(next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const deck = useMemo(() => normalizeDeck(data), [data]);
  const theme = useMemo(() => resolveTheme(deck.theme), [deck.theme]);

  const slidesToShow = useMemo(() => {
    if (!deck.slides.length) return [];
    const focus = new Set(focusIds ?? []);
    if (focus.size > 0) {
      const matched = deck.slides
        .map((slide, index) => ({ slide, index }))
        .filter(({ slide }) => focus.has(slide.id) || slide.elements.some((el) => focus.has(el.id)));
      if (matched.length) return matched.slice(0, 4);
    }
    return deck.slides.slice(0, 3).map((slide, index) => ({ slide, index }));
  }, [deck.slides, focusIds]);

  if (!slidesToShow.length) {
    return <p className="canvas-placeholder-empty">{t("Empty page")}</p>;
  }

  return (
    <div ref={hostRef} className="proposal-slides-preview">
      <SlideRenderRoot theme={theme} mode="view">
        {slidesToShow.map(({ slide, index }) => (
          <div key={slide.id} className="proposal-slide-thumb">
            <span className="proposal-slide-number" aria-hidden="true">{index + 1}</span>
            <SlideFrame slide={slide} width={Math.max(160, width)} />
          </div>
        ))}
      </SlideRenderRoot>
    </div>
  );
}
