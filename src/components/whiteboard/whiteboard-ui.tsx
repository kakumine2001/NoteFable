"use client";

import {
  Circle, Diamond, Ellipsis, Eraser, FileDown, FileUp, Frame, Grid3x3, Hand, Highlighter, ImagePlus, Lasso, LocateFixed, Magnet, Map as MapIcon,
  Maximize, Minus, MousePointer2, MoveUpRight, Pen, Redo2, Square, StickyNote, Type, Undo2, Wand2, ZoomIn, ZoomOut, Link2, PenTool, Palette,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnswerMenu } from "@/components/answer-actions";
import { useT } from "@/components/i18n-provider";
import { NoteIcon } from "@/components/note-icon";
import { PageKindIcon } from "@/components/page-kind-icon";
import { EmojiPopover } from "@/components/emoji-picker";
import { msg } from "@/lib/i18n/translate";
import type { WhiteboardActions } from "@/lib/whiteboard/excalidraw-bridge";
import { WhiteboardStylePanel, type WhiteboardStyle } from "@/components/whiteboard/whiteboard-style-panel";
import type { MentionPage } from "@/components/note-mention";

// ホワイトボードの自前の画面（ツールバー・見た目のパネル・拡大縮小・メニュー・題名）。Excalidraw の既定の画面（ui={false} で消している）の代わり。
// 文言は useT()（17 言語）。Excalidraw の操作は橋渡し（excalidraw-bridge.ts）から名前で実行する。

export type WhiteboardTool =
  | "select" | "lasso" | "hand" | "pen" | "highlighter" | "eraser" | "laser"
  | "rectangle" | "diamond" | "ellipse" | "line" | "arrow" | "text" | "sticky" | "image" | "frame";

// 自前の道具 → Excalidraw の道具。ペンと蛍光ペンはどちらも freedraw（見た目の既定値だけが違う）。
const TOOL_TYPES: Record<WhiteboardTool, string> = {
  select: "selection", lasso: "lasso", hand: "hand", pen: "freedraw", highlighter: "freedraw", eraser: "eraser", laser: "laser",
  rectangle: "rectangle", diamond: "diamond", ellipse: "ellipse", line: "line", arrow: "arrow", text: "text", sticky: "stickynote",
  image: "image", frame: "frame",
};
export const toolType = (tool: WhiteboardTool) => TOOL_TYPES[tool];

export type WhiteboardUiState = {
  tool: string;
  toolLocked: boolean;
  selectedCount: number;
  selectedTypes: string[];
  groupSelected: boolean;
  allLocked: boolean;
  editingText: boolean;
  zoom: number;
  grid: boolean;
  snap: boolean;
  penMode: boolean;
  penDetected: boolean;
  viewBackgroundColor: string;
  link: string | null;
  style: WhiteboardStyle;
};

const TOOL_LABELS: Record<WhiteboardTool, string> = {
  select: msg("Select"), lasso: msg("Lasso select"), hand: msg("Hand (pan)"), pen: msg("Pen"), highlighter: msg("Highlighter"), eraser: msg("Eraser"),
  laser: msg("Laser pointer"), rectangle: msg("Rectangle"), diamond: msg("Diamond"), ellipse: msg("Ellipse"), line: msg("Line"), arrow: msg("Arrow"),
  text: msg("Text"), sticky: msg("Sticky note"), image: msg("Image"), frame: msg("Frame"),
};
// Excalidraw と同じ 1 文字のショートカット（キーは Excalidraw が処理する。ここは表示だけ）。
const TOOL_KEYS: Partial<Record<WhiteboardTool, string>> = {
  select: "V", hand: "H", pen: "P", eraser: "E", laser: "K", rectangle: "R", diamond: "D", ellipse: "O", line: "L", arrow: "A", text: "T", sticky: "S", image: "I", frame: "F",
};
const TOOL_ICONS: Record<WhiteboardTool, ReactNode> = {
  select: <MousePointer2 size={18} />, lasso: <Lasso size={18} />, hand: <Hand size={18} />, pen: <Pen size={18} />, highlighter: <Highlighter size={18} />,
  eraser: <Eraser size={18} />, laser: <Wand2 size={18} />, rectangle: <Square size={18} />, diamond: <Diamond size={18} />, ellipse: <Circle size={18} />,
  line: <Minus size={18} />, arrow: <MoveUpRight size={18} />, text: <Type size={18} />, sticky: <StickyNote size={18} />, image: <ImagePlus size={18} />,
  frame: <Frame size={18} />,
};
const SHAPES: WhiteboardTool[] = ["rectangle", "diamond", "ellipse"];

export type WhiteboardChromeProps = {
  ui: WhiteboardUiState;
  // ペンと蛍光ペンのどちらで描いているか（どちらも Excalidraw では freedraw）。
  drawMode: "pen" | "highlighter" | null;
  editable: boolean;
  embedded: boolean;
  compact: boolean;
  theme: "light" | "dark";
  actions: WhiteboardActions | null;
  title: string;
  icon: string | null;
  onTitleChange: (title: string) => void;
  onIconChange: (icon: string | null) => void;
  onSelectTool: (tool: WhiteboardTool) => void;
  onLink: () => void;
  onOpenLink: (link: string) => void;
  onInsertPageCard: () => void;
  onExport: (format: "png" | "svg" | "pdf") => void;
  onImportPdf: () => void;
  onFitToContent: () => void;
  onCanvasBackground: (color: string) => void;
  onPenMode: (penMode: boolean) => void;
  minimapOpen: boolean;
  onToggleMinimap: () => void;
  // 表示中の範囲に図形が 1 つも無いとき「内容に戻る」を出す。
  contentHidden: boolean;
  busy: string | null;
  pages?: MentionPage[];
  aiSlot?: ReactNode;
  minimap?: ReactNode;
};

export function WhiteboardChrome(props: WhiteboardChromeProps) {
  const { ui, editable, compact } = props;
  return <>
    <WhiteboardTitle {...props} />
    <WhiteboardMenu {...props} />
    {editable && <WhiteboardToolbar {...props} />}
    {editable && (ui.selectedCount > 0 || isDrawingTool(ui.tool)) && !ui.editingText && <WhiteboardStylePanel ui={ui} drawMode={props.drawMode} compact={compact} theme={props.theme}
      actions={props.actions} onLink={props.onLink} onOpenLink={props.onOpenLink} />}
    {editable && ui.editingText && <WhiteboardStylePanel ui={ui} drawMode={props.drawMode} compact={compact} theme={props.theme} actions={props.actions} onLink={props.onLink} onOpenLink={props.onOpenLink} textOnly />}
    <WhiteboardZoomBar {...props} />
    {props.minimapOpen && props.minimap}
    {props.contentHidden && <button type="button" className="whiteboard-back-to-content" onClick={props.onFitToContent}>
      <LocateFixed size={15} aria-hidden="true" /><WhiteboardText text="Back to content" />
    </button>}
    {props.busy && <div className="whiteboard-busy" role="status"><span className="whiteboard-spinner" aria-hidden="true" />{props.busy}</div>}
    {props.aiSlot && <div className="whiteboard-ai-slot">{props.aiSlot}</div>}
  </>;
}

function WhiteboardText({ text }: { text: string }) {
  const t = useT();
  return <span>{t(text)}</span>;
}

// 描く道具（見た目のパネルを出す）。選択・手のひら・消しゴム・レーザーは出さない。
export function isDrawingTool(tool: string) {
  return !["selection", "lasso", "hand", "eraser", "laser", "image"].includes(tool);
}

function activeToolOf(ui: WhiteboardUiState, drawMode: WhiteboardChromeProps["drawMode"]): WhiteboardTool | null {
  if (ui.tool === "freedraw") return drawMode === "highlighter" ? "highlighter" : "pen";
  const found = (Object.keys(TOOL_TYPES) as WhiteboardTool[]).find((tool) => TOOL_TYPES[tool] === ui.tool && tool !== "pen" && tool !== "highlighter");
  return found ?? null;
}

function ToolButton({ tool, active, onSelect, label }: { tool: WhiteboardTool; active: boolean; onSelect: (tool: WhiteboardTool) => void; label?: string }) {
  const t = useT();
  const key = TOOL_KEYS[tool];
  const name = label ?? t(TOOL_LABELS[tool]);
  return <button type="button" className={`whiteboard-tool${active ? " is-active" : ""}`} aria-pressed={active} aria-label={name}
    title={key ? `${name} — ${key}` : name} onClick={() => onSelect(tool)} data-tool={tool}>
    {TOOL_ICONS[tool]}
  </button>;
}

function WhiteboardToolbar({ ui, drawMode, compact, onSelectTool, onLink, onInsertPageCard, onImportPdf }: WhiteboardChromeProps) {
  const t = useT();
  const active = activeToolOf(ui, drawMode);
  const [shape, setShape] = useState<WhiteboardTool>("rectangle");
  const shown = active && SHAPES.includes(active) ? active : shape;
  const menuId = useId();
  const [menu, setMenu] = useState<{ anchor: DOMRect; trigger: HTMLButtonElement; kind: "shapes" | "more" } | null>(null);
  const close = () => setMenu(null);
  const pick = (tool: WhiteboardTool) => { close(); if (SHAPES.includes(tool)) setShape(tool); onSelectTool(tool); };
  const open = (kind: "shapes" | "more") => (event: React.MouseEvent<HTMLButtonElement>) =>
    setMenu({ anchor: event.currentTarget.getBoundingClientRect(), trigger: event.currentTarget, kind });
  // スマホでは、よく使う道具だけを並べ、残りは「その他」に入れる。
  const primary: WhiteboardTool[] = compact
    ? ["hand", "select", "pen", "highlighter", "eraser", "text", "sticky"]
    : ["select", "hand", "pen", "highlighter", "eraser", "laser", "line", "arrow", "text", "sticky", "image", "frame"];
  const extra: WhiteboardTool[] = compact
    ? ["lasso", "line", "arrow", "image", "frame", "laser"]
    : ["lasso"];
  return <div className="whiteboard-toolbar" role="toolbar" aria-label={t("Whiteboard tools")} data-viewport-ui="bottom">
    {primary.slice(0, compact ? 5 : 6).map((tool) => <ToolButton key={tool} tool={tool} active={active === tool} onSelect={onSelectTool} />)}
    <span className="whiteboard-toolbar-divider" aria-hidden="true" />
    <button type="button" className={`whiteboard-tool has-caret${active && SHAPES.includes(active) ? " is-active" : ""}`} aria-haspopup="menu" aria-expanded={menu?.kind === "shapes"}
      aria-label={t("Shapes")} title={t("Shapes")} onClick={(event) => { if (active && SHAPES.includes(active)) open("shapes")(event); else onSelectTool(shown); }}
      onContextMenu={(event) => { event.preventDefault(); open("shapes")(event as unknown as React.MouseEvent<HTMLButtonElement>); }}>
      {TOOL_ICONS[shown]}<span className="whiteboard-caret" aria-hidden="true" onClick={(event) => { event.stopPropagation(); open("shapes")(event as unknown as React.MouseEvent<HTMLButtonElement>); }} />
    </button>
    {primary.slice(compact ? 5 : 6).map((tool) => <ToolButton key={tool} tool={tool} active={active === tool} onSelect={onSelectTool} />)}
    <button type="button" className="whiteboard-tool" aria-haspopup="menu" aria-expanded={menu?.kind === "more"} aria-label={t("More tools")} title={t("More tools")} onClick={open("more")}>
      <Ellipsis size={18} />
    </button>
    {menu && <AnswerMenu id={menuId} label={menu.kind === "shapes" ? t("Shapes") : t("More tools")} className="whiteboard-menu" anchor={menu.anchor} trigger={menu.trigger} focusLast={false} onClose={close}>
      {menu.kind === "shapes" ? SHAPES.map((tool) => <button key={tool} type="button" role="menuitemradio" aria-checked={active === tool} className="chat-menu-item" onClick={() => pick(tool)}>
        {TOOL_ICONS[tool]}<span className="flex-1">{t(TOOL_LABELS[tool])}</span>{TOOL_KEYS[tool] && <kbd className="whiteboard-kbd">{TOOL_KEYS[tool]}</kbd>}
      </button>) : <>
        {extra.map((tool) => <button key={tool} type="button" role="menuitemradio" aria-checked={active === tool} className="chat-menu-item" onClick={() => pick(tool)}>
          {TOOL_ICONS[tool]}<span className="flex-1">{t(TOOL_LABELS[tool])}</span>{TOOL_KEYS[tool] && <kbd className="whiteboard-kbd">{TOOL_KEYS[tool]}</kbd>}
        </button>)}
        <hr className="chat-menu-divider" />
        <button type="button" role="menuitem" className="chat-menu-item" onClick={() => { close(); onInsertPageCard(); }}><PageKindIcon kind="note" size={18} /><span className="flex-1">{t("Link to a page")}</span></button>
        {ui.selectedCount > 0 && <button type="button" role="menuitem" className="chat-menu-item" onClick={() => { close(); onLink(); }}><Link2 size={18} /><span className="flex-1">{t("Add link")}</span></button>}
        <button type="button" role="menuitem" className="chat-menu-item" onClick={() => { close(); onImportPdf(); }}><FileUp size={18} /><span className="flex-1">{t("Import PDF")}</span></button>
      </>}
    </AnswerMenu>}
  </div>;
}

function WhiteboardZoomBar({ ui, editable, compact, actions, onFitToContent, minimapOpen, onToggleMinimap }: WhiteboardChromeProps) {
  const t = useT();
  const run = (name: string) => () => { actions?.run(name); };
  return <div className="whiteboard-zoombar" data-viewport-ui="bottom">
    {editable && <div className="whiteboard-group">
      <button type="button" className="whiteboard-tool" aria-label={t("Undo")} title={`${t("Undo")} — Ctrl+Z`} onClick={run("undo")}><Undo2 size={17} className="rtl-mirror" /></button>
      <button type="button" className="whiteboard-tool" aria-label={t("Redo")} title={`${t("Redo")} — Ctrl+Y`} onClick={run("redo")}><Redo2 size={17} className="rtl-mirror" /></button>
    </div>}
    <div className="whiteboard-group">
      <button type="button" className="whiteboard-tool" aria-label={t("Zoom out")} title={t("Zoom out")} onClick={run("zoomOut")}><ZoomOut size={17} /></button>
      <button type="button" className="whiteboard-zoom-value" aria-label={t("Reset zoom")} title={t("Reset zoom")} onClick={run("resetZoom")}>{Math.round(ui.zoom * 100)}%</button>
      <button type="button" className="whiteboard-tool" aria-label={t("Zoom in")} title={t("Zoom in")} onClick={run("zoomIn")}><ZoomIn size={17} /></button>
      {!compact && <button type="button" className="whiteboard-tool" aria-label={t("Fit to screen")} title={`${t("Fit to screen")} — Shift+1`} onClick={onFitToContent}><Maximize size={16} /></button>}
      <button type="button" className={`whiteboard-tool${minimapOpen ? " is-active" : ""}`} aria-pressed={minimapOpen} aria-label={t("Minimap")} title={t("Minimap")} onClick={onToggleMinimap}><MapIcon size={16} /></button>
    </div>
  </div>;
}

function WhiteboardMenu({ ui, editable, embedded, onExport, onImportPdf, onFitToContent, actions, onCanvasBackground, onPenMode }: WhiteboardChromeProps) {
  const t = useT();
  const id = useId();
  const [menu, setMenu] = useState<{ anchor: DOMRect; trigger: HTMLButtonElement } | null>(null);
  const close = () => setMenu(null);
  const run = (action: () => void) => () => { close(); action(); };
  return <div className="whiteboard-topbar-end" data-viewport-ui="top">
    <button type="button" className="whiteboard-tool" aria-label={t("Whiteboard options")} title={t("Whiteboard options")} aria-haspopup="menu" aria-expanded={!!menu}
      onClick={(event) => setMenu({ anchor: event.currentTarget.getBoundingClientRect(), trigger: event.currentTarget })}>
      <Ellipsis size={18} />
    </button>
    {menu && <AnswerMenu id={id} label={t("Whiteboard options")} className="whiteboard-menu" anchor={menu.anchor} trigger={menu.trigger} focusLast={false} onClose={close}>
      <div className="notes-menu-label">{t("Export")}</div>
      <button type="button" role="menuitem" className="chat-menu-item" onClick={run(() => onExport("png"))}><FileDown size={16} aria-hidden="true" />{t("Export as PNG")}</button>
      <button type="button" role="menuitem" className="chat-menu-item" onClick={run(() => onExport("svg"))}><FileDown size={16} aria-hidden="true" />{t("Export as SVG")}</button>
      <button type="button" role="menuitem" className="chat-menu-item" onClick={run(() => onExport("pdf"))}><FileDown size={16} aria-hidden="true" />{t("Export as PDF")}</button>
      {editable && <>
        <hr className="chat-menu-divider" />
        <button type="button" role="menuitem" className="chat-menu-item" onClick={run(onImportPdf)}><FileUp size={16} aria-hidden="true" />{t("Import PDF")}</button>
        <hr className="chat-menu-divider" />
        <MenuToggle icon={<Grid3x3 size={16} aria-hidden="true" />} label={t("Show grid")} checked={ui.grid} onToggle={() => actions?.run("gridMode")} />
        <MenuToggle icon={<Magnet size={16} aria-hidden="true" />} label={t("Snap to objects")} checked={ui.snap} onToggle={() => actions?.run("objectsSnapMode")} />
        {(ui.penDetected || embedded) && <MenuToggle icon={<PenTool size={16} aria-hidden="true" />} label={t("Draw with stylus only")} checked={ui.penMode} onToggle={() => onPenMode(!ui.penMode)} />}
        <div className="notes-menu-label"><Palette size={13} aria-hidden="true" className="inline-block me-1" />{t("Canvas color")}</div>
        <CanvasColors current={ui.viewBackgroundColor} onPick={(color) => onCanvasBackground(color)} />
      </>}
      <hr className="chat-menu-divider" />
      <button type="button" role="menuitem" className="chat-menu-item" onClick={run(onFitToContent)}><LocateFixed size={16} aria-hidden="true" />{t("Back to content")}</button>
    </AnswerMenu>}
  </div>;
}

const CANVAS_COLORS = ["#ffffff", "#f8f9fa", "#f5faff", "#fffce8", "#fdf8f6"];
function CanvasColors({ current, onPick }: { current: string; onPick: (color: string) => void }) {
  const t = useT();
  return <div className="whiteboard-swatches whiteboard-menu-swatches" role="radiogroup" aria-label={t("Canvas color")}>
    {CANVAS_COLORS.map((color) => <button key={color} type="button" role="menuitemradio" aria-checked={current.toLowerCase() === color} className="whiteboard-swatch"
      style={{ background: color }} aria-label={color} title={color} onClick={() => onPick(color)} />)}
  </div>;
}

function MenuToggle({ icon, label, checked, onToggle }: { icon: ReactNode; label: string; checked: boolean; onToggle: () => void }) {
  return <button type="button" role="menuitemcheckbox" aria-checked={checked} className="chat-menu-item notes-menu-toggle" onClick={onToggle}>
    {icon}<span className="flex-1">{label}</span><span className="notes-menu-switch" data-on={checked} aria-hidden="true" />
  </button>;
}

// 左上の題名とアイコン（ノートの題名と同じく、ここで変える）。
function WhiteboardTitle({ title, icon, editable, onTitleChange, onIconChange }: WhiteboardChromeProps) {
  const t = useT();
  const [draft, setDraft] = useState(title === "Untitled" ? "" : title);
  const [picker, setPicker] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(title === "Untitled" ? "" : title); }, [title]);
  return <div className="whiteboard-title" data-viewport-ui="top">
    <button ref={triggerRef} type="button" className="whiteboard-title-icon" disabled={!editable} aria-label={t("Change icon")} title={t("Change icon")}
      aria-haspopup="dialog" aria-expanded={picker} onClick={() => setPicker((open) => !open)}>
      <NoteIcon icon={icon} fallback={<PageKindIcon kind="whiteboard" size={16} />} />
    </button>
    <input className="whiteboard-title-input" value={draft} readOnly={!editable} placeholder={t("Untitled")} aria-label={t("Whiteboard title")} maxLength={200}
      onFocus={() => { editing.current = true; }}
      onBlur={() => { editing.current = false; }}
      onChange={(event) => { setDraft(event.target.value); onTitleChange(event.target.value); }}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === "Escape") { event.preventDefault(); event.currentTarget.blur(); } event.stopPropagation(); }} />
    {picker && <EmojiPopover current={icon} className="whiteboard-icon-popover" trigger={triggerRef} allowUpload onChange={(next) => { onIconChange(next); setPicker(false); }} onClose={() => setPicker(false)} />}
  </div>;
}

