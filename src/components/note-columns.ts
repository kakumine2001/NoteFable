"use client";

// 段組み（Notion の Columns）。BlockNote の core（MPL）は columnList / column という名前のノードを前提にした処理
// （ブロックの移動・削除で空になった段の片付けなど）を持っているので、ここではそのノードとブロックの定義、
// ブロックを左右へドロップして段を作る処理、段の境目をドラッグして幅を変える処理を自前で用意する。
// 公式の @blocknote/xl-multi-column（GPL または有償）は使わない。

import { createBlockSpecFromTiptapNode, createExtension, fixColumnList, fragmentToBlocks, getNodeById, type BlockNoteEditor, type ComputeDropPositionContext } from "@blocknote/core";
import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { COLUMN, COLUMN_LIST, MAX_COLUMNS, MIN_COLUMN_WIDTH, unwrapColumns, validColumnWidth } from "@/lib/note-columns";

// 段組みの外側。2 段以上の column だけを持つ。
const ColumnListNode = Node.create({
  name: COLUMN_LIST,
  group: "childContainer bnBlock blockGroupChild",
  content: "column column+",
  priority: 40,
  defining: true,
  parseHTML() { return [{ tag: `div[data-node-type="${COLUMN_LIST}"]` }]; },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { class: "bn-block-column-list", "data-node-type": COLUMN_LIST }), 0];
  },
});

// 1 つの段。幅は兄弟の段との比（flex-grow）。
const ColumnNode = Node.create({
  name: COLUMN,
  group: "bnBlock childContainer",
  content: "blockContainer+",
  priority: 40,
  defining: true,
  addAttributes() {
    return {
      width: {
        default: 1,
        parseHTML: (element: HTMLElement) => {
          const width = Number(element.getAttribute("data-width"));
          return validColumnWidth(width) ? width : 1;
        },
        renderHTML: (attributes: { width?: unknown }) => {
          const width = validColumnWidth(attributes.width) ? attributes.width : 1;
          return { "data-width": String(width), style: `flex-grow: ${width}` };
        },
      },
    };
  },
  parseHTML() { return [{ tag: `div[data-node-type="${COLUMN}"]` }]; },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { class: "bn-block-column", "data-node-type": COLUMN }), 0];
  },
});

// 段組みの処理はスキーマの型に依存しないので、エディターの型は広く取る。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = BlockNoteEditor<any, any, any>;
type Side = "left" | "right";
// ドロップ先: 段の外のブロックなら、そのブロックと運んだブロックで新しい段組みを作る。段の中のブロックなら、その段の隣に段を足す。
type SideTarget = { side: Side; blockId: string; cursorPos: number };

// 左右のドロップを受け付ける幅（ブロックの端から）。
const SIDE_ZONE_MAX = 96;
const SIDE_ZONE_RATIO = 0.2;
// 左の端に触れただけ（ハンドルからドラッグを始めた直後や、エディターの外から押し戻された座標）では段にしない。
const LEFT_EDGE_GAP = 8;

function sideDropTarget(view: EditorView, event: DragEvent): SideTarget | null {
  if (!view.editable || !view.dragging) return null;
  const editorRect = view.dom.getBoundingClientRect();
  const x = Math.min(Math.max(event.clientX, editorRect.left + 1), editorRect.right - 1);
  const hit = view.dom.ownerDocument.elementFromPoint(x, event.clientY);
  const element = hit instanceof Element && view.dom.contains(hit) ? hit.closest<HTMLElement>('[data-node-type="blockContainer"]') : null;
  const id = element?.getAttribute("data-id");
  if (!id) return null;
  const found = getNodeById(id, view.state.doc);
  if (!found) return null;
  const doc = view.state.doc;
  // 入れ子の子ブロックの上なら、最上位か段の中にある祖先のブロックを対象にする（段組みは段の外の入れ子の中には作らない）。
  let $pos = doc.resolve(found.posBeforeNode);
  while ($pos.parent.type.name === "blockGroup" && $pos.depth > 1) $pos = doc.resolve($pos.before($pos.depth - 1));
  const block = $pos.nodeAfter;
  if (!block) return null;
  const inColumn = $pos.parent.type.name === COLUMN;
  const blockPos = $pos.pos;
  const columnPos = inColumn ? $pos.before($pos.depth) : -1;
  if (inColumn && $pos.node($pos.depth - 1).childCount >= MAX_COLUMNS) return null;

  // 運んでいるブロック自身の上や、運ぶブロックしかない段の横には置けない。
  const { from, to } = view.state.selection;
  if (blockPos >= from && blockPos < to) return null;
  if (inColumn) {
    const column = $pos.parent;
    if (from <= columnPos + 1 && to >= columnPos + column.nodeSize - 1) return null;
  }

  const cursorPos = inColumn ? columnPos : blockPos;
  const dom = view.nodeDOM(cursorPos);
  if (!(dom instanceof HTMLElement)) return null;
  const rect = dom.getBoundingClientRect();
  const zone = Math.min(SIDE_ZONE_MAX, rect.width * SIDE_ZONE_RATIO);
  const side: Side | null = event.clientX > rect.right - zone ? "right"
    : event.clientX >= rect.left + LEFT_EDGE_GAP && event.clientX < rect.left + zone ? "left" : null;
  if (!side) return null;
  const blockId = block.attrs.id;
  return typeof blockId === "string" ? { side, blockId, cursorPos } : null;
}

// ドラッグ中の線: 左右に置けるときは縦線（BlockNote の DropCursor が描く）。
export function computeColumnDropPosition({ view, event, defaultPosition }: ComputeDropPositionContext) {
  const target = sideDropTarget(view, event);
  return target ? { pos: target.cursorPos, orientation: target.side === "left" ? "block-vertical-left" as const : "block-vertical-right" as const } : defaultPosition;
}

type JsonBlock = { id?: string; type: string; props?: Record<string, unknown>; content?: unknown; children?: JsonBlock[] };

// 別のエディターから運んできたブロックは、この文書の ID と重ならないよう ID を付け直す。
function withoutIds(blocks: JsonBlock[]): JsonBlock[] {
  return blocks.map((block) => {
    const copy = { ...block, children: withoutIds(block.children ?? []) };
    delete copy.id;
    return copy;
  });
}

function dropBeside(editor: AnyEditor, view: EditorView, target: SideTarget, moved: boolean) {
  const slice = view.dragging?.slice;
  if (!slice) return false;
  const dragged = fragmentToBlocks(slice.content) as unknown as JsonBlock[];
  if (!dragged.length) return false;
  // この文書から運んだ（コピーではない）ブロックは元の場所から外す。外した後で、段が空になれば core が片付ける。
  const local = moved && dragged.every((block) => block.id && editor.getBlock(block.id));
  const moving = local ? unwrapColumns(dragged) : withoutIds(unwrapColumns(dragged));
  let firstMoved: string | undefined;
  editor.transact(() => {
    if (local) editor.removeBlocks(dragged.map((block) => block.id!));
    const targetBlock = editor.getBlock(target.blockId);
    if (!targetBlock) return;
    const parent = editor.getParentBlock(target.blockId);
    if (parent?.type === COLUMN) {
      const list = editor.getParentBlock(parent.id);
      const columns = (list?.children ?? []) as JsonBlock[];
      const widths = columns.map((column) => Number(column.props?.width)).filter(validColumnWidth);
      const width = widths.length ? Math.max(MIN_COLUMN_WIDTH, widths.reduce((sum, value) => sum + value, 0) / widths.length) : 1;
      const [inserted] = editor.insertBlocks([{ type: COLUMN, props: { width }, children: moving } as never], parent.id, target.side === "left" ? "before" : "after");
      firstMoved = (inserted?.children?.[0] as JsonBlock | undefined)?.id;
    } else {
      const own = { type: COLUMN, props: { width: 1 }, children: [targetBlock] };
      const added = { type: COLUMN, props: { width: 1 }, children: moving };
      const { insertedBlocks } = editor.replaceBlocks([target.blockId], [{ type: COLUMN_LIST, children: target.side === "left" ? [added, own] : [own, added] } as never]);
      const list = insertedBlocks[0] as unknown as JsonBlock | undefined;
      firstMoved = list?.children?.[target.side === "left" ? 0 : 1]?.children?.[0]?.id;
    }
  });
  // 運んだ先頭のブロックにキャレットを置く（文字を持たないブロックなら何もしない）。
  if (firstMoved) { try { editor.setTextCursorPosition(firstMoved, "end"); } catch { /* 表・画像など */ } }
  return true;
}

// 段の境目をドラッグして幅を変える。境目から 6px 以内でカーソルが col-resize になる（見た目は BlockNote の CSS）。
const RESIZE_HIT = 6;
const MIN_COLUMN_PX = 48;
const HOVER_CLASS = "bn-column-list-hovered";
const BORDER_CLASS = "bn-column-resize-border";

function columnElements(list: Element) {
  return Array.from(list.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.getAttribute("data-node-type") === COLUMN);
}

function resizePlugin() {
  return new Plugin({
    key: new PluginKey("notes-column-resize"),
    view(view) {
      let hovered: HTMLElement | null = null;
      let border: { left: HTMLElement; right: HTMLElement } | null = null;
      let drag: { startX: number; left: HTMLElement; right: HTMLElement; leftPx: number; rightPx: number; total: number; leftWidth: number; rightWidth: number } | null = null;
      const setBorder = (next: typeof border) => {
        if (border?.left === next?.left) return;
        border?.left.classList.remove(BORDER_CLASS);
        border = next;
        border?.left.classList.add(BORDER_CLASS);
      };
      const setHovered = (next: HTMLElement | null) => {
        if (hovered === next) return;
        hovered?.classList.remove(HOVER_CLASS);
        hovered = next;
        hovered?.classList.add(HOVER_CLASS);
        if (!next) setBorder(null);
      };
      const widthOf = (element: HTMLElement) => {
        const id = element.getAttribute("data-id");
        const found = id ? getNodeById(id, view.state.doc) : undefined;
        const width = found?.node.attrs.width;
        return validColumnWidth(width) ? width : 1;
      };
      // 段の境目の上には右の段のブロックのハンドル（エディターの外に描かれる）が重なるので、
      // 要素ではなく座標で、ページ全体の pointer イベントから段組みと境目を探す。
      const listAt = (x: number, y: number) => {
        if (!view.editable) return null;
        for (const list of view.dom.querySelectorAll<HTMLElement>(".bn-block-column-list")) {
          const rect = list.getBoundingClientRect();
          if (y >= rect.top && y <= rect.bottom && x >= rect.left - RESIZE_HIT && x <= rect.right + RESIZE_HIT) return list;
        }
        return null;
      };
      const track = (event: PointerEvent) => {
        const list = listAt(event.clientX, event.clientY);
        setHovered(list);
        // 狭い画面では段が縦に積まれるので、幅は変えられない。
        if (!list || getComputedStyle(list).flexDirection !== "row") { setBorder(null); return; }
        const columns = columnElements(list);
        let next: typeof border = null;
        for (let index = 0; index < columns.length - 1; index++) {
          if (Math.abs(event.clientX - columns[index].getBoundingClientRect().right) <= RESIZE_HIT) { next = { left: columns[index], right: columns[index + 1] }; break; }
        }
        setBorder(next);
      };
      const onMove = (event: PointerEvent) => { if (!drag) track(event); };
      const onDragMove = (event: PointerEvent) => {
        if (!drag) return;
        const span = drag.leftPx + drag.rightPx;
        if (!Number.isFinite(event.clientX) || span <= 2 * MIN_COLUMN_PX) return;
        const leftPx = Math.min(Math.max(drag.leftPx + event.clientX - drag.startX, MIN_COLUMN_PX), span - MIN_COLUMN_PX);
        drag.leftWidth = drag.total * leftPx / span;
        drag.rightWidth = drag.total - drag.leftWidth;
        drag.left.style.flexGrow = String(drag.leftWidth);
        drag.right.style.flexGrow = String(drag.rightWidth);
      };
      const finish = () => {
        if (!drag) return;
        const { left, right, leftWidth, rightWidth } = drag;
        drag = null;
        window.removeEventListener("pointermove", onDragMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        document.body.classList.remove("notes-column-resizing");
        // 幅は小数 3 桁に丸めて保存する（JSON を短く保つ）。
        const round = (value: number) => Math.round(value * 1000) / 1000;
        let tr = view.state.tr;
        for (const [element, width] of [[left, leftWidth], [right, rightWidth]] as const) {
          const id = element.getAttribute("data-id");
          const found = id ? getNodeById(id, tr.doc) : undefined;
          if (found && validColumnWidth(round(width))) tr = tr.setNodeMarkup(found.posBeforeNode, undefined, { ...found.node.attrs, width: round(width) });
        }
        if (tr.docChanged) view.dispatch(tr);
      };
      const onDown = (event: PointerEvent) => {
        if (event.button !== 0 || !view.editable || drag) return;
        // 直前に pointermove が無い（タッチやペンでいきなり押した）場合も、押した位置で境目を判定する。
        track(event);
        if (!border) return;
        // pointerdown を止めると、ProseMirror の mousedown（選択の開始）も起きない。
        event.preventDefault();
        event.stopPropagation();
        const leftWidth = widthOf(border.left);
        const rightWidth = widthOf(border.right);
        drag = {
          startX: event.clientX, left: border.left, right: border.right,
          leftPx: border.left.getBoundingClientRect().width, rightPx: border.right.getBoundingClientRect().width,
          total: leftWidth + rightWidth, leftWidth, rightWidth,
        };
        document.body.classList.add("notes-column-resizing");
        window.addEventListener("pointermove", onDragMove);
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", finish);
      };
      // 境目をつかんだときは、重なっているハンドルのブロックのドラッグを始めない。
      const onDragStart = (event: Event) => { if (border || drag) event.preventDefault(); };
      const root = view.root as Document;
      root.addEventListener("pointermove", onMove as EventListener);
      root.addEventListener("pointerdown", onDown as EventListener, true);
      root.addEventListener("dragstart", onDragStart, true);
      return {
        destroy() {
          finish();
          setHovered(null);
          root.removeEventListener("pointermove", onMove as EventListener);
          root.removeEventListener("pointerdown", onDown as EventListener, true);
          root.removeEventListener("dragstart", onDragStart, true);
        },
      };
    },
  });
}

// ブロックを普通にドラッグして（上下の位置へ）段の外に出したとき、元の段が空のまま残らないようにする。
// BlockNote の移動・削除の API は段を片付けるが、ProseMirror の標準のドロップは片付けない。
// 片付けるのは運び出した元の段組みだけ（/2 columns で作ったばかりの空の段は消さない）。
function dropCleanupPlugin() {
  return new Plugin({
    key: new PluginKey("notes-column-drop-cleanup"),
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged && tr.getMeta("uiEvent") === "drop")) return null;
      const $from = oldState.doc.resolve(oldState.selection.from);
      let listPos = -1;
      for (let depth = $from.depth; depth > 0; depth--) {
        if ($from.node(depth).type.name === COLUMN_LIST) { listPos = $from.before(depth); break; }
      }
      if (listPos < 0) return null;
      let mapped = listPos;
      for (const tr of transactions) {
        const result = tr.mapping.mapResult(mapped, 1);
        if (result.deleted) return null;
        mapped = result.pos;
      }
      if (newState.doc.nodeAt(mapped)?.type.name !== COLUMN_LIST) return null;
      const tr = newState.tr;
      fixColumnList(tr, mapped);
      return tr.docChanged ? tr : null;
    },
  });
}

const columnsExtension = createExtension(({ editor }: { editor: AnyEditor }) => ({
  key: "notes-columns",
  prosemirrorPlugins: [
    new Plugin({
      key: new PluginKey("notes-column-drop"),
      props: {
        handleDrop(view, event, _slice, moved) {
          const target = sideDropTarget(view, event as DragEvent);
          if (!target) return false;
          event.preventDefault();
          return dropBeside(editor, view, target, moved);
        },
      },
    }),
    resizePlugin(),
    dropCleanupPlugin(),
  ],
}));

export const columnListSpec = createBlockSpecFromTiptapNode({ node: ColumnListNode, type: COLUMN_LIST, content: "none" }, {});
export const columnSpec = createBlockSpecFromTiptapNode({ node: ColumnNode, type: COLUMN, content: "none" }, { width: { default: 1 } }, [columnsExtension()]);

// スラッシュメニューの「2 列」など。空の段落にいればそれを置き換え、そうでなければ下に入れる。
// 段の中では使えない（段の中に段組みは作らない）。
export function canInsertColumns(editor: AnyEditor) {
  return editor.getParentBlock(editor.getTextCursorPosition().block.id)?.type !== COLUMN;
}

export function insertColumns(editor: AnyEditor, count: number) {
  const current = editor.getTextCursorPosition().block;
  const list = { type: COLUMN_LIST, children: Array.from({ length: count }, () => ({ type: COLUMN, props: { width: 1 }, children: [{ type: "paragraph" }] })) };
  const empty = current.type === "paragraph" && Array.isArray(current.content) && !current.content.length && !current.children.length;
  editor.transact(() => {
    const inserted = (empty ? editor.replaceBlocks([current], [list as never]).insertedBlocks : editor.insertBlocks([list as never], current, "after"))[0] as unknown as JsonBlock | undefined;
    const first = inserted?.children?.[0]?.children?.[0]?.id;
    if (first) editor.setTextCursorPosition(first, "start");
  });
}
