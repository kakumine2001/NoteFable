import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

// 指でつかんで引っぱると、シートやドロワーが指についてきて、離したところで閉じる（または元に戻る）。
// axis "y" + direction 1 は下へ引いて閉じる底のシート、axis "x" + direction -1 は左へ引いて閉じるドロワー。
// 「つかむ場所」は bind を付けた要素（シートでは上の持ち手など）。動かす本体は ref を付けた要素。
type Options = { axis: "x" | "y"; direction: 1 | -1; onDismiss: () => void; focusOnAttach?: boolean };

// 移動量が本体の大きさのこの割合を超えるか、十分な速さで離すと閉じる。
const DISTANCE_RATIO = 0.33;
const FLICK_SPEED = 0.5; // px/ms
const MIN_FLICK_DISTANCE = 24;
const START_SLOP = 8;

type Drag = { id: number; start: number; cross: number; last: number; lastTime: number; speed: number; active: boolean };

export function useSwipeDismiss<T extends HTMLElement>({ axis, direction, onDismiss, focusOnAttach = false }: Options) {
  const target = useRef<T>(null);
  const drag = useRef<Drag | null>(null);
  const dismiss = useRef(onDismiss);
  const timer = useRef<number | undefined>(undefined);
  const settling = useRef(false);
  useEffect(() => { dismiss.current = onDismiss; });
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    // 横向きだと分かるまでは capture しない。その間に指が外へ出て離れても、次のタッチを妨げない。
    const releaseUnclaimed = (event: PointerEvent) => {
      const current = drag.current;
      if (current?.id === event.pointerId && !current.active) drag.current = null;
    };
    window.addEventListener("pointerup", releaseUnclaimed);
    window.addEventListener("pointercancel", releaseUnclaimed);
    return () => {
      window.removeEventListener("pointerup", releaseUnclaimed);
      window.removeEventListener("pointercancel", releaseUnclaimed);
    };
  }, []);

  const position = (event: ReactPointerEvent) => (axis === "y" ? event.clientY : event.clientX);
  const across = (event: ReactPointerEvent) => (axis === "y" ? event.clientX : event.clientY);
  const parentOf = () => target.current?.parentElement ?? null;

  function render(offset: number) {
    const element = target.current;
    if (!element) return;
    const size = axis === "y" ? element.offsetHeight : element.offsetWidth;
    element.style.transform = axis === "y" ? `translateY(${direction * offset}px)` : `translateX(${direction * offset}px)`;
    parentOf()?.style.setProperty("--swipe-progress", String(Math.min(1, size ? offset / size : 0)));
  }

  function begin(event: ReactPointerEvent) {
    const element = target.current;
    const current = drag.current;
    if (!element || !current) return;
    current.active = true;
    // 出入りのアニメーションは、動かしている間は止める（止めないと transform が上書きされる）。
    element.style.animation = "none";
    element.style.transition = "none";
    parentOf()?.classList.add("is-swiping");
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function finish(dismissed: boolean) {
    const element = target.current;
    if (!element) return;
    const parent = parentOf();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    settling.current = true;
    parent?.classList.add("is-settling");
    if (dismissed) {
      if (reduced) { dismiss.current(); return; }
      element.style.transition = "transform 200ms cubic-bezier(0.23, 1, 0.32, 1)";
      element.style.transform = axis === "y" ? `translateY(${direction * 100}%)` : `translateX(${direction * 100}%)`;
      parent?.style.setProperty("--swipe-progress", "1");
      timer.current = window.setTimeout(() => dismiss.current(), 190);
      return;
    }
    // 戻るときは少しだけ行き過ぎて止まる、ばねのような動き。
    element.style.transition = reduced ? "none" : "transform 340ms cubic-bezier(0.34, 1.45, 0.64, 1)";
    element.style.transform = axis === "y" ? "translateY(0px)" : "translateX(0px)";
    parent?.style.setProperty("--swipe-progress", "0");
    timer.current = window.setTimeout(() => {
      element.style.transition = "";
      element.style.transform = "";
      settling.current = false;
      parent?.classList.remove("is-swiping", "is-settling");
      parent?.style.removeProperty("--swipe-progress");
    }, reduced ? 0 : 360);
  }

  const bind = {
    onPointerDown(event: ReactPointerEvent) {
      if (settling.current || drag.current) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (axis === "x" && (event.target as HTMLElement).closest("input, textarea, select, [contenteditable=true], [role=slider]")) return;
      window.clearTimeout(timer.current);
      drag.current = { id: event.pointerId, start: position(event), cross: across(event), last: position(event), lastTime: event.timeStamp, speed: 0, active: false };
      // 持ち手を直接つかむ底のシートは、すぐに動かし始める。ドロワーは動き方が横向きだと分かってから。
      if (axis === "y") begin(event);
    },
    onPointerMove(event: ReactPointerEvent) {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      const along = (position(event) - current.start) * direction;
      if (!current.active) {
        const side = Math.abs(across(event) - current.cross);
        if (along > START_SLOP && along > side) begin(event);
        else return;
      }
      const elapsed = Math.max(1, event.timeStamp - current.lastTime);
      // 速さはなめらかにならす（1 回ごとの揺れで勘違いしないように）。
      current.speed = current.speed * 0.6 + (((position(event) - current.last) * direction) / elapsed) * 0.4;
      current.last = position(event);
      current.lastTime = event.timeStamp;
      render(Math.max(0, along));
    },
    onPointerUp(event: ReactPointerEvent) {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      drag.current = null;
      if (!current.active) return;
      const element = target.current;
      if (!element) return;
      const size = axis === "y" ? element.offsetHeight : element.offsetWidth;
      const offset = Math.max(0, (position(event) - current.start) * direction);
      finish(offset > size * DISTANCE_RATIO || (current.speed > FLICK_SPEED && offset > MIN_FLICK_DISTANCE));
    },
    onPointerCancel(event: ReactPointerEvent) {
      const current = drag.current;
      if (current && current.id !== event.pointerId) return;
      drag.current = null;
      if (current?.active) finish(false);
    },
  };

  // 動かす要素を渡すためのコールバック ref（要素の ref に渡す）。
  const attach = useCallback((element: T | null) => {
    if (target.current === element) return;
    window.clearTimeout(timer.current);
    drag.current = null;
    settling.current = false;
    const previous = target.current;
    if (previous) {
      previous.style.transform = "";
      previous.style.transition = "";
      previous.style.animation = "";
      previous.parentElement?.classList.remove("is-swiping", "is-settling");
      previous.parentElement?.style.removeProperty("--swipe-progress");
    }
    target.current = element;
    if (focusOnAttach) element?.focus();
  }, [focusOnAttach]);
  return { attach, bind };
}
