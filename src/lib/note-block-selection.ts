import { normalizeQuote } from "@/lib/chat-quote";
import { selectedRootBlocks } from "@/lib/note-block-actions";
import { COLUMN, COLUMN_LIST } from "@/lib/note-columns";
import { blocksToMarkdown, type NoteBlock } from "@/lib/note-markdown";
import type { PageSelection } from "@/lib/page-ai/types";

export type SelectionRect = { left: number; top: number; right: number; bottom: number };

export type SelectableBlock = {
  id: string;
  type: string;
  children: SelectableBlock[];
  content?: unknown;
  props?: Record<string, unknown>;
};

export function rectFromPoints(ax: number, ay: number, bx: number, by: number): SelectionRect {
  return {
    left: Math.min(ax, bx),
    top: Math.min(ay, by),
    right: Math.max(ax, bx),
    bottom: Math.max(ay, by),
  };
}

export function rectsIntersect(a: SelectionRect, b: SelectionRect): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

export function clampRect(rect: SelectionRect, bounds: SelectionRect): SelectionRect | null {
  const left = Math.max(rect.left, bounds.left);
  const top = Math.max(rect.top, bounds.top);
  const right = Math.min(rect.right, bounds.right);
  const bottom = Math.min(rect.bottom, bounds.bottom);
  if (right <= left || bottom <= top) return null;
  return { left, top, right, bottom };
}

export const MAX_NOTE_BLOCK_DEPTH = 8;
export const NOTEFABLE_BLOCKS_MIME = "application/x-notefable-blocks";

export function isContainerOnlyBlock(type: string): boolean {
  return type === COLUMN_LIST || type === COLUMN;
}

export function orderedSelectableBlockIds(
  blocks: readonly SelectableBlock[],
  collapsedParentIds?: ReadonlySet<string>,
): string[] {
  const ids: string[] = [];
  const visit = (list: readonly SelectableBlock[]) => {
    for (const block of list) {
      if (!isContainerOnlyBlock(block.type)) {
        ids.push(block.id);
      }
      if (block.children.length && !collapsedParentIds?.has(block.id)) {
        visit(block.children);
      }
    }
  };
  visit(blocks);
  return ids;
}

export function collectSubtreeIds(blocks: readonly SelectableBlock[], rootIds: readonly string[]): Set<string> {
  const targets = new Set(rootIds);
  const out = new Set<string>();
  const collectAll = (block: SelectableBlock) => {
    out.add(block.id);
    for (const child of block.children) collectAll(child);
  };
  const visit = (list: readonly SelectableBlock[]) => {
    for (const block of list) {
      if (targets.has(block.id)) {
        collectAll(block);
      } else if (block.children.length) {
        visit(block.children);
      }
    }
  };
  visit(blocks);
  return out;
}

export function normalizeBlockSelection(blocks: readonly SelectableBlock[], rawIds: readonly string[]): SelectableBlock[] {
  if (!rawIds.length) return [];
  const wanted = new Set(rawIds);
  const ordered: SelectableBlock[] = [];
  const visit = (list: readonly SelectableBlock[]) => {
    for (const block of list) {
      if (!isContainerOnlyBlock(block.type) && wanted.has(block.id)) {
        ordered.push(block);
      }
      if (block.children.length) {
        visit(block.children);
      }
    }
  };
  visit(blocks);
  return selectedRootBlocks(ordered);
}

export function expandSelectionRange(
  blocks: readonly SelectableBlock[],
  anchorId: string,
  targetId: string,
  collapsedParentIds?: ReadonlySet<string>,
): SelectableBlock[] {
  const ordered = orderedSelectableBlockIds(blocks, collapsedParentIds);
  const a = ordered.indexOf(anchorId);
  const b = ordered.indexOf(targetId);
  if (a < 0 || b < 0) return [];
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  return normalizeBlockSelection(blocks, ordered.slice(start, end + 1));
}

export function adjacentSelectableBlockId(
  blocks: readonly SelectableBlock[],
  currentId: string,
  direction: "up" | "down",
  collapsedParentIds?: ReadonlySet<string>,
): string | null {
  const ordered = orderedSelectableBlockIds(blocks, collapsedParentIds);
  const idx = ordered.indexOf(currentId);
  if (idx < 0) return null;
  const nextIdx = direction === "up" ? idx - 1 : idx + 1;
  return nextIdx >= 0 && nextIdx < ordered.length ? ordered[nextIdx] : null;
}

function contentBlockDepth(blocks: readonly SelectableBlock[], targetId: string, depth = 0): number {
  for (const block of blocks) {
    if (block.id === targetId) return depth;
    if (block.children.length) {
      const nextDepth = isContainerOnlyBlock(block.type) ? depth : depth + 1;
      const found = contentBlockDepth(block.children, targetId, nextDepth);
      if (found >= 0) return found;
    }
  }
  return -1;
}

function maxRelativeContentDepth(block: SelectableBlock): number {
  if (!block.children.length) return 0;
  let deepest = 0;
  for (const child of block.children) {
    const childDepth = isContainerOnlyBlock(child.type)
      ? maxRelativeContentDepth(child)
      : 1 + maxRelativeContentDepth(child);
    if (childDepth > deepest) deepest = childDepth;
  }
  return deepest;
}

export function canIndentBlocks(
  blocks: readonly SelectableBlock[],
  targetParentId: string,
  roots: readonly SelectableBlock[],
): boolean {
  const parentDepth = contentBlockDepth(blocks, targetParentId);
  if (parentDepth < 0) return false;
  const deepestRoot = roots.reduce((max, root) => Math.max(max, maxRelativeContentDepth(root)), 0);
  return parentDepth + 1 + deepestRoot <= MAX_NOTE_BLOCK_DEPTH;
}

export function parseClipboardBlocks(raw: string): SelectableBlock[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return null;
    const valid = parsed.every(
      (item): item is SelectableBlock =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { id?: unknown }).id === "string" &&
        typeof (item as { type?: unknown }).type === "string" &&
        Array.isArray((item as { children?: unknown }).children),
    );
    return valid ? parsed : null;
  } catch {
    return null;
  }
}

function findSiblingList(blocks: readonly SelectableBlock[], targetId: string): readonly SelectableBlock[] | null {
  for (const block of blocks) {
    if (block.id === targetId) return blocks;
    if (block.children.length) {
      const found = findSiblingList(block.children, targetId);
      if (found) return found;
    }
  }
  return null;
}

export function isNoOpBlockMove(
  blocks: readonly SelectableBlock[],
  rootIds: readonly string[],
  targetId: string,
  placement: "before" | "after",
): boolean {
  if (!rootIds.length) return true;
  if (rootIds.includes(targetId)) return true;
  const siblings = findSiblingList(blocks, targetId);
  if (!siblings) return false;
  const targetIndex = siblings.findIndex((b) => b.id === targetId);
  if (targetIndex < 0) return false;
  const indices: number[] = [];
  for (const id of rootIds) {
    const idx = siblings.findIndex((b) => b.id === id);
    if (idx < 0) return false;
    indices.push(idx);
  }
  indices.sort((a, b) => a - b);
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] !== indices[i - 1] + 1) return false;
  }
  const firstIdx = indices[0];
  const lastIdx = indices[indices.length - 1];
  return placement === "before" ? targetIndex === lastIdx + 1 : targetIndex === firstIdx - 1;
}

export function buildNoteBlockSelection(blocks: readonly SelectableBlock[], selectedRootIds: readonly string[]): PageSelection | null {
  const roots = normalizeBlockSelection(blocks, selectedRootIds);
  if (!roots.length) return null;
  const text = normalizeQuote(blocksToMarkdown(roots as unknown as NoteBlock[]));
  return {
    text,
    ids: roots.map((block) => block.id),
  };
}

const MARQUEE_BLOCKED_SELECTOR = [
  ".bn-block-content",
  ".notes-header-inner",
  ".notes-cover",
  ".notes-title",
  "button:not(.notes-editor-tail)",
  "a",
  "input",
  "textarea",
  "select",
  '[role="menu"]',
  '[role="dialog"]',
  '[role="listbox"]',
  '[role="toolbar"]',
  ".bn-side-menu",
  ".bn-formatting-toolbar",
  ".bn-file-panel",
  ".bn-table-handle",
  ".bn-resize-handle",
  ".bn-column-resize-border",
  ".notes-slash-menu",
  ".notes-math-popover",
  ".notes-code-copy",
  ".notes-block-bar",
  ".note-ai-fab",
  ".note-ai-panel",
  ".note-ai-bubble",
  ".notes-storage-limit",
  ".notes-action-error",
  ".notion-warning",
  ".notes-backlinks",
].join(", ");

export function canStartMarqueeTarget(target: Element | null, workspaceEl: Element | null): boolean {
  if (!target || !workspaceEl || !workspaceEl.contains(target)) return false;
  if (typeof document !== "undefined" && document.body.classList.contains("notes-column-resizing")) return false;
  if (target.closest(MARQUEE_BLOCKED_SELECTOR)) return false;
  return true;
}
