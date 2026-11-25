"use client";

import { COLORS_DEFAULT, createExtension, getNodeById, type BlockNoteEditor } from "@blocknote/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Check, ChevronDown, Copy, GripVertical, Palette, Text, Trash2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AppIcon } from "@/components/app-icon";
import { useI18n, useT } from "@/components/i18n-provider";
import { findColumnSideTarget, moveBlocksBeside, type ColumnSideDropTarget } from "@/components/note-columns";
import { msg } from "@/lib/i18n/translate";
import { NOTE_TEXT_BLOCKS, blockMatchesTarget, codeBlockText, copyNoteBlocks, selectedRootBlocks, targetProps, type NoteBlockTarget } from "@/lib/note-block-actions";
import {
  adjacentSelectableBlockId,
  buildNoteBlockSelection,
  canStartMarqueeTarget,
  clampRect,
  collectSubtreeIds,
  expandSelectionRange,
  isContainerOnlyBlock,
  isNoOpBlockMove,
  normalizeBlockSelection,
  orderedSelectableBlockIds,
  rectFromPoints,
  rectsIntersect,
  type SelectableBlock,
  type SelectionRect,
} from "@/lib/note-block-selection";
import { blocksToMarkdown, type NoteBlock } from "@/lib/note-markdown";
import type { PageSelection } from "@/lib/page-ai/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NoteBlockEditorLike = BlockNoteEditor<any, any, any>;

export const blockSelectionPluginKey = new PluginKey<Set<string>>("notes-block-selection");

export const blockSelectionExtension = createExtension(() => ({
  key: "notes-block-selection",
  prosemirrorPlugins: [
    new Plugin<Set<string>>({
      key: blockSelectionPluginKey,
      state: {
        init: () => new Set<string>(),
        apply(tr, prev) {
          const next = tr.getMeta(blockSelectionPluginKey);
          return next instanceof Set ? (next as Set<string>) : prev;
        },
      },
      props: {
        decorations(state) {
          const ids = blockSelectionPluginKey.getState(state);
          if (!ids?.size) return null;
          const decorations: Decoration[] = [];
          for (const id of ids) {
            const found = getNodeById(id, state.doc);
            if (found) {
              decorations.push(
                Decoration.node(found.posBeforeNode, found.posBeforeNode + found.node.nodeSize, {
                  "data-block-selected": "true",
                }),
              );
            }
          }
          return decorations.length ? DecorationSet.create(state.doc, decorations) : null;
        },
      },
    }),
  ],
}));

export const BLOCK_COLORS = [
  { key: "default", title: msg("Default") },
  { key: "gray", title: msg("Gray") },
  { key: "brown", title: msg("Brown") },
  { key: "orange", title: msg("Orange") },
  { key: "yellow", title: msg("Yellow") },
  { key: "green", title: msg("Green") },
  { key: "blue", title: msg("Blue") },
  { key: "purple", title: msg("Purple") },
  { key: "pink", title: msg("Pink") },
  { key: "red", title: msg("Red") },
] as const;

export function convertBlocks(
  editor: NoteBlockEditorLike,
  target: NoteBlockTarget,
  blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block],
  preserveSelection = false,
) {
  if (!preserveSelection) editor.focus();
  editor.transact(() => {
    for (const block of blocks) {
      // 表・画像・区切り線など、文字のブロックでないものは変換しない。
      if (!Array.isArray(block.content)) continue;
      // 種類を変えても共通の props は引き継がれる。コールアウトの既定の灰色だけは「色なし」と対応させる:
      // 色のないブロック → コールアウトは灰色に、灰色のコールアウト → 他の種類は色なしに。
      const background = "backgroundColor" in block.props ? block.props.backgroundColor : undefined;
      const recolor = block.type === target.type ? {}
        : target.type === "callout" && background === "default" ? { backgroundColor: "gray" }
          : block.type === "callout" && background === "gray" ? { backgroundColor: "default" } : {};
      const update = target.type === "codeBlock"
        ? { type: "codeBlock", content: [{ type: "text", text: codeBlockText(block), styles: {} }] }
        : { type: target.type, props: { ...targetProps(target), ...recolor } };
      editor.updateBlock(block, update as never);
    }
  });
}

export function duplicateBlocks(
  editor: NoteBlockEditorLike,
  blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block],
  onDuplicated?: (newIds: string[]) => void,
) {
  const roots = selectedRootBlocks(blocks);
  if (!roots.length) return;
  if (!onDuplicated) editor.focus();
  let newIds: string[] = [];
  editor.transact(() => {
    const copies = editor.insertBlocks(copyNoteBlocks(roots) as never[], roots.at(-1)!, "after");
    newIds = copies.map((copy) => copy.id);
    if (!onDuplicated && copies[0]) {
      try { editor.setTextCursorPosition(copies[0], "end"); } catch { /* 非文字ブロック */ }
    }
  });
  if (onDuplicated && newIds.length) onDuplicated(newIds);
}

export function paintBlocksColor(
  editor: NoteBlockEditorLike,
  blocks: readonly SelectableBlock[],
  prop: "textColor" | "backgroundColor",
  color: string,
) {
  editor.transact(() => {
    for (const block of blocks) {
      const spec = editor.schema.blockSchema[block.type];
      if (spec && prop in spec.propSchema) {
        editor.updateBlock(block.id, { props: { [prop]: color } } as never);
      }
    }
  });
}

type CopiedBlocksPayload = { text: string; blocks: SelectableBlock[] };
let copiedBlocksClipboard: CopiedBlocksPayload | null = null;

type DropTarget =
  | { kind: "vertical"; targetId: string; placement: "before" | "after"; line: { left: number; top: number; width: number } }
  | { kind: "column"; target: ColumnSideDropTarget };

type MoveDragState = {
  active: boolean;
  pointerX: number;
  pointerY: number;
  count: number;
  label: string;
  drop: DropTarget | null;
};

type OverlayData = {
  editor: NoteBlockEditorLike;
  editable: boolean;
  selectedIds: string[];
  docVersion: number;
  marquee: SelectionRect | null;
  moveDrag: MoveDragState | null;
  workspaceRef?: RefObject<HTMLDivElement | null>;
  editorWrapRef: RefObject<HTMLDivElement | null>;
  onAskAi?: (selection: PageSelection) => void;
  onSelectIds: (ids: string[], anchor?: string | null) => void;
  onClearSelection: () => void;
};

function blockContentRect(container: HTMLElement): DOMRect {
  const content = container.querySelector<HTMLElement>(":scope > .bn-block-content")
    ?? container.querySelector<HTMLElement>(":scope > .bn-block > .bn-block-content")
    ?? container.querySelector<HTMLElement>(":scope > .bn-block");
  return (content ?? container).getBoundingClientRect();
}

function blockPreviewLabel(blocks: readonly SelectableBlock[], fallback: string): string {
  const first = blocks[0];
  if (!first) return fallback;
  const text = blocksToMarkdown([first as unknown as NoteBlock]).replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.length > 36 ? `${text.slice(0, 36)}…` : text;
}

function findParentAndSiblings(
  blocks: readonly SelectableBlock[],
  targetId: string,
  parent: SelectableBlock | null = null,
): { parent: SelectableBlock | null; siblings: readonly SelectableBlock[]; index: number } | null {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.id === targetId) return { parent, siblings: blocks, index: i };
    if (block.children.length) {
      const found = findParentAndSiblings(block.children, targetId, block);
      if (found) return found;
    }
  }
  return null;
}

function contiguousSiblingRun(blocks: readonly SelectableBlock[], rootIds: readonly string[]) {
  if (!rootIds.length) return null;
  const first = findParentAndSiblings(blocks, rootIds[0]);
  if (!first) return null;
  const indices: number[] = [];
  for (const id of rootIds) {
    const idx = first.siblings.findIndex((item) => item.id === id);
    if (idx < 0) return null;
    indices.push(idx);
  }
  indices.sort((a, b) => a - b);
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] !== indices[i - 1] + 1) return null;
  }
  return {
    parent: first.parent,
    siblings: first.siblings,
    startIndex: indices[0],
    endIndex: indices[indices.length - 1],
  };
}

function computeScrollStep(clientY: number, bounds: SelectionRect): number {
  const edge = 48;
  if (clientY < bounds.top + edge) {
    const ratio = Math.min(1, (bounds.top + edge - clientY) / edge);
    return -Math.ceil(ratio * 14);
  }
  if (clientY > bounds.bottom - edge) {
    const ratio = Math.min(1, (clientY - (bounds.bottom - edge)) / edge);
    return Math.ceil(ratio * 14);
  }
  return 0;
}

export function useNoteBlockSelection({
  editor,
  editable,
  editorWrapRef,
  workspaceRef,
  onAskAi,
  onSelectionChange,
}: {
  editor: NoteBlockEditorLike;
  editable: boolean;
  editorWrapRef: RefObject<HTMLDivElement | null>;
  workspaceRef?: RefObject<HTMLDivElement | null>;
  onAskAi?: (selection: PageSelection) => void;
  onSelectionChange?: (selection: PageSelection | null) => void;
}) {
  const t = useT();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [docVersion, setDocVersion] = useState(0);
  const [marquee, setMarquee] = useState<SelectionRect | null>(null);
  const [moveDrag, setMoveDrag] = useState<MoveDragState | null>(null);

  const selectedIdsRef = useRef<string[]>([]);
  const anchorIdRef = useRef<string | null>(null);
  const focusIdRef = useRef<string | null>(null);
  const lastEmittedKeyRef = useRef("");
  const isMarqueeActiveRef = useRef(false);
  const didMarqueeDragRef = useRef(false);

  const onSelectionChangeRef = useRef(onSelectionChange);
  useEffect(() => { onSelectionChangeRef.current = onSelectionChange; }, [onSelectionChange]);
  useEffect(() => () => { onSelectionChangeRef.current?.(null); }, []);

  const emitSelection = useCallback((ids: readonly string[]) => {
    const listener = onSelectionChangeRef.current;
    if (!listener) return;
    const payload = buildNoteBlockSelection(editor.document as unknown as SelectableBlock[], ids);
    const key = payload ? `${payload.ids?.join(",") ?? ""}\0${payload.text}` : "";
    if (key === lastEmittedKeyRef.current) return;
    lastEmittedKeyRef.current = key;
    listener(payload);
  }, [editor]);

  const syncDomHighlights = useCallback((ids: readonly string[]) => {
    const view = editor.prosemirrorView;
    if (!view || view.isDestroyed) return;
    const current = blockSelectionPluginKey.getState(view.state);
    if (current && current.size === ids.length && ids.every((id) => current.has(id))) return;
    view.dispatch(view.state.tr.setMeta(blockSelectionPluginKey, new Set(ids)).setMeta("addToHistory", false));
  }, [editor]);

  const commitSelection = useCallback((rawIds: readonly string[], anchor?: string | null, focus?: string | null) => {
    const roots = normalizeBlockSelection(editor.document as unknown as SelectableBlock[], rawIds);
    const nextIds = roots.map((block) => block.id);
    selectedIdsRef.current = nextIds;
    if (!nextIds.length) {
      anchorIdRef.current = null;
      focusIdRef.current = null;
    } else {
      anchorIdRef.current = anchor !== undefined ? anchor : (anchorIdRef.current && nextIds.includes(anchorIdRef.current) ? anchorIdRef.current : nextIds[0]);
      focusIdRef.current = focus !== undefined ? focus : (focusIdRef.current && nextIds.includes(focusIdRef.current) ? focusIdRef.current : nextIds[nextIds.length - 1]);
    }
    setSelectedIds(nextIds);
    syncDomHighlights(nextIds);
    emitSelection(nextIds);
    return nextIds;
  }, [editor, emitSelection, syncDomHighlights]);

  const clearSelection = useCallback(() => {
    if (!selectedIdsRef.current.length && lastEmittedKeyRef.current === "") return;
    selectedIdsRef.current = [];
    anchorIdRef.current = null;
    focusIdRef.current = null;
    setSelectedIds([]);
    syncDomHighlights([]);
    emitSelection([]);
  }, [emitSelection, syncDomHighlights]);

  const safeSelectedIds = useMemo(() => (Array.isArray(selectedIds) ? selectedIds : []), [selectedIds]);

  // DOM 属性を React の描画後に同期し、ドキュメント変更時は消えたブロックを整理する。
  useEffect(() => {
    syncDomHighlights(safeSelectedIds);
  }, [safeSelectedIds, syncDomHighlights]);

  useEffect(() => {
    return editor.onChange(() => {
      if (!selectedIdsRef.current.length || isMarqueeActiveRef.current) return;
      setDocVersion((version) => version + 1);
      const doc = editor.document as unknown as SelectableBlock[];
      const roots = normalizeBlockSelection(doc, selectedIdsRef.current);
      const nextIds = roots.map((block) => block.id);
      if (nextIds.length !== selectedIdsRef.current.length || nextIds.some((id, index) => id !== selectedIdsRef.current[index])) {
        commitSelection(nextIds);
      } else {
        emitSelection(nextIds);
      }
    });
  }, [editor, commitSelection, emitSelection]);

  // 選択中のブロック（本体または ⋮⋮ ハンドル）をドラッグして移動・段組みする。
  const startSelectedBlocksDrag = useCallback((startEvent: { clientX: number; clientY: number; pointerId?: number; preventDefault: () => void; stopPropagation: () => void }, fromHandle = false): boolean => {
    if (!editable || !selectedIdsRef.current.length) return false;
    const doc = editor.document as unknown as SelectableBlock[];
    const roots = normalizeBlockSelection(doc, selectedIdsRef.current);
    if (!roots.length) return false;

    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    const excludedIds = collectSubtreeIds(doc, roots.map((r) => r.id));
    const rootIds = roots.map((r) => r.id);
    const label = blockPreviewLabel(roots, t("{count} blocks", { count: roots.length }));
    let active = false;
    let latestX = startX;
    let latestY = startY;
    let latestDrop: DropTarget | null = null;
    let rafId = 0;

    const getScrollContainer = () => workspaceRef?.current ?? editorWrapRef.current;

    const computeDropAt = (clientX: number, clientY: number): DropTarget | null => {
      const view = editor.prosemirrorView;
      const sideTarget = findColumnSideTarget(view, clientX, clientY, excludedIds);
      if (sideTarget) {
        return { kind: "column", target: sideTarget };
      }
      const wrap = editorWrapRef.current;
      if (!wrap) return null;
      const containers = Array.from(wrap.querySelectorAll<HTMLElement>('.bn-editor [data-node-type="blockContainer"][data-id]'));
      let best: { id: string; rect: DOMRect; distance: number } | null = null;
      for (const el of containers) {
        const id = el.getAttribute("data-id");
        if (!id || excludedIds.has(id)) continue;
        const rect = blockContentRect(el);
        if (rect.width <= 0 || rect.height <= 0) continue;
        const distance = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
        if (!best || distance < best.distance) {
          best = { id, rect, distance };
          if (distance === 0) break;
        }
      }
      if (!best) return null;
      const placement: "before" | "after" = clientY < best.rect.top + best.rect.height / 2 ? "before" : "after";
      if (isNoOpBlockMove(doc, rootIds, best.id, placement)) return null;
      return {
        kind: "vertical",
        targetId: best.id,
        placement,
        line: {
          left: best.rect.left,
          top: placement === "before" ? best.rect.top - 1 : best.rect.bottom + 1,
          width: best.rect.width,
        },
      };
    };

    const tickScroll = () => {
      rafId = 0;
      if (!active) return;
      const scroller = getScrollContainer();
      if (scroller) {
        const bounds = scroller.getBoundingClientRect();
        const dy = computeScrollStep(latestY, bounds);
        if (dy !== 0) scroller.scrollTop += dy;
      }
      latestDrop = computeDropAt(latestX, latestY);
      setMoveDrag({ active: true, pointerX: latestX, pointerY: latestY, count: roots.length, label, drop: latestDrop });
      if (scroller) {
        const bounds = scroller.getBoundingClientRect();
        if (computeScrollStep(latestY, bounds) !== 0) {
          rafId = window.requestAnimationFrame(tickScroll);
        }
      }
    };

    const cleanup = () => {
      if (rafId) { window.cancelAnimationFrame(rafId); rafId = 0; }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      document.body.classList.remove("notes-block-dragging");
      setMoveDrag(null);
    };

    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cleanup();
      }
    };

    const onMove = (event: globalThis.PointerEvent) => {
      latestX = event.clientX;
      latestY = event.clientY;
      if (!active) {
        if (Math.hypot(latestX - startX, latestY - startY) < 5) return;
        active = true;
        window.getSelection()?.removeAllRanges();
        document.body.classList.add("notes-block-dragging");
      }
      latestDrop = computeDropAt(latestX, latestY);
      setMoveDrag({ active: true, pointerX: latestX, pointerY: latestY, count: roots.length, label, drop: latestDrop });
      const scroller = getScrollContainer();
      if (scroller && !rafId && computeScrollStep(latestY, scroller.getBoundingClientRect()) !== 0) {
        rafId = window.requestAnimationFrame(tickScroll);
      }
    };

    const onCancel = () => {
      cleanup();
    };

    const onUp = (event: globalThis.PointerEvent) => {
      const wasActive = active;
      const drop = latestDrop;
      cleanup();
      if (!wasActive) {
        if (!fromHandle) {
          // 選択中のブロックをドラッグせずクリックしただけなら選択を解除し、クリック位置にカーソルを置く。
          clearSelection();
          const view = editor.prosemirrorView;
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (pos) {
            try {
              view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos.pos))));
              view.focus();
            } catch { /* 非テキスト位置 */ }
          }
        }
        return;
      }
      if (fromHandle) {
        const suppressClick = (clickEvent: MouseEvent) => {
          clickEvent.preventDefault();
          clickEvent.stopPropagation();
        };
        window.addEventListener("click", suppressClick, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener("click", suppressClick, true), 50);
      }
      if (!drop) return;
      if (drop.kind === "vertical") {
        const copies = copyNoteBlocks(roots);
        editor.transact(() => {
          editor.insertBlocks(copies as never[], drop.targetId, drop.placement);
          editor.removeBlocks(rootIds);
        });
        commitSelection(copies.map((copy) => copy.id));
      } else {
        const movedIds = moveBlocksBeside(editor, roots as never[], drop.target.blockId, drop.target.before);
        if (movedIds.length) commitSelection(movedIds);
      }
    };

    if (!fromHandle) {
      startEvent.preventDefault();
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    return true;
  }, [clearSelection, commitSelection, editable, editor, editorWrapRef, t, workspaceRef]);

  // 範囲選択（マーキー）＋ ブロック上の Shift / Ctrl+クリック / 選択中ブロックのドラッグ開始。
  useEffect(() => {
    const workspaceEl = workspaceRef?.current ?? editorWrapRef.current;
    const editorWrapEl = editorWrapRef.current;
    if (!workspaceEl || !editorWrapEl) return;

    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (event.button !== 0 || event.pointerType === "touch") return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      // フローティングバーや AI パネル・メニュー操作では選択を解除しない。
      if (target.closest(".notes-block-bar, .bn-menu-dropdown, .bn-popover-content, .bn-side-menu, .note-ai-fab, .note-ai-panel, .note-ai-bubble, .notes-math-popover, [role='menu'], [role='dialog']")) {
        return;
      }

      // ブロック内のクリック判定（Shift / Ctrl+クリック / 選択済みブロックの直接ドラッグ）。
      const hitBlock = editorWrapEl.contains(target)
        ? target.closest<HTMLElement>('.bn-editor [data-node-type="blockContainer"][data-id]')
        : null;
      const hitId = hitBlock?.getAttribute("data-id") ?? null;

      if (hitId && selectedIdsRef.current.length > 0 && !target.closest("a, button, input, textarea, select")) {
        if (event.shiftKey) {
          event.preventDefault();
          const anchor = anchorIdRef.current ?? selectedIdsRef.current[0];
          const range = expandSelectionRange(editor.document as unknown as SelectableBlock[], anchor, hitId);
          if (range.length) commitSelection(range.map((b) => b.id), anchor, hitId);
          return;
        }
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          const exists = selectedIdsRef.current.includes(hitId);
          const next = exists
            ? selectedIdsRef.current.filter((id) => id !== hitId)
            : [...selectedIdsRef.current, hitId];
          commitSelection(next, anchorIdRef.current ?? hitId, hitId);
          return;
        }
        if (Boolean(hitBlock?.closest('.bn-block-outer[data-block-selected="true"]'))) {
          startSelectedBlocksDrag(event, false);
          return;
        }
      }

      if (!canStartMarqueeTarget(target, workspaceEl)) {
        if (selectedIdsRef.current.length && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
          clearSelection();
        }
        return;
      }

      const wsRect = workspaceEl.getBoundingClientRect();
      // スクロールバーの操作ではマーキーを始めない。
      if (event.clientX > wsRect.left + workspaceEl.clientWidth || event.clientY > wsRect.top + workspaceEl.clientHeight) {
        return;
      }

      const startContentX = event.clientX - wsRect.left + workspaceEl.scrollLeft;
      const startContentY = event.clientY - wsRect.top + workspaceEl.scrollTop;
      const startClientX = event.clientX;
      const startClientY = event.clientY;
      const baseSelected = event.shiftKey || event.ctrlKey || event.metaKey ? [...selectedIdsRef.current] : [];

      let dragging = false;
      let latestX = startClientX;
      let latestY = startClientY;
      let latestHitIds: string[] = [];
      let rafId = 0;

      const updateMarquee = () => {
        const curWsRect = workspaceEl.getBoundingClientRect();
        const anchorClientX = startContentX - workspaceEl.scrollLeft + curWsRect.left;
        const anchorClientY = startContentY - workspaceEl.scrollTop + curWsRect.top;
        const rawRect = rectFromPoints(anchorClientX, anchorClientY, latestX, latestY);
        const clamped = clampRect(rawRect, {
          left: curWsRect.left,
          top: curWsRect.top,
          right: curWsRect.left + workspaceEl.clientWidth,
          bottom: curWsRect.top + workspaceEl.clientHeight,
        });
        setMarquee(clamped);

        const doc = editor.document as unknown as SelectableBlock[];
        const containers = Array.from(editorWrapEl.querySelectorAll<HTMLElement>('.bn-editor [data-node-type="blockContainer"][data-id]'));
        const hits: string[] = [];
        for (const el of containers) {
          const id = el.getAttribute("data-id");
          if (!id) continue;
          const rect = blockContentRect(el);
          if (rect.width > 0 && rect.height > 0 && rectsIntersect(rawRect, rect)) {
            hits.push(id);
          }
        }
        const combined = baseSelected.length
          ? (event.ctrlKey || event.metaKey ? [...new Set([...baseSelected, ...hits])] : [...baseSelected, ...hits])
          : hits;
        const roots = normalizeBlockSelection(doc, combined);
        latestHitIds = roots.map((block) => block.id);
        syncDomHighlights(latestHitIds);
      };

      const tickScroll = () => {
        rafId = 0;
        if (!dragging) return;
        const curWsRect = workspaceEl.getBoundingClientRect();
        const dy = computeScrollStep(latestY, {
          left: curWsRect.left,
          top: curWsRect.top,
          right: curWsRect.left + workspaceEl.clientWidth,
          bottom: curWsRect.top + workspaceEl.clientHeight,
        });
        if (dy !== 0) {
          workspaceEl.scrollTop += dy;
          updateMarquee();
          rafId = window.requestAnimationFrame(tickScroll);
        }
      };

      const cleanup = () => {
        isMarqueeActiveRef.current = false;
        if (rafId) { window.cancelAnimationFrame(rafId); rafId = 0; }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        workspaceEl.classList.remove("is-marquee-selecting");
        setMarquee(null);
      };

      const onMove = (moveEvent: globalThis.PointerEvent) => {
        latestX = moveEvent.clientX;
        latestY = moveEvent.clientY;
        if (!dragging) {
          if (Math.hypot(latestX - startClientX, latestY - startClientY) < 4) return;
          dragging = true;
          isMarqueeActiveRef.current = true;
          didMarqueeDragRef.current = true;
          window.getSelection()?.removeAllRanges();
          if (document.activeElement instanceof HTMLElement && editorWrapEl.contains(document.activeElement)) {
            document.activeElement.blur();
          }
          workspaceEl.classList.add("is-marquee-selecting");
        }
        updateMarquee();
        const curWsRect = workspaceEl.getBoundingClientRect();
        if (!rafId && computeScrollStep(latestY, {
          left: curWsRect.left,
          top: curWsRect.top,
          right: curWsRect.left + workspaceEl.clientWidth,
          bottom: curWsRect.top + workspaceEl.clientHeight,
        }) !== 0) {
          rafId = window.requestAnimationFrame(tickScroll);
        }
      };

      const onCancel = () => {
        cleanup();
        syncDomHighlights(selectedIdsRef.current);
      };

      const onUp = () => {
        const wasDragging = dragging;
        cleanup();
        if (wasDragging) {
          window.setTimeout(() => { didMarqueeDragRef.current = false; }, 0);
          commitSelection(latestHitIds, latestHitIds[0] ?? null, latestHitIds[latestHitIds.length - 1] ?? null);
        } else if (!event.shiftKey && !event.ctrlKey && !event.metaKey) {
          clearSelection();
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    };

    workspaceEl.addEventListener("pointerdown", onPointerDown);
    return () => workspaceEl.removeEventListener("pointerdown", onPointerDown);
  }, [clearSelection, commitSelection, editor, editorWrapRef, startSelectedBlocksDrag, syncDomHighlights, workspaceRef]);

  // キーボード操作（Notion と同様の Escape / Shift+↑↓ / 删除 / 复制 / 移动 / 缩进 / 转换）。
  useEffect(() => {
    const isBlockedContext = (target: EventTarget | null) => {
      const el = target instanceof Element ? target : document.activeElement;
      if (!el) return false;
      if (el.closest(".note-ai-panel, .notes-math-popover, [role='dialog'], [role='menu'], [role='listbox'], #bn-suggestion-menu")) return true;
      if (el.closest("input, textarea, select")) return true;
      if (el instanceof HTMLElement && el.isContentEditable && !el.closest(".bn-editor")) return true;
      return false;
    };

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.isComposing || isBlockedContext(event.target)) return;
      const doc = editor.document as unknown as SelectableBlock[];
      const currentIds = selectedIdsRef.current;

      // ブロック選択が無いとき: エディター内で Esc を押すとキャレットのあるブロックを選択状態にする。
      if (!currentIds.length) {
        if (
          event.key === "Escape" &&
          !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey &&
          event.target instanceof Element &&
          editorWrapRef.current?.contains(event.target) &&
          !document.querySelector("#bn-suggestion-menu, .notes-math-popover")
        ) {
          try {
            const block = editor.getTextCursorPosition().block;
            if (block && !isContainerOnlyBlock(block.type)) {
              event.preventDefault();
              event.stopPropagation();
              if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
              commitSelection([block.id], block.id, block.id);
            }
          } catch { /* カーソル位置がない場合 */ }
        }
        return;
      }

      const roots = normalizeBlockSelection(doc, currentIds);
      if (!roots.length) { clearSelection(); return; }
      const mod = event.ctrlKey || event.metaKey;

      if (event.key === "Escape" && !mod && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        const lastId = roots[roots.length - 1].id;
        clearSelection();
        try {
          editor.setTextCursorPosition(lastId, "end");
          editor.focus();
        } catch { /* 非文字ブロック */ }
        return;
      }

      if ((event.key === "ArrowUp" || event.key === "ArrowDown") && event.shiftKey && !mod && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        const direction = event.key === "ArrowUp" ? "up" : "down";
        const anchor = anchorIdRef.current ?? (direction === "up" ? roots[roots.length - 1].id : roots[0].id);
        const currentFocus = focusIdRef.current ?? (direction === "up" ? roots[0].id : roots[roots.length - 1].id);
        const nextFocus = adjacentSelectableBlockId(doc, currentFocus, direction);
        if (!nextFocus) return;
        const range = expandSelectionRange(doc, anchor, nextFocus);
        if (range.length) {
          commitSelection(range.map((b) => b.id), anchor, nextFocus);
          editorWrapRef.current?.querySelector<HTMLElement>(`.bn-block-outer[data-id="${nextFocus}"]`)?.scrollIntoView({ block: "nearest" });
        }
        return;
      }

      if ((event.key === "Delete" || event.key === "Backspace") && !mod && !event.altKey && editable) {
        event.preventDefault();
        event.stopPropagation();
        const neighbor = adjacentSelectableBlockId(doc, roots[roots.length - 1].id, "down")
          ?? adjacentSelectableBlockId(doc, roots[0].id, "up");
        editor.transact(() => {
          editor.removeBlocks(roots.map((r) => r.id));
        });
        clearSelection();
        if (neighbor && editor.getBlock(neighbor)) {
          try { editor.setTextCursorPosition(neighbor, "start"); editor.focus(); } catch { /* 非文字 */ }
        }
        return;
      }

      if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "d" && editable) {
        event.preventDefault();
        event.stopPropagation();
        duplicateBlocks(editor, roots as never[], (newIds) => commitSelection(newIds, newIds[0], newIds[newIds.length - 1]));
        return;
      }

      if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        event.stopPropagation();
        const allIds = orderedSelectableBlockIds(doc);
        const allRoots = normalizeBlockSelection(doc, allIds);
        if (allRoots.length) commitSelection(allRoots.map((b) => b.id), allRoots[0].id, allRoots[allRoots.length - 1].id);
        return;
      }

      if (event.key === "Enter" && !mod && !event.shiftKey && !event.altKey && editable && roots.length === 1) {
        event.preventDefault();
        event.stopPropagation();
        const id = roots[0].id;
        clearSelection();
        try { editor.setTextCursorPosition(id, "end"); editor.focus(); } catch { /* 非文字 */ }
        return;
      }

      // Ctrl/⌘+Shift+↑/↓ で同階層のブロックを上下に移動。
      if (mod && event.shiftKey && !event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown") && editable) {
        const run = contiguousSiblingRun(doc, roots.map((r) => r.id));
        if (!run) return;
        const movingUp = event.key === "ArrowUp";
        if (movingUp && run.startIndex === 0) return;
        if (!movingUp && run.endIndex === run.siblings.length - 1) return;
        event.preventDefault();
        event.stopPropagation();
        const target = movingUp ? run.siblings[run.startIndex - 1] : run.siblings[run.endIndex + 1];
        const copies = copyNoteBlocks(roots);
        editor.transact(() => {
          editor.insertBlocks(copies as never[], target.id, movingUp ? "before" : "after");
          editor.removeBlocks(roots.map((r) => r.id));
        });
        const newIds = copies.map((copy) => copy.id);
        commitSelection(newIds, newIds[0], newIds[newIds.length - 1]);
        return;
      }

      // Tab / Shift+Tab でインデント（入れ子）・アンインデント。
      if (event.key === "Tab" && !mod && !event.altKey && editable) {
        const run = contiguousSiblingRun(doc, roots.map((r) => r.id));
        if (!run) return;
        if (!event.shiftKey) {
          if (run.startIndex === 0) return;
          const prev = run.siblings[run.startIndex - 1];
          if (isContainerOnlyBlock(prev.type) || prev.type === "table") return;
          event.preventDefault();
          event.stopPropagation();
          const copies = copyNoteBlocks(roots);
          editor.transact(() => {
            if (prev.children.length) {
              editor.insertBlocks(copies as never[], prev.children[prev.children.length - 1].id, "after");
            } else {
              editor.updateBlock(prev.id, { children: copies } as never);
            }
            editor.removeBlocks(roots.map((r) => r.id));
          });
          const newIds = copies.map((copy) => copy.id);
          commitSelection(newIds, newIds[0], newIds[newIds.length - 1]);
        } else {
          if (!run.parent || isContainerOnlyBlock(run.parent.type)) return;
          event.preventDefault();
          event.stopPropagation();
          const copies = copyNoteBlocks(roots);
          editor.transact(() => {
            editor.insertBlocks(copies as never[], run.parent!.id, "after");
            editor.removeBlocks(roots.map((r) => r.id));
          });
          const newIds = copies.map((copy) => copy.id);
          commitSelection(newIds, newIds[0], newIds[newIds.length - 1]);
        }
        return;
      }

      // Ctrl+Shift+0–8 / ⌘+⌥+0–8 で選択中のブロックを一括変換。
      if (((event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey) || (event.metaKey && event.altKey && !event.ctrlKey && !event.shiftKey)) && editable) {
        const digit = event.code.replace(/^Digit/, "");
        const target = NOTE_TEXT_BLOCKS.find((item) => item.digit === digit);
        if (target) {
          event.preventDefault();
          event.stopPropagation();
          convertBlocks(editor, target, roots as never[], true);
        }
      }
    };

    const onCopyOrCut = (event: ClipboardEvent) => {
      if (!selectedIdsRef.current.length || isBlockedContext(event.target)) return;
      const doc = editor.document as unknown as SelectableBlock[];
      const roots = normalizeBlockSelection(doc, selectedIdsRef.current);
      if (!roots.length) return;
      const markdown = blocksToMarkdown(roots as unknown as NoteBlock[]);
      copiedBlocksClipboard = { text: markdown, blocks: copyNoteBlocks(roots) };
      if (event.clipboardData) {
        event.preventDefault();
        event.clipboardData.setData("text/plain", markdown);
      }
      if (event.type === "cut" && editable) {
        editor.transact(() => editor.removeBlocks(roots.map((r) => r.id)));
        clearSelection();
      }
    };

    const onPaste = (event: ClipboardEvent) => {
      if (!editable || !selectedIdsRef.current.length || isBlockedContext(event.target)) return;
      const plain = event.clipboardData?.getData("text/plain") ?? "";
      if (!copiedBlocksClipboard || plain !== copiedBlocksClipboard.text) return;
      const doc = editor.document as unknown as SelectableBlock[];
      const roots = normalizeBlockSelection(doc, selectedIdsRef.current);
      if (!roots.length) return;
      event.preventDefault();
      const copies = copyNoteBlocks(copiedBlocksClipboard.blocks);
      editor.transact(() => {
        editor.insertBlocks(copies as never[], roots[roots.length - 1].id, "after");
        editor.removeBlocks(roots.map((r) => r.id));
      });
      const newIds = copies.map((copy) => copy.id);
      commitSelection(newIds, newIds[0], newIds[newIds.length - 1]);
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("copy", onCopyOrCut);
    window.addEventListener("cut", onCopyOrCut);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("copy", onCopyOrCut);
      window.removeEventListener("cut", onCopyOrCut);
      window.removeEventListener("paste", onPaste);
    };
  }, [clearSelection, commitSelection, editable, editor, editorWrapRef]);

  const selectedIdSet = useMemo(() => new Set(safeSelectedIds), [safeSelectedIds]);
  const overlayProps: OverlayData = {
    editor,
    editable,
    selectedIds: safeSelectedIds,
    docVersion: typeof docVersion === "number" ? docVersion : 0,
    marquee,
    moveDrag,
    workspaceRef,
    editorWrapRef,
    onAskAi,
    onSelectIds: (ids, anchor) => commitSelection(ids, anchor),
    onClearSelection: clearSelection,
  };

  return {
    selectedIds: safeSelectedIds,
    selectedIdSet,
    isDraggingBlocks: Boolean(moveDrag?.active),
    didMarqueeDragRef,
    clearSelection,
    selectBlocks: commitSelection,
    startSelectedBlocksDrag,
    overlayProps,
  };
}

export function NoteBlockSelectionOverlay({
  editor,
  editable,
  selectedIds,
  docVersion,
  marquee,
  moveDrag,
  workspaceRef,
  editorWrapRef,
  onAskAi,
  onSelectIds,
  onClearSelection,
}: OverlayData) {
  const { t } = useI18n();
  const [openMenu, setOpenMenu] = useState<"turn" | "color" | null>(null);
  const [barPos, setBarPos] = useState<{ left: number; top: number } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const roots = useMemo(
    () => {
      void docVersion;
      return normalizeBlockSelection(editor.document as unknown as SelectableBlock[], selectedIds);
    },
    [editor, selectedIds, docVersion],
  );

  const showBar = roots.length > 0 && !marquee && !moveDrag?.active;
  const activeMenu = showBar ? openMenu : null;

  useEffect(() => {
    if (!activeMenu) return;
    const onDown = (event: globalThis.PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".notes-block-bar")) return;
      setOpenMenu(null);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpenMenu(null);
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [activeMenu]);

  const repositionBar = useCallback(() => {
    const wrap = editorWrapRef.current;
    if (!wrap || !roots.length || !showBar) {
      setBarPos((prev) => (prev === null ? prev : null));
      return;
    }
    const rects = roots
      .map((root) => wrap.querySelector<HTMLElement>(`.bn-block-outer[data-id="${root.id}"]`)?.getBoundingClientRect())
      .filter((rect): rect is DOMRect => Boolean(rect && rect.width > 0 && rect.height > 0));
    if (!rects.length) {
      setBarPos((prev) => (prev === null ? prev : null));
      return;
    }
    const unionTop = Math.min(...rects.map((r) => r.top));
    const unionBottom = Math.max(...rects.map((r) => r.bottom));
    const unionLeft = Math.min(...rects.map((r) => r.left));

    const wsEl = workspaceRef?.current;
    const wsRect = wsEl?.getBoundingClientRect() ?? {
      left: 0,
      top: 0,
      right: document.documentElement.clientWidth,
      bottom: document.documentElement.clientHeight,
    };
    if (unionBottom < wsRect.top + 8 || unionTop > wsRect.bottom - 8) {
      setBarPos((prev) => (prev === null ? prev : null));
      return;
    }
    const barWidth = barRef.current?.offsetWidth || 320;
    const barHeight = barRef.current?.offsetHeight || 40;
    const vw = document.documentElement.clientWidth;
    const minTop = Math.max(10, wsRect.top + 8);
    let top = unionTop - barHeight - 8;
    if (top < minTop) {
      const below = unionBottom + 8;
      top = below + barHeight <= wsRect.bottom - 8 ? below : minTop;
    }
    const left = Math.min(Math.max(unionLeft, 12), Math.max(12, vw - barWidth - 12));
    setBarPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
  }, [editorWrapRef, roots, showBar, workspaceRef]);

  useLayoutEffect(() => {
    repositionBar();
  }, [repositionBar, activeMenu, selectedIds]);

  useEffect(() => {
    if (!showBar) return;
    const wsEl = workspaceRef?.current;
    const onScrollOrResize = () => repositionBar();
    wsEl?.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      wsEl?.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [repositionBar, showBar, workspaceRef]);

  if (typeof document === "undefined") return null;

  const hasConvertible = roots.some((block) => Array.isArray(block.content));
  const hasTextColor = roots.some((block) => "textColor" in (editor.schema.blockSchema[block.type]?.propSchema ?? {}));
  const hasBgColor = roots.some((block) => "backgroundColor" in (editor.schema.blockSchema[block.type]?.propSchema ?? {}));
  const firstProps = (roots[0]?.props ?? {}) as Record<string, unknown>;
  const countLabel = roots.length === 1 ? t("1 block") : t("{count} blocks", { count: roots.length });

  return createPortal(
    <>
      {marquee && (
        <div
          className="notes-marquee-box"
          aria-hidden="true"
          style={{
            left: marquee.left,
            top: marquee.top,
            width: marquee.right - marquee.left,
            height: marquee.bottom - marquee.top,
          }}
        />
      )}

      {showBar && (
        <div
          ref={barRef}
          className="notes-block-bar"
          role="toolbar"
          aria-label={t("Block selection actions")}
          style={barPos ? { left: barPos.left, top: barPos.top } : { left: -9999, top: -9999, opacity: 0, pointerEvents: "none" }}
          onMouseDown={(event) => event.preventDefault()}
        >
          {onAskAi && (
            <button
              type="button"
              className="notes-block-bar-ai"
              onClick={() => {
                const payload = buildNoteBlockSelection(editor.document as unknown as SelectableBlock[], roots.map((b) => b.id));
                if (payload) onAskAi(payload);
              }}
            >
              <AppIcon size={15} />
              <span>{t("Ask NoteFable")}</span>
            </button>
          )}
          <span className="notes-block-bar-count">{countLabel}</span>
          {editable ? (
            <>
              {hasConvertible && (
                <div className="notes-block-bar-group">
                  <button
                    type="button"
                    className={`notes-block-bar-btn ${activeMenu === "turn" ? "is-active" : ""}`}
                    aria-expanded={activeMenu === "turn"}
                    aria-haspopup="menu"
                    onClick={() => setOpenMenu((cur) => (cur === "turn" ? null : "turn"))}
                  >
                    <Text size={14} aria-hidden="true" />
                    <span>{t("Turn into")}</span>
                    <ChevronDown size={13} aria-hidden="true" />
                  </button>
                  {activeMenu === "turn" && (
                    <div className="notes-block-bar-popover" role="menu">
                      {NOTE_TEXT_BLOCKS.map((target) => {
                        const checked = Boolean(roots[0]) && blockMatchesTarget(roots[0], target);
                        return (
                          <button
                            key={target.key}
                            type="button"
                            role="menuitem"
                            className="notes-block-bar-menu-item"
                            onClick={() => {
                              convertBlocks(editor, target, roots as never[], true);
                              setOpenMenu(null);
                            }}
                          >
                            <span className="flex-1 truncate">{t(target.title)}</span>
                            {checked && <Check size={14} aria-hidden="true" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {(hasTextColor || hasBgColor) && (
                <div className="notes-block-bar-group">
                  <button
                    type="button"
                    className={`notes-block-bar-btn ${activeMenu === "color" ? "is-active" : ""}`}
                    aria-expanded={activeMenu === "color"}
                    aria-haspopup="menu"
                    aria-label={t("Color")}
                    title={t("Color")}
                    onClick={() => setOpenMenu((cur) => (cur === "color" ? null : "color"))}
                  >
                    <Palette size={14} aria-hidden="true" />
                  </button>
                  {activeMenu === "color" && (
                    <div className="notes-block-bar-popover is-colors" role="menu">
                      {hasTextColor && (
                        <>
                          <div className="notes-block-bar-label">{t("Text color")}</div>
                          <div className="notes-block-bar-swatches">
                            {BLOCK_COLORS.map((color) => {
                              const swatchColor = color.key === "default" ? undefined : COLORS_DEFAULT[color.key].text;
                              const active = firstProps.textColor === color.key;
                              return (
                                <button
                                  key={`text:${color.key}`}
                                  type="button"
                                  className={`notes-block-bar-swatch ${active ? "is-selected" : ""}`}
                                  style={swatchColor ? { color: swatchColor } : undefined}
                                  title={t(color.title)}
                                  aria-label={t(color.title)}
                                  onClick={() => {
                                    paintBlocksColor(editor, roots, "textColor", color.key);
                                    setOpenMenu(null);
                                  }}
                                >
                                  A
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                      {hasBgColor && (
                        <>
                          <div className="notes-block-bar-label">{t("Background color")}</div>
                          <div className="notes-block-bar-swatches">
                            {BLOCK_COLORS.map((color) => {
                              const swatchBg = color.key === "default" ? undefined : COLORS_DEFAULT[color.key].background;
                              const active = firstProps.backgroundColor === color.key;
                              return (
                                <button
                                  key={`bg:${color.key}`}
                                  type="button"
                                  className={`notes-block-bar-swatch is-bg ${active ? "is-selected" : ""}`}
                                  style={swatchBg ? { background: swatchBg } : undefined}
                                  title={t(color.title)}
                                  aria-label={t(color.title)}
                                  onClick={() => {
                                    paintBlocksColor(editor, roots, "backgroundColor", color.key);
                                    setOpenMenu(null);
                                  }}
                                >
                                  A
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              <span className="notes-block-bar-sep" aria-hidden="true" />
              <button
                type="button"
                className="notes-block-bar-btn"
                aria-label={t("Duplicate")}
                title={t("Duplicate")}
                onClick={() => duplicateBlocks(editor, roots as never[], (newIds) => onSelectIds(newIds, newIds[0]))}
              >
                <Copy size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="notes-block-bar-btn is-danger"
                aria-label={t("Delete")}
                title={t("Delete")}
                onClick={() => {
                  editor.transact(() => editor.removeBlocks(roots.map((r) => r.id)));
                  onClearSelection();
                }}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="notes-block-bar-btn"
              aria-label={t("Copy")}
              title={t("Copy")}
              onClick={() => {
                const md = blocksToMarkdown(roots as unknown as NoteBlock[]);
                void navigator.clipboard?.writeText(md);
              }}
            >
              <Copy size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {moveDrag?.active && moveDrag.drop && (
        moveDrag.drop.kind === "vertical" ? (
          <div
            className="notes-drop-indicator is-horizontal"
            aria-hidden="true"
            style={{
              left: moveDrag.drop.line.left,
              top: moveDrag.drop.line.top,
              width: moveDrag.drop.line.width,
            }}
          />
        ) : (
          <div
            className="notes-drop-indicator is-vertical"
            aria-hidden="true"
            style={{
              left: moveDrag.drop.target.rect.left - 1,
              top: moveDrag.drop.target.rect.top,
              height: moveDrag.drop.target.rect.height,
            }}
          />
        )
      )}

      {moveDrag?.active && (
        <div
          className="notes-block-drag-ghost"
          aria-hidden="true"
          style={{
            left: moveDrag.pointerX + 14,
            top: moveDrag.pointerY + 12,
          }}
        >
          <GripVertical size={14} />
          <span className="notes-block-drag-ghost-label">{moveDrag.label}</span>
          <span className="notes-block-drag-ghost-count">
            {moveDrag.count === 1 ? t("1 block") : t("{count} blocks", { count: moveDrag.count })}
          </span>
        </div>
      )}
    </>,
    document.body,
  );
}
