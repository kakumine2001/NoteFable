"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import {
  CHARACTER_HERO_VIEWBOX,
  CHARACTER_ICON_VIEWBOX,
  getCharacterDefinition,
  type CharacterId,
  type CharacterLayerPath,
  type CharacterState,
} from "@/lib/characters";

function PathItem({ item }: { item: CharacterLayerPath }) {
  return (
    <path
      d={item.d}
      fill={item.fill ?? "none"}
      stroke={item.stroke}
      strokeWidth={item.strokeWidth}
      strokeLinecap={item.strokeLinecap}
      strokeLinejoin={item.strokeLinejoin}
      fillRule={item.fillRule}
    />
  );
}

export type CharacterGraphicProps = {
  characterId: CharacterId;
  size?: number;
  state?: CharacterState;
  hero?: boolean;
  animated?: boolean;
  className?: string;
};

// 全 7 キャラクター共通のベクター描画＋状態アニメーションコンポーネント。
// 飾り要素のため aria-hidden="true" とし、呼び出し側で必要なラベルを付与する。
export function CharacterGraphic({
  characterId,
  size = 24,
  state = "idle",
  hero = false,
  animated = false,
  className,
}: CharacterGraphicProps) {
  const ref = useRef<SVGSVGElement>(null);
  const def = getCharacterDefinition(characterId);
  const { motion } = def;
  const effectiveAnimated = animated && state !== "hidden";

  useEffect(() => {
    const svg = ref.current;
    if (!svg || !hero || !effectiveAnimated || state !== "idle") return;
    if (typeof window.matchMedia !== "function") return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let pointerX = 0;
    let pointerY = 0;
    const update = () => {
      frame = 0;
      const rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      const dx = pointerX - (rect.left + rect.width / 2);
      const dy = pointerY - (rect.top + rect.height * 0.56);
      const distance = Math.hypot(dx, dy);
      const reach = Math.min(1, distance / 240) / (distance || 1);
      svg.style.setProperty("--ex", (dx * reach * 7.5).toFixed(2));
      svg.style.setProperty("--ey", (dy * reach * 6.2).toFixed(2));
    };
    const onMove = (event: PointerEvent) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.cancelAnimationFrame(frame);
      svg.style.removeProperty("--ex");
      svg.style.removeProperty("--ey");
    };
  }, [hero, effectiveAnimated, state]);

  const floatScale = hero ? 1 : 0.42;
  const style = {
    "--cf-float-y": `${-(motion.floatAmplitude * floatScale).toFixed(2)}px`,
    "--cf-float-ms": `${motion.floatDurationMs}ms`,
    "--cf-idle-tilt": `${motion.idleBodyTiltDeg}deg`,
    "--cf-accent-idle": `${motion.idleAccentDeg}deg`,
    "--cf-tilt-typing": `${motion.typingTiltDeg}deg`,
    "--cf-accent-typing": `${motion.typingAccentDeg}deg`,
    "--cf-gaze-typing": `${motion.typingGazeY}px`,
    "--cf-tilt-thinking": `${motion.thinkingTiltDeg}deg`,
    "--cf-accent-thinking": `${motion.thinkingAccentDeg}deg`,
    "--cf-gaze-thinking": `${motion.thinkingGazeX}px`,
    "--cf-tilt-responding": `${motion.respondingTiltDeg}deg`,
    "--cf-accent-responding": `${motion.respondingAccentDeg}deg`,
    "--cf-nod-completed": `${(motion.completedNodY * (hero ? 1 : 0.65)).toFixed(2)}px`,
    "--cf-accent-completed": `${motion.completedAccentDeg}deg`,
    "--cf-drop-error": `${(motion.errorDropY * (hero ? 1 : 0.65)).toFixed(2)}px`,
    "--cf-tilt-error": `${motion.errorTiltDeg}deg`,
    "--cf-accent-error": `${motion.errorAccentDeg}deg`,
  } as CSSProperties;

  const pivotStyle: CSSProperties = {
    transformOrigin: `${def.accentPivot.x}px ${def.accentPivot.y}px`,
    transformBox: "view-box",
  };
  const bodyOriginStyle: CSSProperties = {
    transformOrigin: "120px 195px",
    transformBox: "view-box",
  };

  const content = (
    <g className="nf-char-actor" style={bodyOriginStyle}>
      {def.backAccentPaths.length > 0 && (
        <g className="nf-char-accent" style={pivotStyle}>
          {def.backAccentPaths.map((item, idx) => (
            <PathItem key={idx} item={item} />
          ))}
        </g>
      )}
      <g className="nf-char-body">
        {def.bodyPaths.map((item, idx) => (
          <PathItem key={idx} item={item} />
        ))}
      </g>
      {def.frontAccentPaths.length > 0 && (
        <g className="nf-char-accent" style={pivotStyle}>
          {def.frontAccentPaths.map((item, idx) => (
            <PathItem key={idx} item={item} />
          ))}
        </g>
      )}
      <g className="nf-char-gaze">
        {def.eyes.map((eye, idx) => {
          const eyeOrigin: CSSProperties = {
            transformOrigin: `${eye.cx}px ${eye.cy}px`,
            transformBox: "view-box",
          };
          if (eye.kind === "capsule") {
            return (
              <g key={idx} className="nf-char-eye" style={eyeOrigin}>
                <rect
                  x={eye.x}
                  y={eye.y}
                  width={eye.width}
                  height={eye.height}
                  rx={eye.rx}
                  fill={eye.fill}
                  transform={eye.rotation ? `rotate(${eye.rotation} ${eye.cx} ${eye.cy})` : undefined}
                />
              </g>
            );
          }
          return (
            <g key={idx} className="nf-char-eye" style={eyeOrigin}>
              <path d={eye.d} fill={eye.fill} />
            </g>
          );
        })}
      </g>
    </g>
  );

  return (
    <svg
      ref={ref}
      className={`nf-char${hero ? " is-hero" : ""}${className ? ` ${className}` : ""}`}
      data-character={characterId}
      data-state={state}
      data-animated={effectiveAnimated ? "true" : "false"}
      width={size}
      height={hero ? size * 1.0625 : size}
      viewBox={hero ? CHARACTER_HERO_VIEWBOX : CHARACTER_ICON_VIEWBOX}
      fill="none"
      style={style}
      aria-hidden="true"
    >
      {hero ? (
        <>
          <ellipse
            className="nf-char-shadow"
            cx="120"
            cy="226"
            rx={def.shadowRx}
            ry="7.5"
            style={{ transformOrigin: "120px 226px", transformBox: "view-box" }}
          />
          <g className="nf-char-enter" style={{ transformOrigin: "120px 206px", transformBox: "view-box" }}>
            {content}
          </g>
        </>
      ) : (
        content
      )}
    </svg>
  );
}
