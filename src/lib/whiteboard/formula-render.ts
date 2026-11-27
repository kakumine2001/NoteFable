"use client";

import { msg } from "@/lib/i18n/translate";
import { renderKatex, type KatexApi } from "@/lib/katex-render";
import { fitFormulaDisplaySize, sanitizeFormulaLatex } from "@/lib/whiteboard/formula";

// ブラウザー側で KaTeX を遅延読み込みし、数式ラベルを透過角丸カード PNG に描く。
// 明るい白地カード + 濃い文字で描くため、浅色・深色モード、カラー背景、エクスポート、公開ページすべてで読める。

let katexApi: KatexApi | null = null;
let katexPromise: Promise<KatexApi> | null = null;

export function getLoadedKatex(): KatexApi | null {
  return katexApi;
}

export function loadWhiteboardKatex(): Promise<KatexApi> {
  if (katexApi) return Promise.resolve(katexApi);
  if (katexPromise) return katexPromise;
  katexPromise = Promise.all([import("katex"), import("katex/dist/katex.min.css")])
    .then(([mod]) => {
      const api = (mod.default ?? mod) as KatexApi;
      katexApi = api;
      return api;
    })
    .catch((error) => {
      katexPromise = null;
      throw error;
    });
  return katexPromise;
}

export type RenderedFormulaPng = {
  blob: Blob;
  latex: string;
  pixelWidth: number;
  pixelHeight: number;
  displayWidth: number;
  displayHeight: number;
};

const MAX_RENDER_SIDE = 2560;

export async function renderFormulaToPng(rawLatex: string): Promise<RenderedFormulaPng> {
  const latex = sanitizeFormulaLatex(rawLatex);
  if (!latex) throw new Error(msg("Could not render the equation."));
  const katex = await loadWhiteboardKatex();
  const rendered = renderKatex(katex, latex, true);
  if (rendered.error || !rendered.html) {
    throw new Error(rendered.error || msg("Could not render the equation."));
  }

  // KaTeX の Web フォント読み込み完了を待ってから DOM を画像化する。
  if (typeof document !== "undefined" && document.fonts?.ready) {
    await document.fonts.ready.catch(() => undefined);
  }

  const wrapper = document.createElement("div");
  wrapper.setAttribute("aria-hidden", "true");
  wrapper.style.position = "fixed";
  wrapper.style.left = "-99999px";
  wrapper.style.top = "0";
  wrapper.style.pointerEvents = "none";
  wrapper.style.zIndex = "-1";

  const card = document.createElement("div");
  card.dir = "ltr";
  card.className = "whiteboard-formula-capture";
  card.style.display = "inline-block";
  card.style.width = "max-content";
  card.style.maxWidth = "960px";
  card.style.padding = "12px 18px";
  card.style.borderRadius = "10px";
  card.style.border = "1.5px solid #d0d7de";
  card.style.background = "#ffffff";
  card.style.color = "#1e1e1e";
  card.style.fontSize = "22px";
  card.style.lineHeight = "1.35";
  card.style.boxSizing = "border-box";
  card.style.fontFamily = "system-ui, -apple-system, sans-serif";
  card.innerHTML = rendered.html;

  // KaTeX の displayMode が付ける上下余白を外し、カードの余白を均等にする。
  const displayEl = card.querySelector<HTMLElement>(".katex-display");
  if (displayEl) {
    displayEl.style.margin = "0";
  }

  wrapper.appendChild(card);
  document.body.appendChild(wrapper);

  let canvas: HTMLCanvasElement | null = null;
  try {
    const rect = card.getBoundingClientRect();
    const logicalWidth = Math.max(48, Math.ceil(rect.width) + 2);
    const logicalHeight = Math.max(36, Math.ceil(rect.height) + 2);
    const scale = Math.min(2, MAX_RENDER_SIDE / Math.max(logicalWidth, logicalHeight));
    const { domToCanvas } = await import("modern-screenshot");
    canvas = await domToCanvas(card, {
      width: logicalWidth,
      height: logicalHeight,
      scale,
      backgroundColor: null,
    });
    if (!canvas || !canvas.width || !canvas.height) {
      throw new Error(msg("Could not render the equation."));
    }
    const blob = await new Promise<Blob | null>((resolve) => {
      try {
        canvas!.toBlob((result) => resolve(result && result.size > 0 ? result : null), "image/png");
      } catch {
        resolve(null);
      }
    });
    if (!blob) throw new Error(msg("Could not render the equation."));
    const { width: displayWidth, height: displayHeight } = fitFormulaDisplaySize(logicalWidth, logicalHeight);
    return {
      blob,
      latex,
      pixelWidth: canvas.width,
      pixelHeight: canvas.height,
      displayWidth,
      displayHeight,
    };
  } finally {
    wrapper.remove();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
