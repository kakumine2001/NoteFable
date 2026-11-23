"use client";

import { EyeOff, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useT } from "@/components/i18n-provider";
import { SlideFrame } from "@/components/slides/slide-render";
import { slideRows, type Deck, type Slide } from "@/lib/slides/model";

// 縮小図の一覧：単ページ編集の左（スマホでは下）の帯と、総覧（行 = 章）。どちらも押して選び、ドラッグで並べ替える。

export type SelectMode = "single" | "toggle" | "range";

type DragState = { ids: Set<string>; pointerId: number; startX: number; startY: number; active: boolean; touch: boolean; armed: boolean; timer?: ReturnType<typeof setTimeout> };

// 縮小図のドラッグ。マウスは 6px 動いたら、指（タッチ）は少し長押ししてから動かすと始める（すぐ動かすと一覧のスクロール）。
// 始めたら指を捕まえて（画面のどこで離しても）落とす位置を追う。ドラッグの後のクリックは選択にしない。
function useThumbDrag(onDrop: (ids: Set<string>, clientX: number, clientY: number) => void, onHover: (clientX: number, clientY: number) => void) {
  const drag = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  // 長押しの後は、指の動きでページがスクロールしないようにする（React の touchmove は止められないので直接付ける）。
  useEffect(() => {
    if (!root) return;
    const block = (event: TouchEvent) => { if (drag.current?.armed) event.preventDefault(); };
    root.addEventListener("touchmove", block, { passive: false });
    return () => root.removeEventListener("touchmove", block);
  }, [root]);
  return {
    setRoot,
    dragging,
    handlers: (ids: () => Set<string>, enabled: boolean) => ({
      onPointerDown(event: ReactPointerEvent<HTMLElement>) {
        if (!enabled || event.button !== 0) return;
        const touch = event.pointerType !== "mouse";
        const state: DragState = { ids: ids(), pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false, touch, armed: !touch };
        if (touch) state.timer = setTimeout(() => { state.armed = true; navigator.vibrate?.(8); }, 320);
        // マウスはすぐに捕まえる（速く動かしても縮小図の外の要素に動きを取られない）。
        else { try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 捕まえられない指（合成のイベントなど） */ } }
        drag.current = state;
      },
      onPointerMove(event: ReactPointerEvent<HTMLElement>) {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        if (!current.active) {
          const distance = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
          if (!current.armed) {
            // 長押しの前に動いた：スクロール。
            if (distance > 8) { clearTimeout(current.timer); drag.current = null; }
            return;
          }
          if (distance < 6) return;
          current.active = true;
          setDragging(true);
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 同上 */ }
        }
        onHover(event.clientX, event.clientY);
      },
      onPointerUp(event: ReactPointerEvent<HTMLElement>) {
        const current = drag.current;
        drag.current = null;
        clearTimeout(current?.timer);
        if (!current?.active) return;
        suppressClick.current = true;
        setDragging(false);
        onDrop(current.ids, event.clientX, event.clientY);
      },
      onPointerCancel() { clearTimeout(drag.current?.timer); drag.current = null; setDragging(false); },
    }),
    // ドラッグの直後のクリックか（そうなら選択を変えない）。
    consumeClick() {
      const value = suppressClick.current;
      suppressClick.current = false;
      return value;
    },
  };
}

type ThumbHandlers = ReturnType<ReturnType<typeof useThumbDrag>["handlers"]>;

function Thumb({ slide, number, width, current, selected, handlers, onClick, onDoubleClick, onContextMenu }: {
  slide: Slide; number: number; width: number; current: boolean; selected: boolean; handlers: ThumbHandlers;
  onClick: (event: React.MouseEvent) => void; onDoubleClick?: () => void; onContextMenu: (event: React.MouseEvent) => void;
}) {
  const t = useT();
  return <div className={`slides-thumb${current ? " is-current" : ""}${selected ? " is-selected" : ""}${slide.hidden ? " is-hidden" : ""}`} data-slide-id={slide.id}>
    <span className="slides-thumb-number" aria-hidden="true">{number}</span>
    <button type="button" className="slides-thumb-button" role="option" aria-selected={selected} aria-label={t("Slide {number}", { number })} aria-current={current || undefined}
      {...handlers} onClick={onClick} onDoubleClick={onDoubleClick} onContextMenu={onContextMenu}>
      <SlideFrame slide={slide} width={width} />
      {slide.hidden && <span className="slides-thumb-hidden" title={t("Hidden in presentation")}><EyeOff size={14} aria-hidden="true" /></span>}
    </button>
  </div>;
}

const selectMode = (event: React.MouseEvent): SelectMode => (event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "single");

// 単ページ編集の縮小図の帯（縦、スマホでは横）。
export function SlideFilmstrip({ deck, currentId, selected, editable, horizontal, onSelect, onMove, onContextMenu, onAdd }: {
  deck: Deck; currentId: string | null; selected: Set<string>; editable: boolean; horizontal: boolean;
  onSelect: (id: string, mode: SelectMode) => void;
  onMove: (ids: Set<string>, index: number) => void;
  onContextMenu: (x: number, y: number, id: string) => void;
  onAdd: () => void;
}) {
  const t = useT();
  const list = useRef<HTMLDivElement>(null);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const indexAt = (clientX: number, clientY: number) => {
    const thumbs = Array.from(list.current?.querySelectorAll<HTMLElement>(".slides-thumb") ?? []);
    for (let i = 0; i < thumbs.length; i++) {
      const rect = thumbs[i].getBoundingClientRect();
      const middle = horizontal ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
      if ((horizontal ? clientX : clientY) < middle) return i;
    }
    return thumbs.length;
  };
  const drag = useThumbDrag((ids, x, y) => { setInsertAt(null); onMove(ids, indexAt(x, y)); }, (x, y) => setInsertAt(indexAt(x, y)));
  const rows = slideRows(deck.slides);
  const { setRoot } = drag;
  const attach = useCallback((node: HTMLDivElement | null) => { list.current = node; setRoot(node); }, [setRoot]);
  return <div ref={attach} className={`slides-filmstrip${horizontal ? " is-horizontal" : ""}${drag.dragging ? " is-dragging" : ""}`} role="listbox" aria-label={t("Slides")} aria-multiselectable="true">
    {rows.map((row, rowIndex) => <div key={row.slides[0].id} className="slides-filmstrip-row">
      {(rowIndex > 0 || row.title) && <div className="slides-filmstrip-section" title={row.title}>{row.title || t("Section {number}", { number: rowIndex + 1 })}</div>}
      {row.slides.map((slide, position) => {
        const index = row.start + position;
        return <div key={slide.id} className="slides-filmstrip-item">
          {insertAt === index && <div className="slides-insert-line" aria-hidden="true" />}
          <Thumb slide={slide} number={index + 1} width={horizontal ? 112 : 168} current={slide.id === currentId} selected={selected.has(slide.id)}
            handlers={drag.handlers(() => (selected.has(slide.id) ? selected : new Set([slide.id])), editable)}
            onClick={(event) => { if (!drag.consumeClick()) onSelect(slide.id, selectMode(event)); }}
            onContextMenu={(event) => { event.preventDefault(); if (!selected.has(slide.id)) onSelect(slide.id, "single"); onContextMenu(event.clientX, event.clientY, slide.id); }} />
        </div>;
      })}
    </div>)}
    {insertAt === deck.slides.length && <div className="slides-insert-line" aria-hidden="true" />}
    {editable && <button type="button" className="slides-filmstrip-add" onClick={onAdd} aria-label={t("New slide")} title={t("New slide")}><Plus size={18} aria-hidden="true" /></button>}
  </div>;
}

// 総覧：行（章）ごとに並べる。行の名前は書き換えられる。行をまたいでドラッグでき、下の空きに落とすと新しい行になる。
export function SlideGrid({ deck, currentId, selected, editable, thumbWidth = 232, onOpen, onSelect, onMoveToRow, onRenameRow, onAddSlide, onContextMenu }: {
  deck: Deck; currentId: string | null; selected: Set<string>; editable: boolean; thumbWidth?: number;
  onOpen: (id: string) => void;
  onSelect: (id: string, mode: SelectMode) => void;
  onMoveToRow: (ids: Set<string>, row: number, position: number) => void;
  onRenameRow: (slideId: string, title: string) => void;
  onAddSlide: (rowIndex: number) => void;
  onContextMenu: (x: number, y: number, id: string) => void;
}) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<{ row: number; position: number } | null>(null);
  const rows = slideRows(deck.slides);
  const targetAt = (clientX: number, clientY: number) => {
    const rowNodes = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-grid-row]") ?? []);
    let rowIndex = rowNodes.length;
    for (let i = 0; i < rowNodes.length; i++) {
      if (clientY <= rowNodes[i].getBoundingClientRect().bottom) { rowIndex = i; break; }
    }
    if (rowIndex >= rowNodes.length) return { row: rowNodes.length, position: 0 };
    let position = 0;
    for (const thumb of Array.from(rowNodes[rowIndex].querySelectorAll<HTMLElement>(".slides-thumb"))) {
      const rect = thumb.getBoundingClientRect();
      const cy = rect.top + rect.height / 2;
      if (cy < clientY - rect.height / 2 || (Math.abs(cy - clientY) <= rect.height / 2 && rect.left + rect.width / 2 < clientX)) position++;
    }
    return { row: rowIndex, position };
  };
  const drag = useThumbDrag((ids, x, y) => { setTarget(null); const { row, position } = targetAt(x, y); onMoveToRow(ids, row, position); }, (x, y) => setTarget(targetAt(x, y)));
  const { setRoot } = drag;
  const attach = useCallback((node: HTMLDivElement | null) => { root.current = node; setRoot(node); }, [setRoot]);
  return <div ref={attach} className={`slides-grid${drag.dragging ? " is-dragging" : ""}`} role="listbox" aria-label={t("Slides")} aria-multiselectable="true">
    {rows.map((row, rowIndex) => {
      const firstNumber = row.start;
      return <section key={row.slides[0].id} className={`slides-grid-row${target?.row === rowIndex ? " is-target" : ""}`} data-grid-row={rowIndex}>
        <input className="slides-grid-title" value={row.title} disabled={!editable} placeholder={t("Section {number}", { number: rowIndex + 1 })}
          aria-label={t("Section name")} maxLength={200} onChange={(event) => onRenameRow(row.slides[0].id, event.target.value)} />
        <div className="slides-grid-items">
          {row.slides.map((slide, position) => <div key={slide.id} className="slides-grid-item">
            {target?.row === rowIndex && target.position === position && <div className="slides-insert-line is-vertical" aria-hidden="true" />}
            <Thumb slide={slide} number={firstNumber + position + 1} width={thumbWidth} current={slide.id === currentId} selected={selected.has(slide.id)}
              handlers={drag.handlers(() => (selected.has(slide.id) ? selected : new Set([slide.id])), editable)}
              onClick={(event) => { if (!drag.consumeClick()) onSelect(slide.id, selectMode(event)); }}
              onDoubleClick={() => onOpen(slide.id)}
              onContextMenu={(event) => { event.preventDefault(); if (!selected.has(slide.id)) onSelect(slide.id, "single"); onContextMenu(event.clientX, event.clientY, slide.id); }} />
          </div>)}
          {target?.row === rowIndex && target.position >= row.slides.length && <div className="slides-insert-line is-vertical" aria-hidden="true" />}
          {editable && <button type="button" className="slides-grid-add" onClick={() => onAddSlide(rowIndex)} aria-label={t("New slide")} title={t("New slide")}><Plus size={22} aria-hidden="true" /></button>}
        </div>
      </section>;
    })}
    {editable && <div className={`slides-grid-newrow${target && target.row >= rows.length ? " is-target" : ""}`}>{t("Drop here to start a new section")}</div>}
  </div>;
}
