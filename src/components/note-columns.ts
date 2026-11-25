"use client";

// 段組み（Notion の Columns）。BlockNote の core（MPL）は columnList / column という名前のノードを前提にした処理
// （ブロックの移動・削除で空になった段の片付けなど）を持っているので、ここではそのノードとブロックの定義、
// ブロックを左右へドロップして段を作る処理、段の境目をドラッグして幅を変える処理を自前で用意する。
// 公式の @blocknote/xl-multi-column（GPL または有償）は使わない。

import { createBlockSpecFromTiptapNode, createExtension, fixColumnList, fragmentToBlocks, getNodeById, type BlockNoteEditor, type ComputeDropPositionContext } from "@blocknote/core";
import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { COLUMN, COLUMN_LIST, MAX_COLUMNS, MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH, unwrapColumns, validColumnWidth } from "@/lib/note-columns";

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
// 段組み: 段の外のブロックなら、そのブロックと運んだブロックで新しい段組みを作る。段の中のブロックなら、その段の隣に段を足す。
// side は画面上の左右（縦線の位置）、before は文書の順で前に置くか（右から左に書く言語では左右が逆になる）。
type SideTarget = { side: Side; before: boolean; blockId: string; cursorPos: number };
export type ColumnSideDropTarget = SideTarget & { rect: { left: number; top: number; height: number } };

const isRtl = (element: Element) => getComputedStyle(element).direction === "rtl";

// ドラッグを始めたエディター（ブロックのハンドルはエディターの外に描かれるので、同じ .bn-container かで見る）。
// 同じノートを分割表示で 2 つ開いているとき、ID が同じでも相手側のドラッグをこちらの移動として扱わない。
const dragOrigins = new WeakMap<EditorView, boolean>();
function dragStartedIn(view: EditorView) { return dragOrigins.get(view) === true; }

// 左右のドロップを受け付ける幅（ブロックの端から）。
const SIDE_ZONE_MAX = 96;
const SIDE_ZONE_RATIO = 0.2;
// 左の端に触れただけ（ハンドルからドラッグを始めた直後や、エディターの外から押し戻された座標）では段にしない。
const LEFT_EDGE_GAP = 8;

function resolveSideDropTarget(
  view: EditorView,
  clientX: number,
  clientY: number,
  isExcluded: (blockPos: number, columnPos: number, columnNode: PMNode | null, listPos: number, listNode: PMNode | null) => boolean,
  countEmptied: (listPos: number, listNode: PMNode) => number,
): ColumnSideDropTarget | null {
  if (!view.editable) return null;
  const editorRect = view.dom.getBoundingClientRect();
  const x = Math.min(Math.max(clientX, editorRect.left + 1), editorRect.right - 1);
  const hit = view.dom.ownerDocument.elementFromPoint(x, clientY);
  let element = hit instanceof Element && view.dom.contains(hit) ? hit.closest<HTMLElement>('[data-node-type="blockContainer"]') : null;
  // 段の余白（ブロックの外）の上なら、その高さにある段の中のブロックを対象にする（細い段でも左右に置ける）。
  const column = !element && hit instanceof Element && view.dom.contains(hit) ? hit.closest<HTMLElement>(`[data-node-type="${COLUMN}"]`) : null;
  if (column) {
    const blocks = Array.from(column.querySelectorAll<HTMLElement>(':scope > [data-node-type="blockOuter"] > [data-node-type="blockContainer"]'));
    element = blocks.find((block) => { const rect = block.getBoundingClientRect(); return clientY >= rect.top && clientY <= rect.bottom; }) ?? null;
  }
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
  const columnNode = inColumn ? $pos.parent : null;
  const listPos = inColumn ? $pos.before($pos.depth - 1) : -1;
  const listNode = inColumn ? $pos.node($pos.depth - 1) : null;

  if (inColumn && listNode) {
    const emptied = countEmptied(listPos, listNode);
    if (listNode.childCount - emptied >= MAX_COLUMNS) return null;
  }
  if (isExcluded(blockPos, columnPos, columnNode, listPos, listNode)) return null;

  const cursorPos = inColumn ? columnPos : blockPos;
  const dom = view.nodeDOM(cursorPos);
  if (!(dom instanceof HTMLElement)) return null;
  const rect = dom.getBoundingClientRect();
  const zone = Math.min(SIDE_ZONE_MAX, rect.width * SIDE_ZONE_RATIO);
  const side: Side | null = clientX > rect.right - zone ? "right"
    : clientX >= rect.left + LEFT_EDGE_GAP && clientX < rect.left + zone ? "left" : null;
  if (!side) return null;
  const blockId = block.attrs.id;
  const before = (side === "left") !== isRtl(dom);
  return typeof blockId === "string"
    ? { side, before, blockId, cursorPos, rect: { left: side === "left" ? rect.left : rect.right, top: rect.top, height: rect.height } }
    : null;
}

function sideDropTarget(view: EditorView, event: DragEvent): SideTarget | null {
  if (!view.editable || !view.dragging) return null;
  // ブロックを丸ごとつかんだドラッグだけ（文字の選択を運ぶときは、選んでいない文字を巻き込まないよう通常のドロップにする）。
  if (view.dragging.slice.openStart !== 0 || view.dragging.slice.openEnd !== 0) return null;
  const { from, to } = view.state.selection;
  return resolveSideDropTarget(
    view,
    event.clientX,
    event.clientY,
    (blockPos, columnPos, columnNode) => {
      if (blockPos >= from && blockPos < to) return true;
      if (columnNode && from <= columnPos + 1 && to >= columnPos + columnNode.nodeSize - 1) return true;
      return false;
    },
    (listPos, listNode) => {
      let offset = listPos + 1;
      let emptied = 0;
      listNode.forEach((column) => {
        if (dragStartedIn(view) && from <= offset + 1 && to >= offset + column.nodeSize - 1) emptied = 1;
        offset += column.nodeSize;
      });
      return emptied;
    },
  );
}

function columnHasRemainingBlock(columnNode: PMNode, excludedIds: ReadonlySet<string>): boolean {
  for (let i = 0; i < columnNode.childCount; i++) {
    const child = columnNode.child(i);
    if (child.type.name === "blockContainer" && !excludedIds.has(String(child.attrs.id ?? ""))) {
      return true;
    }
  }
  return false;
}

export function findColumnSideTarget(
  view: EditorView,
  clientX: number,
  clientY: number,
  excludedIds: ReadonlySet<string>,
): ColumnSideDropTarget | null {
  return resolveSideDropTarget(
    view,
    clientX,
    clientY,
    (blockPos, _columnPos, columnNode) => {
      const block = view.state.doc.nodeAt(blockPos);
      const id = block?.attrs.id;
      if (typeof id === "string" && excludedIds.has(id)) return true;
      if (columnNode && !columnHasRemainingBlock(columnNode, excludedIds)) return true;
      return false;
    },
    (_listPos, listNode) => {
      let emptied = 0;
      listNode.forEach((column) => {
        if (!columnHasRemainingBlock(column, excludedIds)) emptied += 1;
      });
      return emptied;
    },
  );
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

function collectJsonIds(blocks: readonly JsonBlock[]): string[] {
  return blocks.map((b) => b.id).filter((id): id is string => typeof id === "string" && id.length > 0);
}

function collectAllBlockIds(blocks: readonly JsonBlock[]): string[] {
  const ids: string[] = [];
  const visit = (list: readonly JsonBlock[]) => {
    for (const block of list) {
      if (typeof block.id === "string" && block.id.length > 0) ids.push(block.id);
      if (block.children?.length) visit(block.children);
    }
  };
  visit(blocks);
  return ids;
}

// 複数カラムをまたいだ一括削除では先の columnList collapse が後ろの Pos をずらすため、文書逆順で 1 件ずつ削除する。
export function removeBlocksSafely(editor: AnyEditor, ids: readonly string[]) {
  if (!ids.length) return;
  const targetSet = new Set(ids);
  const docIds = collectAllBlockIds(editor.document as unknown as JsonBlock[]);
  const ordered = docIds.filter((id) => targetSet.has(id));
  const extras = ids.filter((id) => !ordered.includes(id));
  for (const id of [...extras, ...ordered].reverse()) {
    if (editor.getBlock(id)) editor.removeBlocks([id]);
  }
}

export function moveBlocksBeside(
  editor: AnyEditor,
  dragged: JsonBlock[],
  targetBlockId: string,
  before: boolean,
  removeOriginal = true,
): string[] {
  if (!dragged.length) return [];
  const unwrapped = unwrapColumns(dragged);
  const moving = removeOriginal ? structuredClone(unwrapped) : withoutIds(unwrapped);
  let insertedIds: string[] = [];
  editor.transact(() => {
    if (removeOriginal) {
      const toRemove = dragged.map((block) => block.id).filter((id): id is string => typeof id === "string");
      removeBlocksSafely(editor, toRemove);
    }
    const targetBlock = editor.getBlock(targetBlockId);
    if (!targetBlock) return;
    const parent = editor.getParentBlock(targetBlockId);
    if (parent?.type === COLUMN) {
      const list = editor.getParentBlock(parent.id);
      const columns = (list?.children ?? []) as JsonBlock[];
      const widths = columns.map((column) => Number(column.props?.width)).filter(validColumnWidth);
      const width = widths.length ? Math.max(MIN_COLUMN_WIDTH, widths.reduce((sum, value) => sum + value, 0) / widths.length) : 1;
      const [inserted] = editor.insertBlocks([{ type: COLUMN, props: { width }, children: moving } as never], parent.id, before ? "before" : "after");
      insertedIds = collectJsonIds(((inserted as unknown as JsonBlock | undefined)?.children) ?? []);
    } else {
      const own = { type: COLUMN, props: { width: 1 }, children: [targetBlock] };
      const added = { type: COLUMN, props: { width: 1 }, children: moving };
      const { insertedBlocks } = editor.replaceBlocks([targetBlockId], [{ type: COLUMN_LIST, children: before ? [added, own] : [own, added] } as never]);
      const list = insertedBlocks[0] as unknown as JsonBlock | undefined;
      insertedIds = collectJsonIds(list?.children?.[before ? 0 : 1]?.children ?? []);
    }
  });
  return insertedIds;
}

function dropBeside(editor: AnyEditor, view: EditorView, target: SideTarget, moved: boolean) {
  const slice = view.dragging?.slice;
  if (!slice) return false;
  const dragged = fragmentToBlocks(slice.content) as unknown as JsonBlock[];
  if (!dragged.length) return false;
  // この文書から運んだ（コピーではない）ブロックは元の場所から外す。
  // 先に新しい位置へ（新しい ID で）入れてから元を外す。先に外すと、元の段が空になって段組みごと片付けられ、
  // 置き先の段組みが消えたり崩れたりする。外した後で元の段が空になれば core が片付ける。
  const local = moved && dragStartedIn(view) && dragged.every((block) => block.id && editor.getBlock(block.id));
  const [firstMoved] = moveBlocksBeside(editor, dragged, target.blockId, target.before, local);
  // 運んだ先頭のブロックにキャレットを置く（文字を持たないブロックなら何もしない）。
  if (firstMoved) { try { editor.setTextCursorPosition(firstMoved, "end"); } catch { /* 表・画像など */ } }
  return true;
}

// 段の境目をドラッグして幅を変える。境目から 6px 以内でカーソルが col-resize になる（見た目は BlockNote の CSS）。
const RESIZE_HIT = 6;
const MIN_COLUMN_PX = 48;
const HOVER_CLASS = "bn-column-list-hovered";
const BORDER_CLASS = "bn-column-resize-border";

// 段の幅のうち flex-grow で分けられる部分（左右の余白は段ごとに固定なので除く）。幅の比はこの長さの比になる。
function flexWidth(element: HTMLElement) {
  const style = getComputedStyle(element);
  return element.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
}

function columnElements(list: Element) {
  return Array.from(list.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.getAttribute("data-node-type") === COLUMN);
}

function resizePlugin() {
  return new Plugin({
    key: new PluginKey("notes-column-resize"),
    view(view) {
      let hovered: HTMLElement | null = null;
      let border: { left: HTMLElement; right: HTMLElement } | null = null;
      // left / right は文書の順で前後の段（右から左に書く言語では画面の右 / 左）。
      let drag: { startX: number; rtl: boolean; left: HTMLElement; right: HTMLElement; leftPx: number; rightPx: number; total: number; leftWidth: number; rightWidth: number } | null = null;
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
        const rtl = isRtl(list);
        let next: typeof border = null;
        for (let index = 0; index < columns.length - 1; index++) {
          const rect = columns[index].getBoundingClientRect();
          if (Math.abs(event.clientX - (rtl ? rect.left : rect.right)) <= RESIZE_HIT) { next = { left: columns[index], right: columns[index + 1] }; break; }
        }
        setBorder(next);
      };
      const onMove = (event: PointerEvent) => { if (!drag) track(event); };
      const onDragMove = (event: PointerEvent) => {
        if (!drag) return;
        const span = drag.leftPx + drag.rightPx;
        if (!Number.isFinite(event.clientX) || span <= 2 * MIN_COLUMN_PX) return;
        const delta = (event.clientX - drag.startX) * (drag.rtl ? -1 : 1);
        const leftPx = Math.min(Math.max(drag.leftPx + delta, MIN_COLUMN_PX), span - MIN_COLUMN_PX);
        // 2 つの段の比の合計は保ち、どちらも保存できる範囲に収める。
        const leftWidth = Math.min(Math.max(drag.total * leftPx / span, MIN_COLUMN_WIDTH), MAX_COLUMN_WIDTH);
        const rightWidth = drag.total - leftWidth;
        if (!validColumnWidth(rightWidth)) return;
        drag.leftWidth = leftWidth;
        drag.rightWidth = rightWidth;
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
        const widths = [round(leftWidth), round(rightWidth)];
        // 片方だけ書くと 2 つの段の比が崩れるので、どちらも有効なときだけ両方書く。
        if (!widths.every(validColumnWidth)) return;
        let tr = view.state.tr;
        for (const [element, width] of [[left, widths[0]], [right, widths[1]]] as const) {
          const id = element.getAttribute("data-id");
          const found = id ? getNodeById(id, tr.doc) : undefined;
          if (found) tr = tr.setNodeMarkup(found.posBeforeNode, undefined, { ...found.node.attrs, width });
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
          startX: event.clientX, rtl: isRtl(border.left), left: border.left, right: border.right,
          leftPx: flexWidth(border.left), rightPx: flexWidth(border.right),
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
// 片付けるのは、このエディターでつかんだブロックを運び出して空になった元の段だけ
// （文字のドラッグやファイルのドロップ、/2 columns で作ったばかりの空の段には触れない）。
function isEmptyColumn(column: PMNode) {
  const block = column.childCount === 1 ? column.firstChild : null;
  const content = block?.childCount === 1 ? block.firstChild : null;
  return content?.type.name === "paragraph" && content.content.size === 0;
}

function dropCleanupPlugin() {
  let startedHere = false;
  return new Plugin({
    key: new PluginKey("notes-column-drop-cleanup"),
    view(view) {
      // ドラッグを始めたのがこのエディター（本文か、エディターの外に描かれるブロックのハンドル）かを覚えておく。
      const onStart = (event: Event) => {
        const target = event.target instanceof Element ? event.target : null;
        const container = view.dom.closest(".bn-container");
        startedHere = !!target && (view.dom.contains(target) || (!!container && target.closest(".bn-container") === container));
        dragOrigins.set(view, startedHere);
      };
      // drop の処理が終わってから消す。
      const onEnd = () => { setTimeout(() => { dragOrigins.delete(view); startedHere = false; }, 0); };
      const root = view.root as Document;
      root.addEventListener("dragstart", onStart, true);
      root.addEventListener("dragend", onEnd, true);
      return {
        destroy() {
          root.removeEventListener("dragstart", onStart, true);
          root.removeEventListener("dragend", onEnd, true);
          dragOrigins.delete(view);
        },
      };
    },
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged && tr.getMeta("uiEvent") === "drop")) return null;
      // ブロックをつかんだドラッグ（ノードの選択）だけ。文字の選択を運んでも段は空にならない。
      // このエディターで始めたドラッグに限る（外から文字やファイルを落としたときに、キャレットのある段を消さない）。
      const selection = oldState.selection;
      if (!startedHere || selection.empty || (!(selection instanceof NodeSelection) && selection.content().openStart !== 0)) return null;
      const $from = oldState.doc.resolve(selection.from);
      // 元の段は「段組みの位置 + 何番目の段か」で追う（ドロップで段のノード自体が置き換わることがあるため）。
      let listPos = -1;
      let index = -1;
      for (let depth = $from.depth; depth > 1; depth--) {
        if ($from.node(depth).type.name === COLUMN && $from.node(depth - 1).type.name === COLUMN_LIST) {
          listPos = $from.before(depth - 1);
          index = $from.index(depth - 1);
          break;
        }
      }
      if (listPos < 0) return null;
      const oldCount = oldState.doc.nodeAt(listPos)?.childCount;
      let mapped = listPos;
      for (const tr of transactions) {
        const result = tr.mapping.mapResult(mapped, 1);
        if (result.deleted) return null;
        mapped = result.pos;
      }
      const list = newState.doc.nodeAt(mapped);
      if (list?.type.name !== COLUMN_LIST || list.childCount !== oldCount) return null;
      const column = list.child(index);
      if (!isEmptyColumn(column)) return null;
      const tr = newState.tr;
      // 3 段以上ならその段だけ消す。2 段なら段組みをやめて、残った段の中身だけにする（core の fixColumnList）。
      if (list.childCount > 2) {
        let columnPos = mapped + 1;
        for (let i = 0; i < index; i++) columnPos += list.child(i).nodeSize;
        tr.delete(columnPos, columnPos + column.nodeSize);
      } else fixColumnList(tr, mapped);
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
  // 段の中の入れ子（字下げした子ブロック）でも出さない。
  for (let parent = editor.getParentBlock(editor.getTextCursorPosition().block.id); parent; parent = editor.getParentBlock(parent.id)) {
    if (parent.type === COLUMN) return false;
  }
  return true;
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
