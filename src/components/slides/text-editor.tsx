"use client";

import { baseKeymap, chainCommands, exitCode, setBlockType, toggleMark } from "@tiptap/pm/commands";
import { history, redo, undo } from "@tiptap/pm/history";
import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from "@tiptap/pm/inputrules";
import { keymap } from "@tiptap/pm/keymap";
import type { MarkType, Node as PMNode, NodeType } from "@tiptap/pm/model";
import { liftListItem, sinkListItem, splitListItem, wrapInList } from "@tiptap/pm/schema-list";
import { AllSelection, EditorState, NodeSelection, TextSelection, type Command, type Transaction } from "@tiptap/pm/state";
import { EditorView, type NodeView } from "@tiptap/pm/view";
import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import { currentSlideKatex, loadSlideKatex, slideMathHtml } from "@/components/slides/slide-math";
import { slideSchema } from "@/components/slides/pm-schema";
import { MAX_MATH_LATEX, normalizeRichDoc, safeHref, type RichDoc } from "@/lib/slides/rich-text";

// スライドの文字枠の編集（ProseMirror）。日本語・中国語・韓国語の変換中（IME）は ProseMirror が文字を確定するまで待つので、
// こちらからは編集中の内容を外から差し替えない（変更は onChange で外へ出すだけ）。
// 書式の操作は TextCommands（書式バーから呼ぶ）。

const { nodes, marks } = slideSchema;

function renderMathInto(element: HTMLElement, latex: string, display: boolean) {
  element.setAttribute("data-latex", latex);
  element.classList.toggle("is-empty", !latex.trim());
  if (!latex.trim()) { element.textContent = display ? " " : " "; return; }
  const html = slideMathHtml(currentSlideKatex(), latex, display);
  if (html) { element.innerHTML = html; return; }
  element.textContent = latex;
  void loadSlideKatex().then(() => {
    if (element.getAttribute("data-latex") !== latex) return;
    const loaded = slideMathHtml(currentSlideKatex(), latex, display);
    if (loaded) element.innerHTML = loaded;
  }).catch(() => {});
}

// 数式は中身を ProseMirror に編集させない塊（atom）。選ぶと書式バーに TeX の入力欄が出る。
class MathNodeView implements NodeView {
  dom: HTMLElement;
  constructor(private node: PMNode, private display: boolean) {
    this.dom = document.createElement(display ? "div" : "span");
    this.dom.className = display ? "slide-math-block" : "slide-math-inline";
    this.dom.dir = "ltr";
    this.dom.contentEditable = "false";
    renderMathInto(this.dom, node.attrs.latex, display);
  }
  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    if (node.attrs.latex !== this.node.attrs.latex) renderMathInto(this.dom, node.attrs.latex, this.display);
    this.node = node;
    return true;
  }
  selectNode() { this.dom.classList.add("is-selected"); }
  deselectNode() { this.dom.classList.remove("is-selected"); }
  ignoreMutation() { return true; }
}

function markActive(state: EditorState, type: MarkType) {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

function listDepth(state: EditorState, type: NodeType) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type === nodes.bullet_list || node.type === nodes.ordered_list) return node.type === type ? depth : -1;
  }
  return -1;
}

// 書式バー・ショートカットから使う操作。
export type TextCommands = {
  view: EditorView;
  run: (command: Command) => boolean;
  toggle: (mark: "strong" | "em" | "underline" | "strike" | "code") => void;
  active: (mark: "strong" | "em" | "underline" | "strike" | "code" | "link") => boolean;
  link: () => string | null;
  setLink: (href: string | null) => void;
  list: () => "bullet" | "ordered" | null;
  toggleList: (kind: "bullet" | "ordered") => void;
  align: () => string | null;
  setAlign: (align: "left" | "center" | "right" | "justify") => void;
  setColor: (color: string | null) => void;
  setSize: (size: number | null) => void;
  toggleCodeBlock: () => void;
  insertMath: (display: boolean) => void;
  selectedMath: () => { latex: string; display: boolean } | null;
  updateMath: (latex: string) => void;
  focus: () => void;
};

function applyMark(view: EditorView, type: MarkType, attrs: Record<string, unknown> | null) {
  const { state } = view;
  const { from, to, empty } = state.selection;
  let tr = state.tr;
  if (empty) {
    tr = attrs ? tr.addStoredMark(type.create(attrs)) : tr.removeStoredMark(type);
  } else {
    tr = tr.removeMark(from, to, type);
    if (attrs) tr = tr.addMark(from, to, type.create(attrs));
  }
  view.dispatch(tr);
}

export function textCommands(view: EditorView): TextCommands {
  const run = (command: Command) => command(view.state, view.dispatch, view);
  return {
    view, run,
    toggle: (mark) => { run(toggleMark(marks[mark])); view.focus(); },
    active: (mark) => markActive(view.state, marks[mark]),
    link: () => {
      const { $from } = view.state.selection;
      return marks.link.isInSet($from.marks())?.attrs.href ?? null;
    },
    setLink: (href) => {
      const safe = href ? safeHref(href.match(/^[a-z][a-z0-9+.-]*:/i) ? href : `https://${href}`) : null;
      const { state } = view;
      let { from, to } = state.selection;
      // 何も選んでいなければ、カーソルのあるリンク全体を対象にする。
      if (state.selection.empty) {
        const $pos = state.selection.$from;
        const parent = $pos.parent;
        let start = $pos.parentOffset;
        let end = $pos.parentOffset;
        const linkAt = (offset: number) => { const child = parent.childAfter(offset).node; return child && marks.link.isInSet(child.marks); };
        while (start > 0 && linkAt(start - 1)) start--;
        while (end < parent.content.size && linkAt(end)) end++;
        from = $pos.start() + start;
        to = $pos.start() + end;
      }
      if (from === to) {
        if (!safe) return;
        // 選んでいないところにリンクを作るときは、URL を文字として入れる。
        view.dispatch(state.tr.insertText(safe, from).addMark(from, from + safe.length, marks.link.create({ href: safe })));
      } else {
        let tr = state.tr.removeMark(from, to, marks.link);
        if (safe) tr = tr.addMark(from, to, marks.link.create({ href: safe }));
        view.dispatch(tr);
      }
      view.focus();
    },
    list: () => (listDepth(view.state, nodes.bullet_list) > 0 ? "bullet" : listDepth(view.state, nodes.ordered_list) > 0 ? "ordered" : null),
    toggleList: (kind) => {
      const type = kind === "bullet" ? nodes.bullet_list : nodes.ordered_list;
      const other = kind === "bullet" ? nodes.ordered_list : nodes.bullet_list;
      const state = view.state;
      const depth = listDepth(state, type);
      if (depth > 0) {
        // 同じ種類の箇条書きの中なら外す。
        while (liftListItem(nodes.list_item)(view.state, view.dispatch)) { /* 一番外まで外す */ }
      } else if (listDepth(state, other) > 0) {
        // 別の種類なら種類だけ替える。
        const { $from } = state.selection;
        for (let level = $from.depth; level > 0; level--) {
          if ($from.node(level).type === other) {
            view.dispatch(state.tr.setNodeMarkup($from.before(level), type));
            break;
          }
        }
      } else run(wrapInList(type));
      view.focus();
    },
    align: () => {
      const { $from } = view.state.selection;
      return $from.parent.type === nodes.paragraph ? $from.parent.attrs.align : null;
    },
    setAlign: (align) => {
      const { state } = view;
      const { from, to } = state.selection;
      const tr = state.tr;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type === nodes.paragraph) tr.setNodeMarkup(pos, undefined, { ...node.attrs, align });
      });
      view.dispatch(tr);
      view.focus();
    },
    setColor: (color) => { applyMark(view, marks.color, color ? { color } : null); view.focus(); },
    setSize: (size) => { applyMark(view, marks.size, size ? { size } : null); view.focus(); },
    toggleCodeBlock: () => {
      const { $from } = view.state.selection;
      if ($from.parent.type === nodes.code_block) run(setBlockType(nodes.paragraph));
      else run(setBlockType(nodes.code_block));
      view.focus();
    },
    insertMath: (display) => {
      const { state } = view;
      const selected = state.doc.textBetween(state.selection.from, state.selection.to, " ").slice(0, MAX_MATH_LATEX);
      const node = (display ? nodes.math_block : nodes.math_inline).create({ latex: selected || "x" });
      const from = state.selection.from;
      let tr = state.tr.replaceSelectionWith(node, false);
      // 入れた数式を選んだ状態にして、書式バーの TeX 欄ですぐ直せるようにする（段落を分けて入れたときは位置がずれるので近くを探す）。
      let found = -1;
      const low = Math.max(0, tr.mapping.map(from, -1) - 4);
      const high = Math.min(tr.doc.content.size, tr.mapping.map(from, 1) + 4);
      tr.doc.nodesBetween(low, high, (child, pos) => { if (found < 0 && child.type === node.type && child.attrs.latex === node.attrs.latex) found = pos; });
      if (found >= 0) tr = tr.setSelection(NodeSelection.create(tr.doc, found));
      view.dispatch(tr.scrollIntoView());
      view.focus();
    },
    selectedMath: () => {
      const selection = view.state.selection;
      if (!(selection instanceof NodeSelection)) return null;
      const node = selection.node;
      if (node.type !== nodes.math_inline && node.type !== nodes.math_block) return null;
      return { latex: node.attrs.latex, display: node.type === nodes.math_block };
    },
    updateMath: (latex) => {
      const selection = view.state.selection;
      if (!(selection instanceof NodeSelection)) return;
      const node = selection.node;
      if (node.type !== nodes.math_inline && node.type !== nodes.math_block) return;
      const tr = view.state.tr.setNodeMarkup(selection.from, undefined, { latex: latex.slice(0, MAX_MATH_LATEX) });
      tr.setSelection(NodeSelection.create(tr.doc, selection.from));
      view.dispatch(tr);
    },
    focus: () => view.focus(),
  };
}

// 行頭の「- 」「1. 」で箇条書き、「```」でコード、$…$ で行内の数式、行頭の「$$ 」でブロックの数式。
function slideInputRules() {
  return inputRules({ rules: [
    wrappingInputRule(/^\s*([-+*•])\s$/, nodes.bullet_list),
    wrappingInputRule(/^(\d+)\.\s$/, nodes.ordered_list, (match) => ({ order: Number(match[1]) }), (match, node) => node.childCount + node.attrs.order === Number(match[1])),
    textblockTypeInputRule(/^```$/, nodes.code_block),
    new InputRule(/(?:^|[^$\\])\$([^$\s][^$]{0,500}?)\$$/, (state, match, start, end) => {
      const latex = match[1];
      const offset = match[0].length - latex.length - 2;
      return state.tr.replaceWith(start + offset, end, nodes.math_inline.create({ latex }));
    }),
    new InputRule(/^\$\$\s$/, (state, _match, start, end) => {
      const $start = state.doc.resolve(start);
      if (!$start.parent.isTextblock) return null;
      // 「$」を消してから、縮んだ段落の位置で置き換える（消す前の位置を使うと段落の外を指す）。
      const tr = state.tr.delete(start, end);
      const $paragraph = tr.doc.resolve(tr.mapping.map(start));
      return tr.replaceRangeWith($paragraph.before(), $paragraph.after(), nodes.math_block.create({ latex: "" }));
    }),
  ] });
}

function slideKeymap(onExit: () => void) {
  const listItem = nodes.list_item;
  return keymap({
    "Mod-z": undo, "Mod-y": redo, "Shift-Mod-z": redo,
    "Mod-b": toggleMark(marks.strong), "Mod-i": toggleMark(marks.em), "Mod-u": toggleMark(marks.underline),
    "Mod-Shift-x": toggleMark(marks.strike), "Mod-e": toggleMark(marks.code),
    "Shift-Enter": chainCommands(exitCode, (state, dispatch) => {
      if (dispatch) dispatch(state.tr.replaceSelectionWith(nodes.hard_break.create()).scrollIntoView());
      return true;
    }),
    Enter: splitListItem(listItem),
    Tab: sinkListItem(listItem),
    "Shift-Tab": liftListItem(listItem),
    Escape: () => { onExit(); return true; },
  });
}

export function richDocToNode(doc: RichDoc): PMNode {
  try { return slideSchema.nodeFromJSON(normalizeRichDoc(doc)); }
  catch { return slideSchema.nodeFromJSON(normalizeRichDoc(null)); }
}

// 全体を選んだ状態で始めるか（置き場所の案内を押した、Enter で入ったなど）。
export function SlideTextEditor({ doc, style, className = "slide-text", onChange, onExit, onSelectionChange, commandsRef, selectAll = false, editable = true }: {
  doc: RichDoc;
  style: CSSProperties;
  className?: string;
  onChange: (doc: RichDoc) => void;
  onExit: () => void;
  onSelectionChange?: () => void;
  commandsRef?: { current: TextCommands | null };
  selectAll?: boolean;
  editable?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onChange, onExit, onSelectionChange });
  useLayoutEffect(() => { handlers.current = { onChange, onExit, onSelectionChange }; });
  // 編集を始めた時の内容だけで作る（編集中に外から差し替えると、変換中の文字が消える）。
  const initial = useRef(doc);
  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: richDocToNode(initial.current),
      plugins: [slideInputRules(), slideKeymap(() => handlers.current.onExit()), keymap(baseKeymap), history()],
    });
    const view: EditorView = new EditorView(host.current, {
      state,
      editable: () => editable,
      nodeViews: {
        math_inline: (node) => new MathNodeView(node, false),
        math_block: (node) => new MathNodeView(node, true),
      },
      attributes: { spellcheck: "true" },
      dispatchTransaction(transaction: Transaction) {
        const next = view.state.apply(transaction);
        view.updateState(next);
        if (transaction.docChanged) handlers.current.onChange(next.doc.toJSON() as RichDoc);
        handlers.current.onSelectionChange?.();
      },
    });
    if (commandsRef) commandsRef.current = textCommands(view);
    view.focus();
    const end = selectAll ? new AllSelection(view.state.doc) : TextSelection.atEnd(view.state.doc);
    try { view.dispatch(view.state.tr.setSelection(end)); } catch { /* 空の文書 */ }
    return () => {
      if (commandsRef?.current?.view === view) commandsRef.current = null;
      view.destroy();
    };
    // 編集の間は作り直さない（initial は ref）。
  }, [commandsRef, selectAll, editable]);
  return <div className={`${className} slide-text-editing`} style={style} ref={host}
    // スライドの上の操作（ドラッグで動かす・選び直す）に、文字を選ぶ操作を渡さない。
    onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.stopPropagation()} />;
}

