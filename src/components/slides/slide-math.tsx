"use client";

import { useEffect, useSyncExternalStore } from "react";
import { renderKatex, type KatexApi } from "@/lib/katex-render";

// スライドの数式（KaTeX）。数式のある枚を描くときだけ本体とスタイルを読み込む（note-math.tsx と同じ遅延読み込み）。
// 公開ページはサーバーが先に描いた HTML を渡すので、ブラウザでは読み込まない（SlideRenderContext の mathHtml）。
let katexApi: KatexApi | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const subscribeNothing = () => () => {};

export function loadSlideKatex(): Promise<void> {
  if (katexApi) return Promise.resolve();
  loading ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")])
    .then(([mod]) => {
      katexApi = (mod.default ?? mod) as KatexApi;
      listeners.forEach((listener) => listener());
    })
    .catch((error) => { loading = null; throw error; });
  return loading;
}

export function currentSlideKatex(): KatexApi | null {
  return katexApi;
}

export function useSlideKatex(needed: boolean): KatexApi | null {
  const api = useSyncExternalStore(needed ? subscribe : subscribeNothing, () => katexApi, () => null);
  useEffect(() => { if (needed) void loadSlideKatex().catch(() => {}); }, [needed]);
  return api;
}

export function slideMathHtml(api: KatexApi | null, latex: string, display: boolean): string | null {
  if (!api) return null;
  const { html } = renderKatex(api, latex, display);
  return html || null;
}
