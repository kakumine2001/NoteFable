import type { PointerEvent as ReactPointerEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const effects = vi.hoisted(() => ({ cleanups: [] as (() => void)[] }));
vi.mock("react", () => ({
  useRef: (current: unknown) => ({ current }),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (cleanup) effects.cleanups.push(cleanup);
  },
}));
import { useSwipeDismiss } from "./use-swipe-dismiss";

function setup() {
  const listeners = new Map<string, (event: { pointerId: number }) => void>();
  vi.stubGlobal("window", {
    setTimeout, clearTimeout,
    matchMedia: () => ({ matches: false }),
    addEventListener: (name: string, callback: (event: { pointerId: number }) => void) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  const parent = { classList: { add: vi.fn(), remove: vi.fn() }, style: { setProperty: vi.fn(), removeProperty: vi.fn() } };
  const element = { offsetWidth: 240, offsetHeight: 500, style: { transform: "", transition: "", animation: "" }, parentElement: parent };
  const dismiss = vi.fn();
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Hook primitives are mocked above to exercise pointer ownership without a DOM renderer.
  const swipe = useSwipeDismiss<HTMLDivElement>({ axis: "x", direction: -1, onDismiss: dismiss });
  swipe.attach(element as unknown as HTMLDivElement);
  const pointer = (id: number, x: number, timeStamp = 0) => ({
    pointerId: id, clientX: x, clientY: 100, pointerType: "touch", button: 0, timeStamp,
    target: { closest: () => null }, currentTarget: { setPointerCapture: vi.fn() },
  }) as unknown as ReactPointerEvent;
  return { ...swipe, element, dismiss, pointer, listeners };
}

describe("swipe pointer ownership", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    effects.cleanups.splice(0).forEach((cleanup) => cleanup());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the first finger's drag alive when another finger is released", () => {
    const { bind, pointer, element, dismiss } = setup();
    bind.onPointerDown(pointer(1, 200));
    bind.onPointerMove(pointer(1, 140, 30));
    bind.onPointerDown(pointer(2, 200, 35));
    bind.onPointerUp(pointer(2, 200, 40));
    bind.onPointerMove(pointer(1, 100, 60));
    expect(element.style.transform).toBe("translateX(-100px)");
    bind.onPointerUp(pointer(1, 100, 70));
    vi.advanceTimersByTime(200);
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it("allows another drag after an unclaimed pointer ends outside the drawer", () => {
    const { bind, pointer, element, listeners } = setup();
    bind.onPointerDown(pointer(1, 238));
    // The drawer never receives this pointerup because it has not captured the pointer.
    listeners.get("pointerup")!({ pointerId: 1 });
    bind.onPointerDown(pointer(2, 200, 30));
    bind.onPointerMove(pointer(2, 130, 60));
    expect(element.style.transform).toBe("translateX(-70px)");
  });
});
