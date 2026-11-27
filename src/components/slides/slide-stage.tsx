"use client";

import { LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useT } from "@/components/i18n-provider";
import { ElementContent, elementBoxStyle, SlideSurface, textStyleCss, useSlideRender } from "@/components/slides/slide-render";
import { SlideTextEditor, type TextCommands } from "@/components/slides/text-editor";
import {
  applyGeometryPatches, elementsBounds, expandGroups, geometryPatch, HANDLES, intersects, lineEndpoints, lineFromEndpoints, resizeFrame, rotatedBounds, rotationFor, snapBox,
  type Box, type GeometryPatch, type Guide, type Handle,
} from "@/lib/slides/geometry";
import { SLIDE_HEIGHT, SLIDE_WIDTH, type ShapeElement, type Slide, type SlideElement, type TableElement, type TextElement } from "@/lib/slides/model";
import { richDocFromText, type RichDoc } from "@/lib/slides/rich-text";
import { resolveColor } from "@/lib/slides/themes";

// 1 枚を編集する面：選ぶ・動かす・大きさを変える・回す・吸着・範囲選択・文字と表の編集。
// 動かしている間は下書き（draft）だけを描き、指を離したときに 1 回だけ onCommit する（取り消し 1 回で戻る）。
// 下書きは位置・大きさ・向きの差分だけ。描くときも確定するときも最新の要素に重ねるので、動かしている間に届いた AI の画像なども消えない。

type Drag =
  | { kind: "move"; startX: number; startY: number; start: Map<string, SlideElement>; others: Box[]; moved: boolean }
  | { kind: "resize"; handle: Handle; startX: number; startY: number; start: Map<string, SlideElement>; box: Box; single: SlideElement | null }
  | { kind: "rotate"; element: SlideElement }
  | { kind: "point"; element: SlideElement; end: "p1" | "p2" }
  | { kind: "marquee"; startX: number; startY: number; additive: boolean; base: Set<string> };

const HANDLE_PX = 10;
const SNAP_PX = 6;

// 指の位置が要素に当たるか（回した要素は要素の向きで、線は線からの距離で見る）。
function hitTest(element: SlideElement, x: number, y: number, tolerance: number): boolean {
  if (element.type === "line") {
    const { x1, y1, x2, y2 } = lineEndpoints(element);
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (!length) return Math.hypot(x - x1, y - y1) <= tolerance;
    const t = Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / (length * length)));
    return Math.hypot(x - (x1 + t * (x2 - x1)), y - (y1 + t * (y2 - y1))) <= Math.max(tolerance, element.strokeWidth / 2 + 2);
  }
  const cx = element.x + element.w / 2;
  const cy = element.y + element.h / 2;
  const angle = (-element.rotation * Math.PI) / 180;
  const lx = (x - cx) * Math.cos(angle) - (y - cy) * Math.sin(angle);
  const ly = (x - cx) * Math.sin(angle) + (y - cy) * Math.cos(angle);
  return Math.abs(lx) <= element.w / 2 + 2 && Math.abs(ly) <= element.h / 2 + 2;
}

export function elementAt(slide: Slide, x: number, y: number, tolerance: number): SlideElement | null {
  for (let index = slide.elements.length - 1; index >= 0; index--) {
    if (hitTest(slide.elements[index], x, y, tolerance)) return slide.elements[index];
  }
  return null;
}

// 表の編集（セルごとの文字欄）。Tab で次のセルへ。
function TableEditor({ element, onChange, onExit }: { element: TableElement; onChange: (next: TableElement) => void; onExit: () => void }) {
  const t = useT();
  const { theme } = useSlideRender();
  const total = element.cols.reduce((sum, col) => sum + col, 0) || 1;
  const first = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  return <table className="slide-table slide-table-editing" style={{ fontFamily: theme.fonts[element.style.font].css, fontSize: `${element.style.size}px`, color: resolveColor(element.style.color, theme) }}
    onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.stopPropagation()}>
    <colgroup>{element.cols.map((col, index) => <col key={index} style={{ width: `${(col / total) * 100}%` }} />)}</colgroup>
    <tbody>{element.rows.map((row, rowIndex) => <tr key={rowIndex} style={{ height: `${100 / element.rows.length}%` }}>
      {row.cells.map((cell, cellIndex) => {
        const header = element.header && rowIndex === 0;
        const Cell = header ? "th" : "td";
        return <Cell key={cellIndex} style={{ borderColor: resolveColor(element.style.border, theme), background: header ? resolveColor(element.style.headerFill, theme) : undefined }}>
          <textarea ref={rowIndex === 0 && cellIndex === 0 ? first : undefined} className="slide-table-cell-input" value={cell.text}
            aria-label={t("Table cell {row}, {column}", { row: rowIndex + 1, column: cellIndex + 1 })}
            onKeyDown={(event) => { if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); onExit(); } }}
            onChange={(event) => onChange({
              ...element,
              rows: element.rows.map((r, ri) => ri !== rowIndex ? r : { cells: r.cells.map((c, ci) => (ci === cellIndex ? { text: event.target.value.slice(0, 2000) } : c)) }),
            })} />
        </Cell>;
      })}
    </tr>)}</tbody>
  </table>;
}

// 文字を編集している要素（文字枠、または図形の中の文字）。自動の高さの文字枠は、中身に合わせて高さを伝える。
function EditingText({ element, commandsRef, selectAll, onDoc, onHeight, onExit, onSelectionChange }: {
  element: TextElement | ShapeElement;
  commandsRef: { current: TextCommands | null };
  selectAll: boolean;
  onDoc: (doc: RichDoc) => void;
  onHeight: (height: number) => void;
  onExit: () => void;
  onSelectionChange: () => void;
}) {
  const { theme } = useSlideRender();
  const box = useRef<HTMLDivElement>(null);
  const autoHeight = element.type === "text" && element.autoHeight;
  const measure = useCallback(() => {
    if (!autoHeight || !box.current) return;
    const content = box.current.firstElementChild as HTMLElement | null;
    const height = Math.ceil(content?.scrollHeight ?? 0);
    if (height && Math.abs(height - element.h) > 1) onHeight(height);
  }, [autoHeight, element.h, onHeight]);
  useLayoutEffect(() => { measure(); });
  const style: CSSProperties = {
    ...textStyleCss(element.style, theme),
    background: element.type === "text" && element.fill ? resolveColor(element.fill, theme) : undefined,
    ...(autoHeight ? { height: "auto", minHeight: "100%" } : {}),
  };
  return <div ref={box} className="slide-text-editor-box">
    <SlideTextEditor doc={element.doc} style={style} commandsRef={commandsRef} selectAll={selectAll} onExit={onExit}
      onSelectionChange={onSelectionChange} onChange={(doc) => { onDoc(doc); requestAnimationFrame(measure); }} />
  </div>;
}

export type StageHandle = { focus: () => void };

export function SlideStage({
  slide, editable, selection, editingId, editSelectAll, onSelect, onCommit, onStartEdit, onStopEdit, onTextChange, onTableChange,
  onRequestImage, onReplaceWhiteboard, outdatedWhiteboardIds, refreshingWhiteboardIds, onRefreshWhiteboard,
  onContextMenu, onDropFiles, commandsRef, onTextSelection, stageRef, padding = 32,
}: {
  slide: Slide;
  editable: boolean;
  selection: Set<string>;
  editingId: string | null;
  editSelectAll: boolean;
  onSelect: (ids: Set<string>) => void;
  onCommit: (next: Slide | ((latest: Slide) => Slide), merge?: string) => void;
  onStartEdit: (id: string, selectAll?: boolean) => void;
  onStopEdit: () => void;
  onTextChange: (id: string, doc: RichDoc, height?: number) => void;
  onTableChange: (next: TableElement) => void;
  onRequestImage: (elementId: string) => void;
  onReplaceWhiteboard?: (elementId: string) => void;
  outdatedWhiteboardIds?: ReadonlySet<string>;
  refreshingWhiteboardIds?: ReadonlySet<string>;
  onRefreshWhiteboard?: (elementId: string) => void;
  onContextMenu: (x: number, y: number, elementId: string | null) => void;
  onDropFiles: (files: File[], point: { x: number; y: number }) => void;
  commandsRef: { current: TextCommands | null };
  onTextSelection: () => void;
  stageRef?: { current: StageHandle | null };
  padding?: number;
}) {
  const t = useT();
  const container = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  const [draft, setDraftState] = useState<Map<string, GeometryPatch> | null>(null);
  // 指を離したときに読む、いまの下書き（state の更新関数の中で保存を呼ばないため）。
  const draftRef = useRef<Map<string, GeometryPatch> | null>(null);
  const setDraft = (next: Map<string, GeometryPatch> | null) => { draftRef.current = next; setDraftState(next); };
  // ドラッグを始めたときの要素（start）と、いまの形（next）から下書きを作る。
  const draftOf = (pairs: [start: SlideElement, next: SlideElement][]) => new Map(pairs.map(([start, next]) => [start.id, geometryPatch(start, next)]));
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const drag = useRef<Drag | null>(null);
  // 選んだ文字枠をもう一度押したら編集を始める（ドラッグで動かしたときは始めない）。
  const clickToEdit = useRef<string | null>(null);

  useLayoutEffect(() => {
    const node = container.current;
    if (!node) return;
    const update = () => {
      const width = Math.max(0, node.clientWidth - padding * 2);
      const height = Math.max(0, node.clientHeight - padding * 2);
      setScale(Math.max(0.05, Math.min(width / SLIDE_WIDTH, height / SLIDE_HEIGHT)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [padding]);

  useEffect(() => {
    if (stageRef) stageRef.current = { focus: () => container.current?.focus({ preventScroll: true }) };
  }, [stageRef]);

  const rendered = useMemo(() => (draft ? { ...slide, elements: applyGeometryPatches(slide.elements, draft) } : slide), [slide, draft]);
  const selectedElements = rendered.elements.filter((element) => selection.has(element.id));
  const units = useMemo(() => {
    const keys = new Set(selectedElements.map((element) => element.group ? `g:${element.group}` : `e:${element.id}`));
    return keys.size;
  }, [selectedElements]);
  const single = units === 1 && selectedElements.length === 1 ? selectedElements[0] : null;
  const bounds = elementsBounds(selectedElements);

  const toSlide = useCallback((clientX: number, clientY: number) => {
    const rect = frame.current!.getBoundingClientRect();
    return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
  }, [scale]);

  function finish(commit: boolean) {
    const current = drag.current;
    drag.current = null;
    setGuides([]);
    setMarquee(null);
    const pending = draftRef.current;
    setDraft(null);
    if (!current || !commit || !pending?.size || current.kind === "marquee") return;
    // 最新の要素に、ドラッグで変えた値だけを重ねる。指を離した時点でまだ描いていない変更（直前に届いた AI の配図など）も
    // 消さないよう、描いている slide ではなく保存する時点の最新の枚に重ねる関数で渡す。
    if (applyGeometryPatches(slide.elements, pending) === slide.elements) return;
    onCommit((latest) => {
      const elements = applyGeometryPatches(latest.elements, pending);
      return elements === latest.elements ? latest : { ...latest, elements };
    });
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 2) return;
    container.current?.focus({ preventScroll: true });
    const point = toSlide(event.clientX, event.clientY);
    const target = event.target as HTMLElement;
    const handle = target.closest<HTMLElement>("[data-handle]")?.dataset.handle;
    if (event.button === 2) {
      const hit = elementAt(slide, point.x, point.y, 8 / scale);
      if (hit && !selection.has(hit.id)) onSelect(expandGroups(slide.elements, [hit.id]));
      if (!hit) onSelect(new Set());
      return;
    }
    if (!editable) {
      const hit = elementAt(slide, point.x, point.y, 8 / scale);
      onSelect(hit ? expandGroups(slide.elements, [hit.id]) : new Set());
      return;
    }
    if (editingId) onStopEdit();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (handle && selectedElements.length) {
      const start = new Map(selectedElements.map((element) => [element.id, element]));
      if (handle === "rotate" && single) drag.current = { kind: "rotate", element: single };
      else if ((handle === "p1" || handle === "p2") && single?.type === "line") drag.current = { kind: "point", element: single, end: handle };
      else if (bounds) drag.current = { kind: "resize", handle: handle as Handle, startX: point.x, startY: point.y, start, box: bounds, single };
      clickToEdit.current = null;
      return;
    }
    const hit = elementAt(slide, point.x, point.y, 8 / scale);
    if (!hit) {
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      if (!additive) onSelect(new Set());
      drag.current = { kind: "marquee", startX: point.x, startY: point.y, additive, base: additive ? new Set(selection) : new Set() };
      clickToEdit.current = null;
      return;
    }
    let next = selection;
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      const unit = expandGroups(slide.elements, [hit.id]);
      next = new Set(selection);
      const removing = selection.has(hit.id);
      for (const id of unit) { if (removing) next.delete(id); else next.add(id); }
      onSelect(next);
      clickToEdit.current = null;
    } else if (!selection.has(hit.id)) {
      next = expandGroups(slide.elements, [hit.id]);
      onSelect(next);
      clickToEdit.current = null;
    } else {
      clickToEdit.current = selection.size === 1 && (hit.type === "text" || hit.type === "shape") ? hit.id : null;
    }
    const moving = slide.elements.filter((element) => next.has(element.id));
    if (!moving.length) return;
    drag.current = {
      kind: "move", startX: point.x, startY: point.y, moved: false,
      start: new Map(moving.map((element) => [element.id, element])),
      others: slide.elements.filter((element) => !next.has(element.id)).map(rotatedBounds),
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current) return;
    const point = toSlide(event.clientX, event.clientY);
    if (current.kind === "marquee") {
      const box = { x: Math.min(point.x, current.startX), y: Math.min(point.y, current.startY), w: Math.abs(point.x - current.startX), h: Math.abs(point.y - current.startY) };
      setMarquee(box);
      const hits = slide.elements.filter((element) => intersects(rotatedBounds(element), box)).map((element) => element.id);
      onSelect(expandGroups(slide.elements, [...current.base, ...hits]));
      return;
    }
    if (current.kind === "move") {
      let dx = point.x - current.startX;
      let dy = point.y - current.startY;
      if (!current.moved && Math.hypot(dx, dy) * scale < 3) return;
      current.moved = true;
      clickToEdit.current = null;
      if (event.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const startBounds = elementsBounds([...current.start.values()])!;
      let found: Guide[] = [];
      if (!event.altKey) {
        const snap = snapBox({ ...startBounds, x: startBounds.x + dx, y: startBounds.y + dy }, current.others, SNAP_PX / scale);
        dx += snap.dx;
        dy += snap.dy;
        found = snap.guides;
      }
      setGuides(found);
      setDraft(draftOf([...current.start.values()].map((element) => [element, { ...element, x: round(element.x + dx), y: round(element.y + dy) }])));
      return;
    }
    if (current.kind === "rotate") {
      const rotation = rotationFor(current.element, point.x, point.y, event.shiftKey);
      setDraft(draftOf([[current.element, { ...current.element, rotation }]]));
      return;
    }
    if (current.kind === "point" && current.element.type === "line") {
      const ends = lineEndpoints(current.element);
      let { x, y } = point;
      const fixed = current.end === "p1" ? { x: ends.x2, y: ends.y2 } : { x: ends.x1, y: ends.y1 };
      if (event.shiftKey) {
        // 45 度ごとに止める。
        const angle = Math.round(Math.atan2(y - fixed.y, x - fixed.x) / (Math.PI / 4)) * (Math.PI / 4);
        const length = Math.hypot(x - fixed.x, y - fixed.y);
        x = fixed.x + Math.cos(angle) * length;
        y = fixed.y + Math.sin(angle) * length;
      }
      const box = current.end === "p1" ? lineFromEndpoints(x, y, fixed.x, fixed.y) : lineFromEndpoints(fixed.x, fixed.y, x, y);
      setDraft(draftOf([[current.element, { ...current.element, ...box }]]));
      return;
    }
    if (current.kind === "resize") {
      const dx = point.x - current.startX;
      const dy = point.y - current.startY;
      const corner = current.handle.length === 2;
      if (current.single && current.single.type !== "line") {
        const element = current.single;
        const keepRatio = event.shiftKey !== ((element.type === "image" || element.type === "whiteboard") && corner);
        const frameNext = resizeFrame(element, current.handle, dx, dy, keepRatio);
        // 高さを手で変えた文字枠は、中身に合わせた自動の高さをやめる。
        const fixedHeight = element.type === "text" && element.autoHeight && (current.handle.includes("n") || current.handle.includes("s")) ? { autoHeight: false } : {};
        setDraft(draftOf([[element, { ...element, ...frameNext, ...fixedHeight } as SlideElement]]));
        return;
      }
      // 複数（またはグループ）：囲む箱ごと拡大縮小する。
      const box = current.box;
      const next = resizeFrame({ ...box, rotation: 0 }, current.handle, dx, dy, event.shiftKey || corner);
      const sx = box.w ? next.w / box.w : 1;
      const sy = box.h ? next.h / box.h : 1;
      setDraft(draftOf([...current.start.values()].map((element) => [element, {
        ...element, x: round(next.x + (element.x - box.x) * sx), y: round(next.y + (element.y - box.y) * sy), w: round(element.w * sx), h: round(element.h * sy),
      }])));
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    const editTarget = clickToEdit.current;
    clickToEdit.current = null;
    finish(true);
    if (current?.kind === "move" && !current.moved && editTarget && editable) onStartEdit(editTarget);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function onDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!editable) return;
    const point = toSlide(event.clientX, event.clientY);
    const hit = elementAt(slide, point.x, point.y, 8 / scale);
    if (!hit) return;
    if (hit.type === "text" || hit.type === "shape" || hit.type === "table") { onSelect(new Set([hit.id])); onStartEdit(hit.id); }
    else if (hit.type === "image") onRequestImage(hit.id);
    else if (hit.type === "whiteboard") onReplaceWhiteboard?.(hit.id);
  }

  const editing = editingId ? slide.elements.find((element) => element.id === editingId) ?? null : null;
  const handleSize = HANDLE_PX / scale;

  return <div ref={container} className="slides-stage" tabIndex={-1} style={{ padding }}
    onDragOver={(event) => { if (editable && event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
    onDrop={(event) => {
      if (!editable || !event.dataTransfer.files.length) return;
      event.preventDefault();
      onDropFiles(Array.from(event.dataTransfer.files), frame.current ? toSlide(event.clientX, event.clientY) : { x: SLIDE_WIDTH / 2, y: SLIDE_HEIGHT / 2 });
    }}
    onContextMenu={(event) => {
      event.preventDefault();
      const point = frame.current ? toSlide(event.clientX, event.clientY) : null;
      const hit = point ? elementAt(slide, point.x, point.y, 8 / scale) : null;
      onContextMenu(event.clientX, event.clientY, hit?.id ?? null);
    }}>
    <div ref={frame} className="slides-stage-frame" style={{ width: SLIDE_WIDTH * scale, height: SLIDE_HEIGHT * scale }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => finish(false)} onDoubleClick={onDoubleClick}>
      <div className="slide-frame-inner" style={{ transform: `scale(${scale})` }}>
        <SlideSurface slide={rendered} skip={editing?.id ?? null}>
          {editing && (editing.type === "text" || editing.type === "shape") && <div className={`slide-element slide-element-${editing.type} is-editing`} style={elementBoxStyle(editing)}>
            {editing.type === "shape" && <ElementContent element={{ ...editing, doc: richDocFromText("") }} />}
            <EditingText key={editing.id} element={editing} commandsRef={commandsRef} selectAll={editSelectAll} onExit={onStopEdit} onSelectionChange={onTextSelection}
              onDoc={(doc) => onTextChange(editing.id, doc)} onHeight={(height) => onTextChange(editing.id, (commandsRef.current?.view.state.doc.toJSON() as RichDoc) ?? editing.doc, height)} />
          </div>}
          {editing?.type === "table" && <div className="slide-element slide-element-table is-editing" style={elementBoxStyle(editing)}>
            <TableEditor element={editing} onChange={onTableChange} onExit={onStopEdit} />
          </div>}
          {/* 選んだ要素の枠と取っ手。画面上で同じ大きさに見えるよう、縮尺で割る。 */}
          {selectedElements.length > 1 && selectedElements.map((element) => <div key={element.id} className="slide-selection-outline is-member"
            style={{ ...elementBoxStyle(element), borderWidth: 1 / scale }} />)}
          {single && single.type === "line" && editable && !editing && (() => {
            const ends = lineEndpoints(single);
            return <>
              {(["p1", "p2"] as const).map((end) => <div key={end} data-handle={end} className="slide-handle is-point"
                style={{ left: (end === "p1" ? ends.x1 : ends.x2) - handleSize / 2, top: (end === "p1" ? ends.y1 : ends.y2) - handleSize / 2, width: handleSize, height: handleSize, borderWidth: 1.5 / scale }} />)}
            </>;
          })()}
          {single && single.type !== "line" && !editing && <div className="slide-selection" style={{ ...elementBoxStyle(single), opacity: undefined }}>
            <div className="slide-selection-outline" style={{ inset: 0, borderWidth: 1.5 / scale }} />
            {editable && HANDLES.map((handle) => <div key={handle} data-handle={handle} className={`slide-handle is-${handle}`}
              style={{ width: handleSize, height: handleSize, borderWidth: 1.5 / scale, ...handlePosition(handle, single.w, single.h, handleSize) }} />)}
            {editable && <>
              <div className="slide-rotate-stem" style={{ left: single.w / 2 - 0.5 / scale, top: -28 / scale, height: 22 / scale, width: 1 / scale }} />
              <div data-handle="rotate" className="slide-handle is-rotate" style={{ left: single.w / 2 - handleSize / 2, top: -28 / scale - handleSize / 2, width: handleSize, height: handleSize, borderWidth: 1.5 / scale }} />
            </>}
          </div>}
          {!single && bounds && selectedElements.length > 1 && !editing && <div className="slide-selection" style={{ left: bounds.x, top: bounds.y, width: bounds.w, height: bounds.h }}>
            <div className="slide-selection-outline is-group" style={{ inset: 0, borderWidth: 1.5 / scale }} />
            {editable && HANDLES.filter((handle) => handle.length === 2).map((handle) => <div key={handle} data-handle={handle} className={`slide-handle is-${handle}`}
              style={{ width: handleSize, height: handleSize, borderWidth: 1.5 / scale, ...handlePosition(handle, bounds.w, bounds.h, handleSize) }} />)}
          </div>}
          {guides.map((guide, index) => <div key={index} className="slide-guide" style={guide.axis === "x"
            ? { left: guide.at - 0.5 / scale, top: guide.from, width: 1 / scale, height: guide.to - guide.from }
            : { top: guide.at - 0.5 / scale, left: guide.from, height: 1 / scale, width: guide.to - guide.from }} />)}
          {marquee && <div className="slide-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h, borderWidth: 1 / scale }} />}
          {/* 白板が更新された静止画にだけ、編集画面で「可刷新」バッジを重ねる（放映・書き出し・公開ページには出ない）。 */}
          {editable && !editing && !draft && onRefreshWhiteboard && rendered.elements.map((element) => {
            if (element.type !== "whiteboard" || !outdatedWhiteboardIds?.has(element.id)) return null;
            const box = rotatedBounds(element);
            const busy = Boolean(refreshingWhiteboardIds?.has(element.id));
            return (
              <div
                key={`wb-refresh-${element.id}`}
                className="slide-wb-refresh-anchor"
                style={{
                  left: box.x + box.w - 8 / scale,
                  top: box.y + 8 / scale,
                  transform: `scale(${1 / scale})`,
                }}
              >
                <button
                  type="button"
                  className="slide-wb-refresh-badge"
                  disabled={busy}
                  aria-label={t("Refresh snapshot")}
                  title={t("Refresh snapshot")}
                  onPointerDown={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRefreshWhiteboard(element.id);
                  }}
                >
                  {busy
                    ? <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />
                    : <RefreshCw size={12} aria-hidden="true" />}
                  <span>{busy ? t("Refreshing…") : t("Refresh available")}</span>
                </button>
              </div>
            );
          })}
        </SlideSurface>
      </div>
    </div>
  </div>;
}

function handlePosition(handle: Handle, w: number, h: number, size: number): CSSProperties {
  const x = handle.includes("w") ? 0 : handle.includes("e") ? w : w / 2;
  const y = handle.includes("n") ? 0 : handle.includes("s") ? h : h / 2;
  return { left: x - size / 2, top: y - size / 2 };
}

const round = (value: number) => Math.round(value * 100) / 100;
