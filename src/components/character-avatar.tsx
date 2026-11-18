"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { ResolvedAppIcon } from "@/lib/app-icon";
import {
  CHARACTER_HERO_VIEWBOX,
  CHARACTER_ICON_VIEWBOX,
  DEFAULT_CHARACTER_ID,
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

function hasDataUrlPayload(dataUrl: string): boolean {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 && comma + 1 < dataUrl.length;
}

function CustomCharacterImageOrFallback({
  dataUrl,
  size,
  state,
  hero,
  animated,
  className,
}: {
  dataUrl: string;
  size: number;
  state: CharacterState;
  hero: boolean;
  animated: boolean;
  className?: string;
}) {
  const [failedDataUrl, setFailedDataUrl] = useState<string | null>(null);
  const markFailed = useCallback(() => setFailedDataUrl(dataUrl), [dataUrl]);
  const checkImmediateFailure = useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth === 0) {
      setFailedDataUrl(dataUrl);
    }
  }, [dataUrl]);

  if (!hasDataUrlPayload(dataUrl) || failedDataUrl === dataUrl) {
    return (
      <CharacterGraphic
        characterId={DEFAULT_CHARACTER_ID}
        size={size}
        state={state}
        hero={hero}
        animated={animated}
        className={className}
      />
    );
  }

  if (hero) {
    return (
      <span className="nf-mascot-custom-wrap" style={{ width: size, height: size * 1.0625 }} aria-hidden="true">
        {/* data URL のカスタムアイコンなので next/image の最適化は通さない。デコード失敗時は既定の Quill へ戻す。 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={dataUrl}
          ref={checkImmediateFailure}
          className="nf-mascot-custom"
          src={dataUrl}
          alt=""
          width={size}
          height={size}
          draggable={false}
          onError={markFailed}
        />
      </span>
    );
  }

  // data URL の小さな画像なので、next/image の最適化は通さない。デコード失敗時は既定の Quill へ戻す。
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={dataUrl}
      ref={checkImmediateFailure}
      className="app-icon-image"
      src={dataUrl}
      alt=""
      width={size}
      height={size}
      draggable={false}
      onError={markFailed}
    />
  );
}

// カスタム画像と 7 キャラクターを共通で描き分けるスロット。
// 破損した data URL のデコードに失敗した場合は既定キャラクター（Quill）へフォールバックし、保存画像が変わったら再試行する。
export function ResolvedCharacterAvatar({
  resolved,
  size = 24,
  state = "idle",
  hero = false,
  animated = false,
  className,
}: {
  resolved: ResolvedAppIcon;
  size?: number;
  state?: CharacterState;
  hero?: boolean;
  animated?: boolean;
  className?: string;
}) {
  if (resolved.kind === "image") {
    return (
      <CustomCharacterImageOrFallback
        dataUrl={resolved.dataUrl}
        size={size}
        state={state}
        hero={hero}
        animated={animated}
        className={className}
      />
    );
  }

  return (
    <CharacterGraphic
      characterId={resolved.characterId}
      size={size}
      state={state}
      hero={hero}
      animated={animated}
      className={className}
    />
  );
}
