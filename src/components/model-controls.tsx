"use client";

import { ChevronDown } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  getModelOption,
  MODEL_OPTIONS,
  type ReasoningEffort,
} from "@/lib/models";
import {
  getReasoningSliderPositions,
  pointerPositionFromClientX,
  snapReasoningEffort,
  stepReasoningEffort,
} from "@/lib/reasoning-slider";

// 推論強度の短い表示名。ボタン内とメニュー内で共通利用する。
const reasoningLabels: Record<string, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
};

// 各推論強度の補足説明。スライダーのアクセシブル名とツールチップに使う。
const reasoningDescriptions: Record<string, string> = {
  none: "No reasoning",
  low: "Light reasoning",
  medium: "Balanced for most tasks",
  high: "Better for complex work",
  xhigh: "Very deep reasoning",
  max: "Maximum reasoning depth",
};

const PARTICLE_COUNT = 14;
const PARTICLE_TRAVEL_SECONDS = 1.9;
const WHEEL_STEP_THRESHOLD = 30;
const WHEEL_RESET_MS = 160;

function seededFraction(index: number, seed: number) {
  const value = Math.sin((index + 1) * 12.9898 + seed * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

// Codex と同じ範囲で速度・位置をずらし、初期表示から粒子が分散するようにする。
const reasoningParticles = Array.from({ length: PARTICLE_COUNT }, (_, index) => {
  const speedScale = 1 + (seededFraction(index, 21) - 0.5) * 0.4;
  const duration = PARTICLE_TRAVEL_SECONDS / speedScale;

  return {
    duration,
    opacity: 0.4 + seededFraction(index, 11) * 0.6,
    scale: 0.5 + seededFraction(index, 12) * 0.45,
    stagger: index * (PARTICLE_TRAVEL_SECONDS / PARTICLE_COUNT),
    top: 12 + seededFraction(index, 23) * 76,
  };
});

function formatReasoningLabel(value: string, provider: string) {
  void provider;
  return reasoningLabels[value] ?? value;
}

export function ModelSelect({
  value,
  reasoning,
  onModelChange,
  onReasoningChange,
}: {
  value: string;
  reasoning: string;
  onModelChange: (value: string) => void;
  onReasoningChange: (value: string) => void;
}) {
  // モデル選択と推論強度を同じピルから別々に開く。
  const [openPanel, setOpenPanel] = useState<"models" | "reasoning" | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const modelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const reasoningTriggerRef = useRef<HTMLButtonElement | null>(null);
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLSpanElement | null>(null);
  const pointerActiveRef = useRef(false);
  const wheelStateRef = useRef({ accumulatedDelta: 0, lastEventTime: 0 });
  const currentModel = getModelOption(value);
  const currentReasoningLabel = formatReasoningLabel(reasoning, currentModel.provider);
  const supportedEfforts = currentModel.reasoningEfforts;
  const fallbackEffort = supportedEfforts.includes(reasoning as ReasoningEffort)
    ? (reasoning as ReasoningEffort)
    : currentModel.defaultReasoning;
  const [previewEffort, setPreviewEffort] = useState<ReasoningEffort | null>(null);
  const [pointerDown, setPointerDown] = useState(false);
  const visualEffort = previewEffort ?? fallbackEffort;
  const sliderPositions = getReasoningSliderPositions(supportedEfforts);
  const sliderPosition = sliderPositions[visualEffort];
  const thumbEdgeOffset = 13 - sliderPosition * 0.26;
  const fillSize = `calc(${sliderPosition}% + ${thumbEdgeOffset}px)`;
  const reasoningStyle = {
    "--reasoning-progress": `${sliderPosition}%`,
    "--reasoning-edge-offset": `${thumbEdgeOffset}px`,
    "--reasoning-fill-size": fillSize,
  } as CSSProperties;
  const latestEffortRef = useRef<ReasoningEffort>(fallbackEffort);
  const supportedEffortsRef = useRef(supportedEfforts);
  const onReasoningChangeRef = useRef(onReasoningChange);

  useEffect(() => {
    latestEffortRef.current = visualEffort;
    supportedEffortsRef.current = supportedEfforts;
    onReasoningChangeRef.current = onReasoningChange;
  }, [onReasoningChange, supportedEfforts, visualEffort]);

  useEffect(() => {
    function resetAndClose() {
      pointerActiveRef.current = false;
      setPointerDown(false);
      setPreviewEffort(null);
      setOpenPanel(null);
    }

    function closeOnOutsideClick(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        resetAndClose();
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;

      event.preventDefault();
      const trigger = openPanel === "reasoning" ? reasoningTriggerRef : modelTriggerRef;
      resetAndClose();
      trigger.current?.focus();
    }

    if (openPanel) {
      document.addEventListener("mousedown", closeOnOutsideClick);
      document.addEventListener("keydown", closeOnEscape);
    }

    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openPanel]);

  useEffect(() => {
    if (openPanel !== "reasoning") return;
    const slider = sliderRef.current;
    if (!slider) return;

    function handleWheel(event: WheelEvent) {
      if (event.ctrlKey) return;

      let delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : -event.deltaY;
      if (
        "webkitDirectionInvertedFromDevice" in event &&
        event.webkitDirectionInvertedFromDevice === true
      ) {
        delta *= -1;
      }
      if (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) {
        delta = Math.sign(delta) * WHEEL_STEP_THRESHOLD;
      }
      if (delta === 0) return;

      event.preventDefault();
      const wheelState = wheelStateRef.current;
      if (
        event.timeStamp - wheelState.lastEventTime > WHEEL_RESET_MS ||
        Math.sign(delta) !== Math.sign(wheelState.accumulatedDelta)
      ) {
        wheelState.accumulatedDelta = 0;
      }
      wheelState.lastEventTime = event.timeStamp;
      wheelState.accumulatedDelta += delta;
      if (Math.abs(wheelState.accumulatedDelta) < WHEEL_STEP_THRESHOLD) return;

      const direction = Math.sign(wheelState.accumulatedDelta);
      wheelState.accumulatedDelta -= direction * WHEEL_STEP_THRESHOLD;
      const nextEffort = stepReasoningEffort(
        latestEffortRef.current,
        supportedEffortsRef.current,
        direction > 0 ? "increase" : "decrease",
      );
      if (!nextEffort || nextEffort === latestEffortRef.current) {
        wheelState.accumulatedDelta = 0;
        return;
      }

      latestEffortRef.current = nextEffort;
      onReasoningChangeRef.current(nextEffort);
    }

    slider.addEventListener("wheel", handleWheel, { passive: false });
    return () => slider.removeEventListener("wheel", handleWheel);
  }, [openPanel]);

  useEffect(() => {
    if (openPanel !== "models") return;

    const frame = window.requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLButtonElement>(".codex-model-option.is-selected")
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [openPanel]);

  function emitReasoning(effort: ReasoningEffort) {
    if (latestEffortRef.current === effort) return;
    latestEffortRef.current = effort;
    onReasoningChange(effort);
  }

  function selectReasoningFromPointer(clientX: number) {
    const track = trackRef.current;
    if (!track) return;

    const bounds = track.getBoundingClientRect();
    const position = pointerPositionFromClientX(
      clientX,
      bounds.left,
      bounds.width,
    );
    const nextEffort = snapReasoningEffort(
      position,
      supportedEfforts,
      sliderPositions,
    );
    if (nextEffort) {
      setPreviewEffort(nextEffort);
      emitReasoning(nextEffort);
    }
  }

  function finishPointerInteraction() {
    pointerActiveRef.current = false;
    setPointerDown(false);
    setPreviewEffort(null);
  }

  function closePanels() {
    finishPointerInteraction();
    setOpenPanel(null);
  }

  function togglePanel(panel: "models" | "reasoning") {
    finishPointerInteraction();
    setOpenPanel(openPanel === panel ? null : panel);
  }

  function handleModelMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      closePanels();
      return;
    }

    const options = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(".codex-model-option"),
    );
    if (options.length === 0) return;

    const activeIndex = options.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;

    if (event.key === "ArrowDown") {
      nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % options.length;
    } else if (event.key === "ArrowUp") {
      nextIndex =
        activeIndex < 0 ? options.length - 1 : (activeIndex - 1 + options.length) % options.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = options.length - 1;
    }

    if (nextIndex == null) return;
    event.preventDefault();
    options[nextIndex]?.focus();
  }

  return (
    <div ref={menuRef} className="relative z-40 min-w-0 shrink-0" data-testid="model-select">
      <div
        className={`codex-model-trigger max-w-48 sm:max-w-none ${openPanel ? "is-open" : ""}`}
      >
        <button
          ref={modelTriggerRef}
          type="button"
          className="codex-model-name"
          onClick={() => togglePanel("models")}
          aria-haspopup="menu"
          aria-expanded={openPanel === "models"}
        >
          <span className="truncate">{currentModel.label}</span>
        </button>
        <button
          ref={reasoningTriggerRef}
          type="button"
          className="codex-reasoning-trigger"
          onClick={() => togglePanel("reasoning")}
          aria-haspopup="dialog"
          aria-expanded={openPanel === "reasoning"}
          aria-label={`Reasoning effort: ${currentReasoningLabel}`}
        >
          <span>{currentReasoningLabel}</span>
          <ChevronDown
            className={`codex-model-chevron ${
              openPanel === "reasoning" ? "rotate-180" : ""
            }`}
            size={16}
          />
        </button>
      </div>

      {openPanel && (
        <div
          className={`codex-model-menu fixed bottom-24 left-2 z-30 sm:absolute sm:bottom-full sm:left-0 sm:right-auto sm:mb-2 ${
            openPanel === "reasoning"
              ? "codex-reasoning-menu"
              : "right-2 sm:w-64"
          }`}
          role={openPanel === "reasoning" ? "dialog" : "menu"}
          aria-label={openPanel === "reasoning" ? "Reasoning settings" : "Model"}
          onKeyDown={
            openPanel === "models" ? handleModelMenuKeyDown : undefined
          }
        >
          {openPanel === "reasoning" ? (
            <div className="codex-advanced-panel" data-pointer-down={pointerDown}>
              <>
                <div className="codex-slider-header" aria-hidden="true">
                  <div className="codex-slider-endpoints">
                    <span>Faster</span>
                    <span>Smarter</span>
                  </div>
                  <div className="codex-slider-current">
                    {formatReasoningLabel(
                      visualEffort,
                      currentModel.provider,
                    )}
                  </div>
                </div>

                <div
                  ref={sliderRef}
                  className="codex-reasoning-slider"
                  style={reasoningStyle}
                  data-dragging={pointerDown}
                  data-no-reasoning={visualEffort === "none"}
                  role="slider"
                  tabIndex={0}
                  aria-label="Reasoning effort"
                  aria-valuemin={0}
                  aria-valuemax={supportedEfforts.length - 1}
                  aria-valuenow={Math.max(
                    0,
                    supportedEfforts.indexOf(visualEffort),
                  )}
                  aria-valuetext={`${formatReasoningLabel(visualEffort, currentModel.provider)}: ${reasoningDescriptions[visualEffort]}`}
                  title={`${formatReasoningLabel(visualEffort, currentModel.provider)} — ${reasoningDescriptions[visualEffort]}`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.currentTarget.focus();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    pointerActiveRef.current = true;
                    setPointerDown(true);
                    selectReasoningFromPointer(event.clientX);
                  }}
                  onPointerMove={(event) => {
                    if (!pointerActiveRef.current) return;
                    selectReasoningFromPointer(event.clientX);
                  }}
                  onPointerUp={(event) => {
                    selectReasoningFromPointer(event.clientX);
                    if (
                      event.currentTarget.hasPointerCapture(event.pointerId)
                    ) {
                      event.currentTarget.releasePointerCapture(
                        event.pointerId,
                      );
                    }
                    finishPointerInteraction();
                  }}
                  onPointerCancel={finishPointerInteraction}
                  onLostPointerCapture={finishPointerInteraction}
                  onKeyDown={(event) => {
                    let nextEffort: ReasoningEffort | null = null;
                    if (
                      event.key === "ArrowLeft" ||
                      event.key === "ArrowDown"
                    ) {
                      nextEffort = stepReasoningEffort(
                        latestEffortRef.current,
                        supportedEfforts,
                        "decrease",
                      );
                    } else if (
                      event.key === "ArrowRight" ||
                      event.key === "ArrowUp"
                    ) {
                      nextEffort = stepReasoningEffort(
                        latestEffortRef.current,
                        supportedEfforts,
                        "increase",
                      );
                    } else if (event.key === "Home") {
                      nextEffort = supportedEfforts[0] ?? null;
                    } else if (event.key === "End") {
                      nextEffort = supportedEfforts.at(-1) ?? null;
                    } else {
                      return;
                    }

                    event.preventDefault();
                    if (nextEffort) emitReasoning(nextEffort);
                  }}
                >
                  <span
                    ref={trackRef}
                    className="codex-reasoning-track"
                    aria-hidden="true"
                  >
                    <span className="codex-reasoning-track-fill" />
                    <span className="codex-reasoning-particle-clip">
                      <span className="codex-reasoning-particles">
                        {reasoningParticles.map((particle, index) => {
                          const delay =
                            particle.stagger -
                            particle.duration * (1 - sliderPosition / 100);
                          const particleStyle = {
                            "--particle-delay": `${delay}s`,
                            "--particle-duration": `${particle.duration}s`,
                            "--particle-opacity": particle.opacity,
                            "--particle-scale": particle.scale,
                            "--particle-top": `${particle.top}%`,
                          } as CSSProperties;

                          return (
                            <span
                              key={index}
                              className="codex-reasoning-particle-path"
                              style={particleStyle}
                            >
                              <i />
                            </span>
                          );
                        })}
                      </span>
                    </span>
                    <span className="codex-reasoning-ticks">
                      {supportedEfforts.map((effort) => {
                        const position = sliderPositions[effort];
                        const offset = 13 - position * 0.26;

                        return (
                          <i
                            key={effort}
                            data-selected={position <= sliderPosition}
                            style={{
                              left: `calc(${position}% + ${offset}px)`,
                            }}
                          />
                        );
                      })}
                    </span>
                  </span>
                  <span
                    className="codex-reasoning-thumb"
                    aria-hidden="true"
                  />
                </div>
              </>
            </div>
          ) : (
            <div className="codex-model-options">
              {MODEL_OPTIONS.map((item) => {
                const selected = item.id === value;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onModelChange(item.id);
                      closePanels();
                      modelTriggerRef.current?.focus();
                    }}
                    className={`codex-model-option ${selected ? "is-selected" : ""}`}
                    role="menuitemradio"
                    aria-checked={selected}
                    tabIndex={selected ? 0 : -1}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
