import type { ReasoningEffort } from "@/lib/models";

export const REASONING_SLIDER_POSITIONS: Record<ReasoningEffort, number> = {
  none: 0,
  minimal: 10,
  low: 20,
  medium: 40,
  high: 60,
  xhigh: 80,
  max: 100,
};

export function clampSliderPosition(position: number) {
  return Math.min(100, Math.max(0, position));
}

export function pointerPositionFromClientX(
  clientX: number,
  trackLeft: number,
  trackWidth: number,
  thumbDiameter = 28,
) {
  const usableWidth = trackWidth - thumbDiameter;
  if (!Number.isFinite(usableWidth) || usableWidth <= 0) return 0;

  const start = trackLeft + thumbDiameter / 2;
  return clampSliderPosition(((clientX - start) / usableWidth) * 100);
}

export function snapReasoningEffort(
  position: number,
  efforts: readonly ReasoningEffort[],
) {
  if (efforts.length === 0) return null;

  const clampedPosition = clampSliderPosition(position);
  return efforts.reduce((closest, effort) => {
    const distance = Math.abs(REASONING_SLIDER_POSITIONS[effort] - clampedPosition);
    const closestDistance = Math.abs(
      REASONING_SLIDER_POSITIONS[closest] - clampedPosition,
    );
    return distance < closestDistance ? effort : closest;
  });
}

export function stepReasoningEffort(
  current: ReasoningEffort,
  efforts: readonly ReasoningEffort[],
  direction: "decrease" | "increase",
) {
  if (efforts.length === 0) return null;

  const currentIndex = Math.max(0, efforts.indexOf(current));
  const nextIndex =
    direction === "increase"
      ? Math.min(currentIndex + 1, efforts.length - 1)
      : Math.max(currentIndex - 1, 0);
  return efforts[nextIndex] ?? null;
}
