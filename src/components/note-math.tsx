"use client";

import { createExtension, defaultProps, type BlockNoteEditor } from "@blocknote/core";
import { createReactBlockSpec, createReactInlineContentSpec } from "@blocknote/react";
import { CornerDownLeft, Sigma } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { type FloatingPosition } from "@/components/emoji-picker";
import { useT } from "@/components/i18n-provider";
import { MAX_MATH_LATEX } from "@/lib/note-document";
import { useBackToClose } from "@/lib/use-back-to-close";

// ---- KaTeX の遅延読み込み ----
// 数式を含まないノートでは KaTeX 本体とスタイル・字体を読み込まない。
type KatexApi = {
  renderToString: (tex: string, options?: { displayMode?: boolean; throwOnError?: boolean; strict?: boolean; trust?: boolean; errorColor?: string }) => string;
};
let katexApi: KatexApi | null = null;
let katexLoading: Promise<void> | null = null;
const katexListeners = new Set<() => void>();

function subscribeKatex(listener: () => void) {
  katexListeners.add(listener);
  return () => { katexListeners.delete(listener); };
}

function subscribeNothing() {
  return () => {};
}

function loadKatex() {
  if (katexApi || katexLoading) return;
  katexLoading = Promise.all([import("katex"), import("katex/dist/katex.min.css")])
    .then(([mod]) => {
      katexApi = (mod.default ?? mod) as KatexApi;
      katexListeners.forEach((listener) => listener());
    })
    .catch(() => {
      katexLoading = null;
      if (katexListeners.size) window.setTimeout(() => { if (katexListeners.size) loadKatex(); }, 5000);
    });
}

function useKatex(needed: boolean) {
  const api = useSyncExternalStore(needed ? subscribeKatex : subscribeNothing, () => katexApi, () => null);
  useEffect(() => {
    if (needed) loadKatex();
  }, [needed]);
  return api;
}

function renderKatex(katex: KatexApi, latex: string, displayMode: boolean): { html: string; error: string | null } {
  const source = latex.trim();
  if (!source) return { html: "", error: null };
  try {
    return {
      html: katex.renderToString(source, { displayMode, throwOnError: true, strict: false, trust: false }),
      error: null,
    };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message.replace(/^KaTeX parse error:\s*/i, "") : "Invalid equation";
    try {
      return {
        html: katex.renderToString(source, { displayMode, throwOnError: false, strict: false, trust: false, errorColor: "currentColor" }),
        error: message,
      };
    } catch {
      // 深い入れ子などで throwOnError: false でも失敗した時は、元の TeX をそのまま文字で出す。
      return { html: "", error: message };
    }
  }
}

// ---- 新規挿入直後の自動オープン制御 ----
// 既存ノートを開いた時の空の数式では開かず、スラッシュメニュー・入力ルール・ツールバーから新しく入れた時だけ開く。
let pendingNewBlock = false;
let pendingNewInline = false;

export function markNextMathBlockAutoOpen() {
  pendingNewBlock = true;
}

export function markNextMathInlineAutoOpen() {
  pendingNewInline = true;
}

// ---- エディター単位の編集ポップオーバー ----
// ポップオーバーを NodeView の外（document.body のポータル）に置くことで、入力中に数式ノードを更新しても
// textarea のフォーカスが外れず、リアルタイムのプレビューを保てる。
type MathSession =
  | { kind: "block"; blockId: string; latex: string; anchor: HTMLElement | null }
  | { kind: "inline"; getPos: () => number | undefined; latex: string; anchor: HTMLElement | null };

type MathEditorContextValue = {
  session: MathSession | null;
  openBlock: (blockId: string, latex: string, anchor: HTMLElement | null) => void;
  openInline: (getPos: () => number | undefined, latex: string, anchor: HTMLElement | null) => void;
  close: (restoreFocus?: boolean) => void;
};

const MathEditorContext = createContext<MathEditorContextValue | null>(null);

type PopoverLayout = FloatingPosition & { maxHeight: number };

function mathPopoverPosition(anchor: DOMRect, measuredHeight = 148): PopoverLayout {
  const margin = 12;
  const viewport = window.visualViewport;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const width = Math.min(420, Math.max(220, viewportWidth - margin * 2));
  const maxHeight = Math.max(120, viewportHeight - margin * 2);
  const height = Math.min(Math.max(measuredHeight, 96), maxHeight);
  const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  const preferredLeft = rtl ? anchor.right - width : anchor.left;
  const left = Math.max(viewportLeft + margin, Math.min(preferredLeft, viewportLeft + viewportWidth - width - margin));
  const below = anchor.bottom + 6;
  const preferredTop = below + height <= viewportTop + viewportHeight - margin ? below : anchor.top - height - 6;
  const top = Math.max(viewportTop + margin, Math.min(preferredTop, viewportTop + viewportHeight - height - margin));
  return { top, left, width, maxHeight };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = BlockNoteEditor<any, any, any>;

export function MathEditorProvider({ editor, editable, children }: { editor: AnyEditor; editable: boolean; children: ReactNode }) {
  const [session, setSession] = useState<MathSession | null>(null);
  const activeSession = editable ? session : null;
  const sessionRef = useRef<MathSession | null>(null);
  useEffect(() => { sessionRef.current = activeSession; }, [activeSession]);

  const openBlock = useCallback((blockId: string, latex: string, anchor: HTMLElement | null) => {
    if (!editable) return;
    const next: MathSession = { kind: "block", blockId, latex, anchor };
    sessionRef.current = next;
    setSession(next);
  }, [editable]);

  const openInline = useCallback((getPos: () => number | undefined, latex: string, anchor: HTMLElement | null) => {
    if (!editable) return;
    const next: MathSession = { kind: "inline", getPos, latex, anchor };
    sessionRef.current = next;
    setSession(next);
  }, [editable]);

  const close = useCallback((restoreFocus = true) => {
    sessionRef.current = null;
    setSession(null);
    // 外側クリック（タイトル欄など）で閉じた時は、クリック先のフォーカスを奪わない。
    if (restoreFocus) window.setTimeout(() => { if (editor.isEditable) editor.focus(); }, 0);
  }, [editor]);

  // 端末の戻るキーは画面幅を問わず、ノートから離れる前にポップオーバーだけを閉じる。
  useBackToClose(activeSession !== null, close);

  const updateLatex = useCallback((nextRaw: string) => {
    const current = sessionRef.current;
    if (!current) return;
    const cleaned = (current.kind === "inline" ? nextRaw.replace(/\r?\n/g, " ") : nextRaw)
      .replace(/\u0000/g, "")
      .slice(0, MAX_MATH_LATEX);
    const next: MathSession = { ...current, latex: cleaned };
    sessionRef.current = next;
    setSession(next);
    // ProseMirror の更新は state updater の外で 1 回だけ実行する（レンダー中の親更新や二重適用を防ぐ）。
    if (current.kind === "block") {
      if (editor.isEditable && editor.getBlock(current.blockId)) {
        editor.updateBlock(current.blockId, { props: { latex: cleaned } });
      }
    } else {
      const pos = current.getPos();
      const view = editor.prosemirrorView;
      if (editor.isEditable && pos !== undefined && view) {
        const node = view.state.doc.nodeAt(pos);
        if (node?.type.name === "mathInline") {
          editor.transact((tr) => tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex: cleaned }));
        }
      }
    }
  }, [editor]);

  const value = useMemo<MathEditorContextValue>(
    () => ({ session: activeSession, openBlock, openInline, close }),
    [activeSession, openBlock, openInline, close],
  );

  return (
    <MathEditorContext.Provider value={value}>
      {children}
      {activeSession && <MathEditorPopover session={activeSession} onChange={updateLatex} onClose={close} />}
    </MathEditorContext.Provider>
  );
}

function MathEditorPopover({ session, onChange, onClose }: {
  session: MathSession;
  onChange: (latex: string) => void;
  onClose: (restoreFocus?: boolean) => void;
}) {
  const t = useT();
  const katex = useKatex(session.latex.trim().length > 0);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [position, setPosition] = useState<PopoverLayout>(() =>
    session.anchor?.isConnected
      ? mathPopoverPosition(session.anchor.getBoundingClientRect())
      : { top: 80, left: 16, width: 320, maxHeight: 320 },
  );

  const parseError = useMemo(() => {
    if (!katex || !session.latex.trim()) return null;
    return renderKatex(katex, session.latex, session.kind === "block").error;
  }, [katex, session.latex, session.kind]);

  const reposition = useCallback(() => {
    if (!session.anchor?.isConnected) return;
    const measured = popoverRef.current?.offsetHeight || 148;
    setPosition(mathPopoverPosition(session.anchor.getBoundingClientRect(), measured));
  }, [session.anchor]);

  // 仮想キーボードの開閉やスクロールでは閉じず、実測の高さに合わせて位置だけ追従する。
  useEffect(() => {
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.visualViewport?.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
    };
  }, [reposition]);

  // 外側クリックで閉じる（クリック先のフォーカスを保つ）。
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (popoverRef.current?.contains(target)) return;
      if (session.anchor?.contains(target)) return;
      onClose(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [session.anchor, onClose]);

  // 開いた直後にテキストエリアへフォーカスし、末尾へカーソルを置く。
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [session.kind, session.anchor]);

  // 内容の行数に合わせて高さを自動調整し、キーボード展開時も Done が見える位置に収める。
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    reposition();
  }, [session.latex, parseError, reposition]);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose(true);
      return;
    }
    if (event.key === "Enter") {
      if (session.kind === "inline") {
        event.preventDefault();
        onClose(true);
        return;
      }
      const touchPrimary = typeof window !== "undefined" && window.matchMedia("(hover: none) and (pointer: coarse)").matches;
      const mod = event.ctrlKey || event.metaKey;
      if (mod || (!touchPrimary && !event.shiftKey)) {
        event.preventDefault();
        onClose(true);
      }
    }
  }

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={t("Edit equation")}
      className="notes-popover notes-math-popover"
      style={{ position: "fixed", top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}
    >
      <textarea
        ref={inputRef}
        dir="ltr"
        rows={session.kind === "block" ? 2 : 1}
        className="notes-math-input"
        value={session.latex}
        placeholder={t("Enter a TeX equation…")}
        aria-label={t("Enter a TeX equation…")}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="notes-math-footer">
        <span className="notes-math-error" role={parseError ? "alert" : undefined}>
          {parseError ?? ""}
        </span>
        <button type="button" className="notes-math-done" onClick={() => onClose(true)}>
          {t("Done")}
          <CornerDownLeft size={13} aria-hidden="true" />
        </button>
      </div>
    </div>,
    document.body,
  );
}

// ---- ブロックの数式（mathBlock）----
export const createMathBlockSpec = createReactBlockSpec(
  {
    type: "mathBlock",
    propSchema: {
      latex: { default: "" },
      textColor: defaultProps.textColor,
      backgroundColor: defaultProps.backgroundColor,
    },
    content: "none",
  },
  {
    render: function MathBlock({ block, editor }) {
      const t = useT();
      const ctx = useContext(MathEditorContext);
      const ref = useRef<HTMLDivElement>(null);
      const latex = block.props.latex;
      const katex = useKatex(latex.trim().length > 0);
      const rendered = useMemo(() => (katex && latex.trim() ? renderKatex(katex, latex, true) : null), [katex, latex]);
      const isOpen = ctx?.session?.kind === "block" && ctx.session.blockId === block.id;

      useEffect(() => {
        if (!ctx || !editor.isEditable || !pendingNewBlock || latex) return;
        const id = window.requestAnimationFrame(() => {
          if (!pendingNewBlock) return;
          pendingNewBlock = false;
          ctx.openBlock(block.id, latex, ref.current);
        });
        return () => window.cancelAnimationFrame(id);
      }, [ctx, editor, block.id, latex]);

      const open = () => {
        if (!editor.isEditable || !ctx) return;
        ctx.openBlock(block.id, latex, ref.current);
      };

      return (
        <div
          ref={ref}
          dir="ltr"
          contentEditable={false}
          role={editor.isEditable ? "button" : undefined}
          tabIndex={editor.isEditable ? 0 : undefined}
          aria-label={t("Edit equation")}
          className={`notes-math-block ${isOpen ? "is-open" : ""} ${!latex.trim() ? "is-empty" : ""}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={open}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              open();
            }
          }}
        >
          {!latex.trim() ? (
            <span className="notes-math-placeholder">
              <Sigma size={16} aria-hidden="true" />
              {t("Add a TeX equation")}
            </span>
          ) : rendered?.html ? (
            <div className="notes-math-rendered" dangerouslySetInnerHTML={{ __html: rendered.html }} />
          ) : (
            <code className="notes-math-fallback">{latex}</code>
          )}
        </div>
      );
    },
    toExternalHTML: function MathBlockExternal({ block }) {
      return <span>{block.props.latex ? `$$\n${block.props.latex}\n$$` : ""}</span>;
    },
  },
  [
    createExtension({
      key: "notes-math-block-input-rule",
      inputRules: [{
        find: /^\$\$\s$/,
        replace: () => {
          markNextMathBlockAutoOpen();
          return { type: "mathBlock", props: { latex: "" } };
        },
      }],
    }),
  ],
);

// ---- 行内の数式（mathInline）----
// createReactInlineContentSpec はファクトリ関数ではなく InlineContentSpec を直接返す。
export const mathInlineSpec = createReactInlineContentSpec(
  {
    type: "mathInline",
    propSchema: {
      latex: { default: "" },
    },
    content: "none",
  },
  {
    render: function MathInline({ inlineContent, editor, getPos }) {
      const t = useT();
      const ctx = useContext(MathEditorContext);
      const ref = useRef<HTMLSpanElement>(null);
      const getPosRef = useRef(getPos);
      useEffect(() => { getPosRef.current = getPos; }, [getPos]);
      const stableGetPos = useCallback(() => getPosRef.current(), []);
      const latex = inlineContent.props.latex;
      const katex = useKatex(latex.trim().length > 0);
      const rendered = useMemo(() => (katex && latex.trim() ? renderKatex(katex, latex, false) : null), [katex, latex]);
      const isOpen = ctx?.session?.kind === "inline" && ctx.session.anchor === ref.current;

      useEffect(() => {
        if (!ctx || !editor.isEditable || !pendingNewInline) return;
        const id = window.requestAnimationFrame(() => {
          if (!pendingNewInline) return;
          pendingNewInline = false;
          ctx.openInline(stableGetPos, latex, ref.current);
        });
        return () => window.cancelAnimationFrame(id);
      }, [ctx, editor, stableGetPos, latex]);

      const open = () => {
        if (!editor.isEditable || !ctx) return;
        ctx.openInline(stableGetPos, latex, ref.current);
      };

      return (
        <span
          ref={ref}
          dir="ltr"
          contentEditable={false}
          role={editor.isEditable ? "button" : undefined}
          tabIndex={editor.isEditable ? 0 : undefined}
          aria-label={t("Edit equation")}
          className={`notes-math-inline ${isOpen ? "is-open" : ""} ${!latex.trim() ? "is-empty" : ""}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={open}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              open();
            }
          }}
        >
          {!latex.trim() ? (
            <span className="notes-math-inline-placeholder">{t("New equation")}</span>
          ) : rendered?.html ? (
            <span className="notes-math-rendered" dangerouslySetInnerHTML={{ __html: rendered.html }} />
          ) : (
            <code className="notes-math-fallback">{latex}</code>
          )}
        </span>
      );
    },
    toExternalHTML: function MathInlineExternal({ inlineContent }) {
      return <span>{inlineContent.props.latex ? `$${inlineContent.props.latex}$` : ""}</span>;
    },
  },
);

// ---- 選択テキストを行内数式に変換 / カーソル位置に挿入 ----
function selectionLatex(view: NonNullable<AnyEditor["prosemirrorView"]>, from: number, to: number) {
  return view.state.doc
    .textBetween(from, to, " ", (leaf) => (leaf.type.name === "mathInline" ? String(leaf.attrs.latex ?? "") : ""))
    .replace(/\r?\n/g, " ")
    .trim();
}

export function canInsertInlineMath(editor: AnyEditor): boolean {
  const view = editor.prosemirrorView;
  if (!editor.isEditable || !view) return false;
  const { from, to, $from, $to } = view.state.selection;
  if (!$from.sameParent($to) || !$from.parent.inlineContent || $from.parent.type.spec.code) return false;
  // 上限を超える選択範囲は切り捨てず、変換対象から外す。
  return selectionLatex(view, from, to).length <= MAX_MATH_LATEX;
}

export function convertSelectionToInlineMath(editor: AnyEditor): boolean {
  const view = editor.prosemirrorView;
  if (!canInsertInlineMath(editor) || !view) return false;
  const nodeType = editor.pmSchema.nodes.mathInline;
  if (!nodeType) return false;
  const { from, to } = view.state.selection;
  const selected = selectionLatex(view, from, to);
  if (selected.length > MAX_MATH_LATEX) return false;
  editor.transact((tr) => {
    markNextMathInlineAutoOpen();
    tr.replaceRangeWith(tr.selection.from, tr.selection.to, nodeType.create({ latex: selected }));
  });
  return true;
}
