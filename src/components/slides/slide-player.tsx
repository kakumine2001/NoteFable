"use client";

import { ChevronLeft, ChevronRight, Minus, MonitorPlay, Pause, Play, Plus, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/i18n-provider";
import { SlideFrame } from "@/components/slides/slide-render";
import { useBackToClose } from "@/lib/use-back-to-close";
import { playerAction, type PlayerAction } from "@/lib/slides/player-keys";
import { slideTransitionClass, type Deck, type Slide } from "@/lib/slides/model";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// 放映：全画面で 1 枚ずつ見せる。キー（← → スペース PageUp/PageDown Home/End、Esc、数字 + Enter、B/W）、クリック・スワイプで送る。
// パソコンでは発表者ビュー（別のウィンドウ：今の枚・次の枚・ノート・経過時間）を開ける。アプリ（WebView）では全画面・横向き・画面の常時点灯をアプリが受け持つ。

export type PlayerControl = { next: () => void; previous: () => void; goTo: (index: number) => void; end: () => void };

// 送る順番：隠した枚は飛ばす。ただし、隠した枚から始めたときと番号で飛んだときは、その枚も見せる。
function playOrder(deck: Deck, include: string | null): Slide[] {
  return deck.slides.filter((slide) => !slide.hidden || slide.id === include);
}

function useViewportFrame(container: { current: HTMLElement | null }) {
  const [width, setWidth] = useState(960);
  useLayoutEffect(() => {
    const node = container.current;
    if (!node) return;
    const update = () => setWidth(Math.max(80, Math.min(node.clientWidth, (node.clientHeight * 16) / 9)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [container]);
  return width;
}

function formatTime(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (value: number) => String(value).padStart(2, "0");
  return hours ? `${hours}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`;
}

export function SlidePlayer({ deck, startId, onExit, onChange, allowPresenter = true, fullscreen = true, controlRef, header }: {
  deck: Deck;
  startId: string | null;
  onExit: () => void;
  // 見せている枚が変わった（index は全体の何枚目か、count は全体の枚数）。アプリへのページ番号の通知に使う。
  onChange?: (slide: Slide, index: number, count: number) => void;
  allowPresenter?: boolean;
  // ブラウザの全画面を使う（アプリの中ではアプリが全画面にするので使わない）。
  fullscreen?: boolean;
  controlRef?: { current: PlayerControl | null };
  header?: ReactNode;
}) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [currentId, setCurrentId] = useState<string | null>(() => startId ?? deck.slides.find((slide) => !slide.hidden)?.id ?? deck.slides[0]?.id ?? null);
  const [jumpedHidden, setJumpedHidden] = useState<string | null>(startId);
  // 初回表示ではアニメーションしない。ページ送りしたときだけ対象スライドのIDと向きを記録する。
  const [nav, setNav] = useState<{ slideId: string; direction: "forward" | "backward" } | null>(null);
  const order = useMemo(() => playOrder(deck, jumpedHidden), [deck, jumpedHidden]);
  const index = Math.max(0, order.findIndex((slide) => slide.id === currentId));
  const slide = order[index] ?? null;
  const [blank, setBlank] = useState<"black" | "white" | null>(null);
  const [digits, setDigits] = useState("");
  const [controlsVisible, setControlsVisible] = useState(true);
  const [presenter, setPresenter] = useState<Window | null>(null);
  const [startedAt] = useState(() => Date.now());
  const width = useViewportFrame(stage);
  // 呼び出し側は onExit を毎回作り直して渡す。全画面・常時点灯の効果が描き直しのたびにやり直されないよう、最新の値だけを持つ。
  const onExitRef = useRef(onExit);
  useLayoutEffect(() => { onExitRef.current = onExit; });
  // 発表者ビューのウィンドウを開くと、ブラウザは全画面を抜ける。そのときは放映を終えない。
  const presenterOpen = useRef(false);
  const digitsRef = useRef(digits);
  useLayoutEffect(() => { digitsRef.current = digits; });

  const go = useCallback((delta: number) => {
    setBlank(null);
    const nextIndex = Math.max(0, Math.min(order.length - 1, index + delta));
    const next = order[nextIndex];
    if (next && next.id !== slide?.id) {
      setNav({ slideId: next.id, direction: nextIndex > index ? "forward" : "backward" });
      setCurrentId(next.id);
    }
  }, [order, index, slide?.id]);
  // 番号は編集画面と同じ（隠した枚も数える）。隠した枚へも飛べる。
  const goToNumber = useCallback((number: number) => {
    const target = deck.slides[number - 1];
    if (!target) return;
    setBlank(null);
    if (target.id !== slide?.id) {
      const currentDeckIndex = slide ? deck.slides.findIndex((entry) => entry.id === slide.id) : -1;
      setNav({ slideId: target.id, direction: number - 1 >= currentDeckIndex ? "forward" : "backward" });
    }
    setJumpedHidden(target.hidden ? target.id : null);
    setCurrentId(target.id);
  }, [deck.slides, slide]);

  const exit = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    presenter?.close();
    onExitRef.current();
  }, [presenter]);
  // スマホのブラウザの「戻る」・Esc で放映を終える（番号を打っている途中の Esc は番号を消すだけ）。
  useBackToClose(true, () => {
    if (digitsRef.current) { setDigits(""); return false; }
    exit();
  });

  const act = useCallback((action: PlayerAction) => {
    switch (action.type) {
      case "next": go(1); break;
      case "previous": go(-1); break;
      case "first": {
        setBlank(null);
        const first = order[0];
        if (first && first.id !== slide?.id) setNav({ slideId: first.id, direction: "backward" });
        setCurrentId(first?.id ?? null);
        break;
      }
      case "last": {
        setBlank(null);
        const last = order[order.length - 1];
        if (last && last.id !== slide?.id) setNav({ slideId: last.id, direction: "forward" });
        setCurrentId(last?.id ?? null);
        break;
      }
      case "blank": setBlank((current) => (current === action.color ? null : action.color)); break;
      case "digit": setDigits((current) => (current + action.digit).slice(-4)); return;
      case "jump": if (digits) goToNumber(Number(digits)); setDigits(""); return;
      case "clearDigits": setDigits(""); return;
      case "exit": exit(); return;
    }
    setDigits("");
  }, [go, order, digits, goToNumber, exit, slide?.id]);

  useEffect(() => {
    const target = presenter ? [window, presenter] : [window];
    const onKey = (event: KeyboardEvent) => {
      // ボタン等にフォーカスがあるときのスペース・Enter はその操作に任せる。
      const onControl = event.target instanceof Element && !!event.target.closest("button, a, input, textarea, select, [role='button']");
      if (onControl && !digits.length && (event.key === " " || event.key === "Spacebar" || event.key === "Enter")) return;
      const action = playerAction(event, digits.length > 0);
      if (!action) return;
      event.preventDefault();
      act(action);
    };
    target.forEach((win) => win.addEventListener("keydown", onKey));
    return () => target.forEach((win) => win.removeEventListener("keydown", onKey));
  }, [act, digits, presenter]);

  useEffect(() => {
    if (controlRef) controlRef.current = { next: () => go(1), previous: () => go(-1), goTo: (number) => goToNumber(number), end: exit };
    return () => { if (controlRef) controlRef.current = null; };
  }, [controlRef, go, goToNumber, exit]);

  useEffect(() => {
    if (slide) onChange?.(slide, deck.slides.findIndex((entry) => entry.id === slide.id), deck.slides.length);
  }, [slide, deck.slides, onChange]);

  // 全画面（Esc などで抜けたら放映も終える）、画面の常時点灯、スマホの横向き。
  useEffect(() => {
    const node = root.current;
    let wakeLock: { release: () => Promise<void> } | null = null;
    const navigatorWithWake = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } };
    void navigatorWithWake.wakeLock?.request("screen").then((lock) => { wakeLock = lock; }).catch(() => {});
    let entered = false;
    const onFullscreen = () => {
      if (document.fullscreenElement) { entered = true; return; }
      if (entered && !presenterOpen.current) onExitRef.current();
    };
    if (fullscreen && node?.requestFullscreen) {
      document.addEventListener("fullscreenchange", onFullscreen);
      void node.requestFullscreen({ navigationUI: "hide" }).then(() => {
        const orientation = screen.orientation as ScreenOrientation & { lock?: (orientation: string) => Promise<void> };
        if (matchMedia("(pointer: coarse)").matches) void orientation.lock?.("landscape").catch(() => {});
      }).catch(() => {});
    }
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      void wakeLock?.release().catch(() => {});
      const orientation = screen.orientation as ScreenOrientation & { unlock?: () => void };
      try { orientation.unlock?.(); } catch { /* 固定していない */ }
    };
  }, [fullscreen]);

  // 操作のボタンは、マウスを動かしたときだけ少しの間出す。
  useEffect(() => {
    if (!controlsVisible) return;
    const timer = setTimeout(() => setControlsVisible(false), 2500);
    return () => clearTimeout(timer);
  }, [controlsVisible]);

  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);

  function openPresenter() {
    if (presenter && !presenter.closed) { presenter.focus(); return; }
    presenterOpen.current = true;
    const popup = window.open("", "notefable-presenter", "popup,width=1100,height=720");
    if (!popup) { presenterOpen.current = false; return; }
    popup.document.title = t("Presenter view");
    popup.document.documentElement.lang = document.documentElement.lang;
    popup.document.documentElement.dir = document.documentElement.dir;
    popup.document.documentElement.setAttribute("data-theme", document.documentElement.getAttribute("data-theme") ?? "light");
    popup.document.head.querySelectorAll("link[rel=stylesheet], style").forEach((node) => node.remove());
    document.head.querySelectorAll("link[rel=stylesheet], style").forEach((node) => popup.document.head.appendChild(node.cloneNode(true)));
    popup.document.body.className = "slides-presenter-body";
    popup.addEventListener("pagehide", () => { presenterOpen.current = false; setPresenter(null); });
    setPresenter(popup);
  }
  useEffect(() => {
    if (!presenter) return;
    const timer = setInterval(() => { if (presenter.closed) { presenterOpen.current = false; setPresenter(null); } }, 1000);
    return () => clearInterval(timer);
  }, [presenter]);
  useEffect(() => () => { presenter?.close(); }, [presenter]);

  const next = order[index + 1] ?? null;
  return <div ref={root} className={`slides-player${controlsVisible ? " show-controls" : ""}`} role="dialog" aria-modal="true" aria-label={t("Presentation")}
    onPointerMove={(event) => { if (event.pointerType === "mouse") setControlsVisible(true); }}>
    {header}
    <div ref={stage} className="slides-player-stage"
      onPointerDown={(event) => { swipe.current = { x: event.clientX, y: event.clientY, id: event.pointerId }; }}
      onPointerUp={(event) => {
        const start = swipe.current;
        swipe.current = null;
        if (!start || start.id !== event.pointerId || (event.target as HTMLElement).closest("a, button")) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { go(dx < 0 ? 1 : -1); return; }
        if (Math.hypot(dx, dy) > 10) return;
        // 指で押したときは左の 3 分の 1 で戻る。マウスはどこを押しても次へ。
        if (event.pointerType !== "mouse" && event.clientX < window.innerWidth / 3) go(-1);
        else go(1);
        if (event.pointerType !== "mouse") setControlsVisible(true);
      }}>
      {slide && <SlideFrame key={slide.id} slide={slide} width={width} link
        className={`slides-player-frame${nav?.slideId === slide.id ? ` ${slideTransitionClass(slide.transition, nav.direction, prefersReducedMotion())}` : ""}`.trim()} />}
      {!slide && <p className="slides-player-empty">{t("This deck has no slides to show.")}</p>}
      {blank && <div className={`slides-player-blank is-${blank}`} aria-label={blank === "black" ? t("Black screen") : t("White screen")} />}
      {digits && <div className="slides-player-digits" aria-live="polite">{t("Go to slide {number}", { number: digits })}</div>}
    </div>
    <div className="slides-player-controls">
      <button type="button" onClick={() => go(-1)} disabled={index <= 0} aria-label={t("Previous slide")} title={t("Previous slide")}><ChevronLeft size={20} className="rtl-mirror" /></button>
      <span className="slides-player-counter">{slide ? `${deck.slides.findIndex((entry) => entry.id === slide.id) + 1} / ${deck.slides.length}` : ""}</span>
      <button type="button" onClick={() => go(1)} disabled={index >= order.length - 1} aria-label={t("Next slide")} title={t("Next slide")}><ChevronRight size={20} className="rtl-mirror" /></button>
      {allowPresenter && <button type="button" onClick={openPresenter} aria-label={t("Presenter view")} title={t("Presenter view")}><MonitorPlay size={18} /></button>}
      <button type="button" onClick={exit} aria-label={t("End presentation")} title={t("End presentation")}><X size={20} /></button>
    </div>
    {presenter && createPortal(<PresenterConsole deck={deck} slide={slide} next={next} index={index} count={order.length} startedAt={startedAt}
      blank={blank} onBlank={(color) => setBlank((current) => (current === color ? null : color))} onGo={go} onExit={exit} />, presenter.document.body)}
  </div>;
}

// 発表者ビュー（別のウィンドウ）：今の枚、次の枚、演説者ノート（文字の大きさを変えられる）、経過時間と時刻。
function PresenterConsole({ deck, slide, next, index, count, startedAt, blank, onBlank, onGo, onExit }: {
  deck: Deck; slide: Slide | null; next: Slide | null; index: number; count: number; startedAt: number;
  blank: "black" | "white" | null; onBlank: (color: "black" | "white") => void; onGo: (delta: number) => void; onExit: () => void;
}) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  const [paused, setPaused] = useState<{ at: number; offset: number }>({ at: 0, offset: 0 });
  const [base, setBase] = useState(startedAt);
  const [noteSize, setNoteSize] = useState(22);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, []);
  const elapsed = (paused.at ? paused.at : now) - base - paused.offset;
  const number = slide ? deck.slides.findIndex((entry) => entry.id === slide.id) + 1 : 0;
  return <div className="slides-presenter" dir={document.documentElement.dir}>
    <div className="slides-presenter-main">
      <div className="slides-presenter-current">
        <div className="slides-presenter-label">{t("Slide {number} of {count}", { number, count: deck.slides.length })}</div>
        {slide && <SlideFrame slide={slide} width={640} />}
      </div>
      <div className="slides-presenter-side">
        <div className="slides-presenter-label">{t("Next")}</div>
        {next ? <SlideFrame slide={next} width={320} /> : <div className="slides-presenter-end">{t("End of presentation")}</div>}
        <div className="slides-presenter-timer">
          <div><span className="slides-presenter-label">{t("Elapsed")}</span><strong>{formatTime(elapsed)}</strong></div>
          <div><span className="slides-presenter-label">{t("Time")}</span><strong>{new Date(now).toLocaleTimeString(document.documentElement.lang || undefined, { hour: "2-digit", minute: "2-digit" })}</strong></div>
          <div className="slides-presenter-timer-buttons">
            <button type="button" onClick={() => setPaused((current) => (current.at ? { at: 0, offset: current.offset + (Date.now() - current.at) } : { at: Date.now(), offset: current.offset }))}
              aria-label={paused.at ? t("Resume timer") : t("Pause timer")} title={paused.at ? t("Resume timer") : t("Pause timer")}>{paused.at ? <Play size={16} /> : <Pause size={16} />}</button>
            <button type="button" onClick={() => { setBase(Date.now()); setPaused({ at: 0, offset: 0 }); }} aria-label={t("Reset timer")} title={t("Reset timer")}><RotateCcw size={16} /></button>
          </div>
        </div>
      </div>
    </div>
    <div className="slides-presenter-notes">
      <div className="slides-presenter-notes-head">
        <span className="slides-presenter-label">{t("Speaker notes")}</span>
        <button type="button" onClick={() => setNoteSize((size) => Math.max(12, size - 2))} aria-label={t("Smaller text")} title={t("Smaller text")}><Minus size={14} /></button>
        <button type="button" onClick={() => setNoteSize((size) => Math.min(48, size + 2))} aria-label={t("Larger text")} title={t("Larger text")}><Plus size={14} /></button>
      </div>
      <div className="slides-presenter-notes-text" style={{ fontSize: noteSize }}>{slide?.notes?.trim() ? slide.notes : <span className="slides-presenter-empty">{t("No speaker notes for this slide.")}</span>}</div>
    </div>
    <div className="slides-presenter-bar">
      <button type="button" onClick={() => onGo(-1)} disabled={index <= 0}><ChevronLeft size={18} className="rtl-mirror" />{t("Previous")}</button>
      <button type="button" onClick={() => onGo(1)} disabled={index >= count - 1}>{t("Next")}<ChevronRight size={18} className="rtl-mirror" /></button>
      <button type="button" aria-pressed={blank === "black"} onClick={() => onBlank("black")}>{t("Black screen")}</button>
      <button type="button" aria-pressed={blank === "white"} onClick={() => onBlank("white")}>{t("White screen")}</button>
      <button type="button" className="is-end" onClick={onExit}>{t("End presentation")}</button>
    </div>
  </div>;
}
