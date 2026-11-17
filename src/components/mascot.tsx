"use client";

import { useEffect, useRef } from "react";
import { MASCOT_BODY, MASCOT_EYES, MASCOT_FLAP } from "@/components/notefable-logo";

// 空の会話に出すキャラクター。ふわりと浮き、まばたきし、目がポインターを追う。
// lookDown のとき（入力欄に文字があるとき）は下の入力欄を見る。飾りなので読み上げない。
export function Mascot({ size = 64, lookDown = false }: { size?: number; lookDown?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current;
    if (!svg || lookDown) return;
    // 指で触る端末にはポインターの位置が無い。動きを減らす設定でも追わない。
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let x = 0;
    let y = 0;
    const update = () => {
      frame = 0;
      const rect = svg.getBoundingClientRect();
      // ノートの画面に切り替えているあいだは表示されていない（大きさが 0）。
      if (!rect.width) return;
      const dx = x - (rect.left + rect.width / 2);
      const dy = y - (rect.top + rect.height * 0.58);
      const distance = Math.hypot(dx, dy);
      // 近いほど小さく、240px 以上離れると目いっぱい（横 2.4・縦 2）寄る。
      const reach = Math.min(1, distance / 240) / (distance || 1);
      svg.style.setProperty("--ex", (dx * reach * 2.4).toFixed(2));
      svg.style.setProperty("--ey", (dy * reach * 2).toFixed(2));
    };
    const onMove = (event: PointerEvent) => {
      x = event.clientX;
      y = event.clientY;
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
      svg.style.removeProperty("--ex");
      svg.style.removeProperty("--ey");
    };
  }, [lookDown]);

  return (
    <svg ref={ref} className="nf-mascot" data-look={lookDown ? "down" : undefined} width={size} height={size * 1.0625} viewBox="0 0 64 68" aria-hidden="true">
      <ellipse className="nf-mascot-shadow" cx="32" cy="63.5" rx="15" ry="2.2" />
      <g className="nf-mascot-enter">
        <g className="nf-mascot-float">
          <path d={MASCOT_BODY} />
          <path className="nf-mascot-flap" d={MASCOT_FLAP} />
          <g className="nf-mascot-eyes">
            {MASCOT_EYES.map((eyeX) => <rect key={eyeX} className="nf-mascot-eye" x={eyeX} y="33" width="5" height="9" rx="2.5" />)}
          </g>
        </g>
      </g>
    </svg>
  );
}
