"use client";

import { exportScene, getCommonBounds } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useRef } from "react";
import { useT } from "@/components/i18n-provider";

// ホワイトボードの小地図：全体の縮小図と、いま見えている範囲の枠。押す・なぞるとその場所へ移る。
// 縮小図は内容が変わった時だけ作り直し（少し待ってから）、表示位置が変わった時は描き直すだけにする。
// 要素がとても多いときは、縮小図の代わりに要素の外枠だけを描く（重くしない）。

type Rect = { x: number; y: number; width: number; height: number };
const DETAILED_LIMIT = 2500;

export function WhiteboardMinimap({ api, version, theme }: { api: ExcalidrawImperativeAPI; version: string; theme: "light" | "dark" }) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cache = useRef<{ image: HTMLCanvasElement | null; bounds: Rect | null; boxes: (Rect & { color: string })[] | null }>({ image: null, bounds: null, boxes: null });
  const layout = useRef<{ region: Rect; scale: number; offsetX: number; offsetY: number } | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || api.isDestroyed) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
    if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    const state = api.getAppState();
    const view: Rect = { x: -state.scrollX, y: -state.scrollY, width: state.width / state.zoom.value, height: state.height / state.zoom.value };
    const content = cache.current.bounds;
    // 内容と見えている範囲の両方が入る範囲（内容は少し余白を付ける）。
    const padded = content ? { x: content.x - content.width * 0.15, y: content.y - content.height * 0.15, width: content.width * 1.3, height: content.height * 1.3 } : view;
    const left = Math.min(padded.x, view.x);
    const top = Math.min(padded.y, view.y);
    const region = { x: left, y: top, width: Math.max(padded.x + padded.width, view.x + view.width) - left, height: Math.max(padded.y + padded.height, view.y + view.height) - top };
    const scale = Math.min(width / Math.max(1, region.width), height / Math.max(1, region.height));
    const offsetX = (width - region.width * scale) / 2;
    const offsetY = (height - region.height * scale) / 2;
    layout.current = { region, scale, offsetX, offsetY };
    const map = (rect: Rect) => ({ x: offsetX + (rect.x - region.x) * scale, y: offsetY + (rect.y - region.y) * scale, width: rect.width * scale, height: rect.height * scale });
    if (cache.current.image && content) {
      const target = map(content);
      context.drawImage(cache.current.image, target.x, target.y, target.width, target.height);
    } else if (cache.current.boxes) {
      context.globalAlpha = 0.55;
      for (const box of cache.current.boxes) {
        const target = map(box);
        context.fillStyle = box.color;
        context.fillRect(target.x, target.y, Math.max(1, target.width), Math.max(1, target.height));
      }
      context.globalAlpha = 1;
    }
    const frame = map(view);
    const accent = getComputedStyle(canvas).getPropertyValue("--nf-accent").trim() || "#2383e2";
    context.fillStyle = theme === "dark" ? "rgba(82, 156, 202, 0.12)" : "rgba(35, 131, 226, 0.08)";
    context.fillRect(frame.x, frame.y, frame.width, frame.height);
    context.strokeStyle = accent;
    context.lineWidth = 1.5;
    context.strokeRect(frame.x + 0.75, frame.y + 0.75, Math.max(0, frame.width - 1.5), Math.max(0, frame.height - 1.5));
  }, [api, theme]);

  // 内容が変わったら縮小図を作り直す。
  useEffect(() => {
    let cancelled = false;
    const elements = api.getSceneElements();
    const timer = setTimeout(async () => {
      if (!elements.length) { cache.current = { image: null, bounds: null, boxes: null }; draw(); return; }
      const [x1, y1, x2, y2] = getCommonBounds(elements);
      const bounds = { x: x1, y: y1, width: Math.max(1, x2 - x1), height: Math.max(1, y2 - y1) };
      if (elements.length > DETAILED_LIMIT) {
        cache.current = { image: null, bounds, boxes: elements.map((element) => ({ x: element.x, y: element.y, width: element.width, height: element.height, color: element.strokeColor === "transparent" ? element.backgroundColor : element.strokeColor })) };
        draw();
        return;
      }
      try {
        const scale = Math.min(1, 480 / Math.max(bounds.width, bounds.height));
        const image = await exportScene({
          type: "canvas",
          data: { elements, files: api.getFiles(), appState: { viewBackgroundColor: api.getAppState().viewBackgroundColor } } as never,
          config: { theme, padding: 0, scale, canvasBackgroundColor: false },
        });
        if (cancelled) return;
        cache.current = { image, bounds, boxes: null };
      } catch {
        cache.current = { image: null, bounds, boxes: elements.map((element) => ({ x: element.x, y: element.y, width: element.width, height: element.height, color: element.strokeColor })) };
      }
      draw();
    }, elements.length > DETAILED_LIMIT ? 1200 : 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [api, version, theme, draw]);

  // 表示位置が変わったら描き直す。
  useEffect(() => {
    draw();
    const off = api.onScrollChange(() => requestAnimationFrame(draw));
    const observer = new ResizeObserver(() => draw());
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => { off(); observer.disconnect(); };
  }, [api, draw]);

  const moveTo = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const current = layout.current;
    if (!current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const sceneX = current.region.x + (event.clientX - rect.left - current.offsetX) / current.scale;
    const sceneY = current.region.y + (event.clientY - rect.top - current.offsetY) / current.scale;
    const state = api.getAppState();
    api.updateScene({ appState: { scrollX: -(sceneX - state.width / state.zoom.value / 2), scrollY: -(sceneY - state.height / state.zoom.value / 2) } });
  };

  return <div className="whiteboard-minimap" role="img" aria-label={t("Minimap")}>
    <canvas ref={canvasRef}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); moveTo(event); }}
      onPointerMove={(event) => { if (event.buttons) moveTo(event); }} />
  </div>;
}
