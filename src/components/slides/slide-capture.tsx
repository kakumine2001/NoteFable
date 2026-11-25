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
type Job =
  | { kind: "slide"; slide: Slide; resolve: (node: HTMLElement) => void; reject: (reason?: unknown) => void }
  | { kind: "notes"; input: NotesPageInput; resolve: (node: HTMLElement) => void; reject: (reason?: unknown) => void };

const SETTLE_RESOURCE_TIMEOUT_MS = 8_000;

function withTimeout(promise: Promise<unknown>, ms = SETTLE_RESOURCE_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    void promise.finally(() => {
      window.clearTimeout(timer);
      resolve();
    });
  });
}

async function settle(node: HTMLElement) {
  if (document.fonts?.ready) {
    await withTimeout(document.fonts.ready.catch(() => undefined));
  }
  await withTimeout(Promise.all(Array.from(node.querySelectorAll("img")).map((image) => image.complete
    ? (image.decode?.().catch(() => undefined) ?? Promise.resolve())
    : new Promise((resolve) => { image.onload = resolve; image.onerror = resolve; }))));
  // 数式は KaTeX を読み込んでから描かれる。
  if (node.querySelector(".slide-math-inline, .slide-math-block")) {
    await withTimeout(loadSlideKatex().catch(() => undefined));
    if (document.fonts?.ready) {
      await withTimeout(document.fonts.ready.catch(() => undefined));
    }
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function CaptureSlide({ slide, onReady, onError }: { slide: Slide; onReady: (node: HTMLElement) => void; onError: (reason: unknown) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    const node = ref.current?.firstElementChild as HTMLElement | null;
    if (!node) {
      onError(new Error("Slide capture element unavailable"));
      return;
    }
    void settle(node).then(() => { if (!cancelled) onReady(node); }, (reason) => { if (!cancelled) onError(reason); });
    return () => { cancelled = true; };
  }, [slide, onReady, onError]);
  return <div ref={ref}><SlideSurface slide={slide} /></div>;
}

// 演説者ノートつきの PDF の 1 ページ（A4 縦）：上に枚の画像、下にノート。
function CaptureNotes({ input, onReady, onError }: { input: NotesPageInput; onReady: (node: HTMLElement) => void; onError: (reason: unknown) => void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    if (!ref.current) {
      onError(new Error("Notes capture element unavailable"));
      return;
    }
    void settle(ref.current).then(() => { if (!cancelled && ref.current) onReady(ref.current); }, (reason) => { if (!cancelled) onError(reason); });
    return () => { cancelled = true; };
  }, [input, onReady, onError]);
  return <div ref={ref} className="slides-notes-page" dir={document.documentElement.dir}>
    <div className="slides-notes-page-head"><span>{input.title}</span><span>{t("Slide {number} of {count}", { number: input.number, count: input.count })}</span></div>
    {/* eslint-disable-next-line @next/next/no-img-element -- 書き出しの途中で作った画像（data URL）。 */}
    <img src={input.image} alt="" className="slides-notes-page-slide" />
    <div className="slides-notes-page-text">{input.notes}</div>
  </div>;
}

export function useSlideCapture(theme: ResolvedTheme) {
  const [job, setJob] = useState<Job | null>(null);
  const jobRef = useRef<Job | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const pending = jobRef.current;
      jobRef.current = null;
      pending?.reject(new Error("Slide capture cancelled"));
    };
  }, []);

  const startJob = useCallback((build: (resolve: (node: HTMLElement) => void, reject: (reason?: unknown) => void) => Job) => {
    if (!mountedRef.current) return Promise.reject(new Error("Slide capture unmounted"));
    return new Promise<HTMLElement>((resolve, reject) => {
      const previous = jobRef.current;
      if (previous) previous.reject(new Error("Slide capture superseded"));
      const next = build(resolve, reject);
      jobRef.current = next;
      setJob(next);
    });
  }, []);

  const renderSlide = useCallback((slide: Slide) => startJob((resolve, reject) => ({ kind: "slide", slide, resolve, reject })), [startJob]);
  const renderNotesPage = useCallback((input: NotesPageInput) => startJob((resolve, reject) => ({ kind: "notes", input, resolve, reject })), [startJob]);
  const done = useCallback(() => {
    const pending = jobRef.current;
    jobRef.current = null;
    pending?.reject(new Error("Slide capture finished"));
    if (mountedRef.current) setJob(null);
  }, []);
  const onReady = useCallback((node: HTMLElement) => {
    const current = jobRef.current;
    jobRef.current = null;
    current?.resolve(node);
  }, []);
  const onError = useCallback((reason: unknown) => {
    const current = jobRef.current;
    jobRef.current = null;
    current?.reject(reason);
  }, []);
  const node: ReactNode = job && typeof document !== "undefined" ? createPortal(<div className="slides-capture" aria-hidden="true">
    <SlideRenderRoot theme={theme} mode="view">
      {job.kind === "slide" ? <CaptureSlide slide={job.slide} onReady={onReady} onError={onError} /> : <CaptureNotes input={job.input} onReady={onReady} onError={onError} />}
    </SlideRenderRoot>
  </div>, document.body) : null;
  return { node, renderSlide, renderNotesPage, done };
}
