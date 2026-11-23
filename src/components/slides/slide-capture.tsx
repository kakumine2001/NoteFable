"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/i18n-provider";
import { loadSlideKatex } from "@/components/slides/slide-math";
import { SlideRenderRoot, SlideSurface } from "@/components/slides/slide-render";
import type { Slide } from "@/lib/slides/model";
import type { ResolvedTheme } from "@/lib/slides/themes";

// 書き出しのために、1 枚を画面の外に原寸（1920 × 1080）で描き、画像・書体・数式がそろってから返す。
// エディターの中（同じ React の木）に描くので、言語・主題の設定がそのまま効く。

export type NotesPageInput = { image: string; number: number; count: number; title: string; notes: string };
type Job = { kind: "slide"; slide: Slide; resolve: (node: HTMLElement) => void } | { kind: "notes"; input: NotesPageInput; resolve: (node: HTMLElement) => void };

async function settle(node: HTMLElement) {
  await document.fonts?.ready.catch(() => undefined);
  await Promise.all(Array.from(node.querySelectorAll("img")).map((image) => image.complete
    ? image.decode?.().catch(() => undefined)
    : new Promise((resolve) => { image.onload = resolve; image.onerror = resolve; })));
  // 数式は KaTeX を読み込んでから描かれる。
  if (node.querySelector(".slide-math-inline, .slide-math-block")) {
    await loadSlideKatex().catch(() => undefined);
    await document.fonts?.ready.catch(() => undefined);
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function CaptureSlide({ slide, onReady }: { slide: Slide; onReady: (node: HTMLElement) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    const node = ref.current?.firstElementChild as HTMLElement | null;
    if (!node) return;
    void settle(node).then(() => { if (!cancelled) onReady(node); });
    return () => { cancelled = true; };
  }, [slide, onReady]);
  return <div ref={ref}><SlideSurface slide={slide} /></div>;
}

// 演説者ノートつきの PDF の 1 ページ（A4 縦）：上に枚の画像、下にノート。
function CaptureNotes({ input, onReady }: { input: NotesPageInput; onReady: (node: HTMLElement) => void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    if (!ref.current) return;
    void settle(ref.current).then(() => { if (!cancelled && ref.current) onReady(ref.current); });
    return () => { cancelled = true; };
  }, [input, onReady]);
  return <div ref={ref} className="slides-notes-page" dir={document.documentElement.dir}>
    <div className="slides-notes-page-head"><span>{input.title}</span><span>{t("Slide {number} of {count}", { number: input.number, count: input.count })}</span></div>
    {/* eslint-disable-next-line @next/next/no-img-element -- 書き出しの途中で作った画像（data URL）。 */}
    <img src={input.image} alt="" className="slides-notes-page-slide" />
    <div className="slides-notes-page-text">{input.notes}</div>
  </div>;
}

export function useSlideCapture(theme: ResolvedTheme) {
  const [job, setJob] = useState<Job | null>(null);
  const renderSlide = useCallback((slide: Slide) => new Promise<HTMLElement>((resolve) => setJob({ kind: "slide", slide, resolve })), []);
  const renderNotesPage = useCallback((input: NotesPageInput) => new Promise<HTMLElement>((resolve) => setJob({ kind: "notes", input, resolve })), []);
  const done = useCallback(() => setJob(null), []);
  const onReady = useCallback((node: HTMLElement) => { job?.resolve(node); }, [job]);
  const node: ReactNode = job && typeof document !== "undefined" ? createPortal(<div className="slides-capture" aria-hidden="true">
    <SlideRenderRoot theme={theme} mode="view">
      {job.kind === "slide" ? <CaptureSlide slide={job.slide} onReady={onReady} /> : <CaptureNotes input={job.input} onReady={onReady} />}
    </SlideRenderRoot>
  </div>, document.body) : null;
  return { node, renderSlide, renderNotesPage, done };
}
