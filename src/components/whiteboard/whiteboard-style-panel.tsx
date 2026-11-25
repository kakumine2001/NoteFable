"use client";

import { applyDarkModeFilter } from "@excalidraw/excalidraw";
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignStartHorizontal,
  AlignStartVertical, AlignVerticalDistributeCenter, ArrowDownToLine, ArrowUpToLine, ChevronDown, ChevronUp, ChevronsDown, ChevronsUp, Copy, Group,
  ExternalLink, Link2, Lock, LockOpen, Plus, Trash2, Ungroup, AlignLeft, AlignCenter, AlignRight, FlipHorizontal2, FlipVertical2,
  ArrowLeftRight, CircleMinus, CirclePlus, GitBranchPlus, ListPlus, MoveRight,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { AppIcon } from "@/components/app-icon";
import { useT } from "@/components/i18n-provider";
import { msg } from "@/lib/i18n/translate";
import { useBackToClose } from "@/lib/use-back-to-close";
import type { WhiteboardActions } from "@/lib/whiteboard/excalidraw-bridge";
import type { WhiteboardUiState } from "@/components/whiteboard/whiteboard-ui";
import type { MindmapSelection } from "@/lib/whiteboard/mindmap/editing";
import type { MindmapDirection } from "@/lib/whiteboard/mindmap/model";

// ホワイトボードの見た目のパネル（色・太さ・線の種類・文字・重なり順・整列など）。選んでいる要素、または次に描く図形に効く。
// 変更は Excalidraw の組み込みの操作（changeStrokeColor など）で行い、取り消しの履歴にも入る。

export type WhiteboardStyle = {
  strokeColor: string | null;
  backgroundColor: string | null;
  opacity: number | null;
  roughness: number | null;
  strokeStyle: string | null;
  fillStyle: string | null;
  roundness: string | null;
  strokeWidthKey: string | null;
  strokeWidth: number | null;
  fontFamily: number | null;
  fontSize: number | null;
  textAlign: string | null;
  arrowType: string | null;
  startArrowhead: string | null;
  endArrowhead: string | null;
  variability: string | null;
};

// Excalidraw の色（open-color）。線は濃い色、塗りは薄い色、付箋は付箋の色、蛍光ペンは明るい色。
const STROKE_PICKS = ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00"];
const BACKGROUND_PICKS = ["transparent", "#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99"];
const STICKY_PICKS = ["#ffdf6b", "#fcc2d7", "#b2f2bb", "#a5d8ff", "#ffd8a8"];
const HIGHLIGHTER_PICKS = ["#ffd43b", "#69db7c", "#4dabf7", "#f783ac", "#ffa94d"];
const PALETTE: string[][] = [
  ["#ffffff", "#f8f9fa", "#e9ecef", "#ced4da", "#868e96", "#343a40", "#1e1e1e"],
  ["#ffc9c9", "#ff8787", "#fa5252", "#e03131"], ["#fcc2d7", "#f783ac", "#e64980", "#c2255c"], ["#eebefa", "#da77f2", "#be4bdb", "#9c36b5"],
  ["#d0bfff", "#9775fa", "#7950f2", "#6741d9"], ["#a5d8ff", "#4dabf7", "#228be6", "#1971c2"], ["#99e9f2", "#3bc9db", "#15aabf", "#0c8599"],
  ["#96f2d7", "#38d9a9", "#12b886", "#099268"], ["#b2f2bb", "#69db7c", "#40c057", "#2f9e44"], ["#ffec99", "#ffd43b", "#fab005", "#f08c00"],
  ["#ffd8a8", "#ffa94d", "#fd7e14", "#e8590c"], ["#eaddd7", "#d2bab0", "#a18072", "#846358"],
];

const SHAPE_TYPES = new Set(["rectangle", "diamond", "ellipse"]);
const FILLABLE = new Set(["rectangle", "diamond", "ellipse", "stickynote", "line"]);
const TEXT_TYPES = new Set(["text", "stickynote"]);
const ROUNDABLE = new Set(["rectangle", "diamond", "line", "stickynote"]);
const LINEAR = new Set(["line", "arrow"]);

// 道具 → その道具で描く要素の種類（パネルに何を出すかを決める）。
const TOOL_ELEMENT: Record<string, string> = {
  rectangle: "rectangle", diamond: "diamond", ellipse: "ellipse", line: "line", arrow: "arrow", freedraw: "freedraw", text: "text",
  stickynote: "stickynote", frame: "frame", lasso: "", selection: "",
};

const FONTS: { value: number; label: string; className: string }[] = [
  { value: 5, label: msg("Hand-drawn"), className: "is-hand" },
  { value: 6, label: msg("Normal"), className: "is-normal" },
  { value: 8, label: msg("Code"), className: "is-code" },
];
// 字号のボタンは S・M・L・XL と短く見せ、名前（読み上げ・ツールチップ）は訳す。
const FONT_SIZES: { value: number; label: string; short: string }[] = [
  { value: 16, label: msg("Small"), short: "S" }, { value: 20, label: msg("Medium"), short: "M" },
  { value: 28, label: msg("Large"), short: "L" }, { value: 36, label: msg("Extra large"), short: "XL" },
];
const ARROWHEADS: { value: string | null; label: string }[] = [
  { value: null, label: msg("None") }, { value: "arrow", label: msg("Arrow") }, { value: "triangle", label: msg("Triangle") },
  { value: "dot", label: msg("Dot") }, { value: "bar", label: msg("Bar") },
];

// 思考マップの節を 1 つ選んでいるときに、見た目のパネルの上に出す操作（浮かぶボタン・キーと同じ）。
export type WhiteboardMindmapPanel = {
  selection: MindmapSelection;
  onAddChild: (nodeId: string) => void;
  onAddSibling: (nodeId: string) => void;
  onToggle: (nodeId: string) => void;
  onDirection: (nodeId: string, direction: MindmapDirection) => void;
};

export function WhiteboardStylePanel({ ui, drawMode, compact, theme, actions, onLink, onOpenLink, onAskAi, mindmap, textOnly = false }: {
  ui: WhiteboardUiState;
  drawMode: "pen" | "highlighter" | null;
  compact: boolean;
  theme: "light" | "dark";
  actions: WhiteboardActions | null;
  onLink: () => void;
  onOpenLink: (link: string) => void;
  onAskAi?: () => void;
  mindmap?: WhiteboardMindmapPanel | null;
  // 文字の入力中（文字の見た目だけを出す）。
  textOnly?: boolean;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  // スマホで広げた下のシートは、端末の「戻る」で畳む（アプリでも白板を閉じない）。
  useBackToClose(compact && expanded, () => setExpanded(false));
  const { style } = ui;
  const types = new Set(ui.selectedCount ? ui.selectedTypes : [TOOL_ELEMENT[ui.tool] ?? ui.tool].filter(Boolean));
  if (textOnly) { types.clear(); types.add("text"); }
  const has = (set: Set<string>) => [...types].some((type) => set.has(type));
  const only = (type: string) => types.size === 1 && types.has(type);
  const run = (name: string, value?: unknown) => { actions?.run(name, value); };
  const selection = ui.selectedCount > 0 && !textOnly;
  const freedraw = types.has("freedraw");
  const picks = freedraw && drawMode === "highlighter" ? HIGHLIGHTER_PICKS : STROKE_PICKS;
  const showStroke = !only("image") && !only("frame") && types.size > 0;
  const showBackground = has(FILLABLE);
  const backgroundPicks = only("stickynote") ? STICKY_PICKS : BACKGROUND_PICKS;
  const showWidth = [...types].some((type) => !TEXT_TYPES.has(type) && type !== "image" && type !== "frame");
  const showStrokeStyle = has(SHAPE_TYPES) || has(LINEAR);
  const showSloppiness = has(SHAPE_TYPES) || has(LINEAR);
  const showRoundness = has(ROUNDABLE) && !only("stickynote");
  const showArrow = types.has("arrow");
  const showText = has(TEXT_TYPES) || ui.editingText;
  const multi = ui.selectedCount >= 2 || ui.groupSelected;
  const collapsed = compact && !expanded;

  const color = (value: string) => theme === "dark" && value !== "transparent" ? applyDarkModeFilter(value) : value;
  const hasStyleControls = showStroke || showBackground || showWidth || !collapsed;

  const actionsButtons = (
    <div className="whiteboard-actions-row" role="toolbar" aria-label={t("Actions")}>
      {multi && !ui.groupSelected && <IconAction label={t("Group")} onClick={() => run("group")}><Group size={15} /></IconAction>}
      {ui.groupSelected && <IconAction label={t("Ungroup")} onClick={() => run("ungroup")}><Ungroup size={15} /></IconAction>}
      <IconAction label={t("Duplicate")} onClick={() => run("duplicateSelection")}><Copy size={15} /></IconAction>
      {!collapsed && <IconAction label={t("Flip horizontal")} onClick={() => run("flipHorizontal")}><FlipHorizontal2 size={15} /></IconAction>}
      {!collapsed && <IconAction label={t("Flip vertical")} onClick={() => run("flipVertical")}><FlipVertical2 size={15} /></IconAction>}
      {!collapsed && <IconAction label={ui.link ? t("Edit link") : t("Add link")} onClick={onLink}><Link2 size={15} /></IconAction>}
      {ui.link && !collapsed && <IconAction label={t("Open link")} onClick={() => onOpenLink(ui.link!)}><ExternalLink size={15} /></IconAction>}
      {!collapsed && <IconAction label={ui.allLocked ? t("Unlock") : t("Lock")} onClick={() => run("toggleElementLock")}>{ui.allLocked ? <LockOpen size={15} /> : <Lock size={15} />}</IconAction>}
      <span className="whiteboard-actions-sep" aria-hidden="true" />
      <IconAction label={t("Delete")} danger onClick={() => run("deleteSelectedElements")}><Trash2 size={15} /></IconAction>
    </div>
  );

  const askAiButton = onAskAi ? (
    <button type="button" className="whiteboard-panel-ai" onClick={onAskAi} title={t("Ask NoteFable")}>
      <AppIcon size={18} />
      <span className="whiteboard-panel-ai-label">{t("Ask NoteFable")}</span>
      {ui.selectedCount > 1 && <span className="whiteboard-panel-ai-count">{ui.selectedCount}</span>}
    </button>
  ) : null;

  return <div className={`whiteboard-panel${compact ? " is-compact" : ""}${collapsed ? " is-collapsed" : ""}`} role="region" aria-label={t("Style")} data-viewport-ui={compact ? "bottom" : "side"}
    onKeyDown={(event) => event.stopPropagation()}>
    {selection && (collapsed ? (
      <div className="whiteboard-compact-top">
        {askAiButton}
        {actionsButtons}
      </div>
    ) : (
      <div className="whiteboard-panel-head">
        {askAiButton}
        <Section label={t("Actions")}>{actionsButtons}</Section>
        {mindmap && <MindmapSection mindmap={mindmap} />}
        {hasStyleControls && <hr className="whiteboard-panel-divider" />}
      </div>
    ))}
    {showStroke && <Section label={freedraw && drawMode === "highlighter" ? t("Highlighter color") : t("Stroke")}>
      <Swatches picks={picks} current={style.strokeColor} display={color} onPick={(value) => run("changeStrokeColor", { color: value })} />
    </Section>}
    {showBackground && !collapsed && <Section label={only("stickynote") ? t("Note color") : t("Background")}>
      <Swatches picks={backgroundPicks} current={style.backgroundColor} display={color} onPick={(value) => run("changeBackgroundColor", { color: value })} />
    </Section>}
    {showBackground && collapsed && only("stickynote") && <Section label={t("Note color")}>
      <Swatches picks={backgroundPicks} current={style.backgroundColor} display={color} onPick={(value) => run("changeBackgroundColor", { color: value })} />
    </Section>}
    {showWidth && <Section label={t("Stroke width")}>
      <Choice options={[{ value: "thin", label: t("Thin"), icon: <WidthIcon size={1} /> }, { value: "medium", label: t("Medium"), icon: <WidthIcon size={2.5} /> }, { value: "bold", label: t("Thick"), icon: <WidthIcon size={4.5} /> }]}
        current={style.strokeWidthKey ?? widthKeyOf(style.strokeWidth, freedraw)} onPick={(value) => run("changeStrokeWidth", value)} />
    </Section>}
    {!collapsed && <>
      {freedraw && drawMode !== "highlighter" && <Section label={t("Pressure")}>
        <Choice options={[{ value: "variable", label: t("Pressure-sensitive") }, { value: "constant", label: t("Even width") }]} current={style.variability} onPick={(value) => run("changeFreedrawMode", value)} />
      </Section>}
      {showBackground && style.backgroundColor && style.backgroundColor !== "transparent" && !only("stickynote") && <Section label={t("Fill style")}>
        <Choice options={[{ value: "solid", label: t("Solid fill") }, { value: "hachure", label: t("Hatch") }, { value: "cross-hatch", label: t("Cross-hatch") }]} current={style.fillStyle} onPick={(value) => run("changeFillStyle", value)} />
      </Section>}
      {showStrokeStyle && <Section label={t("Line style")}>
        <Choice options={[{ value: "solid", label: t("Solid") }, { value: "dashed", label: t("Dashed") }, { value: "dotted", label: t("Dotted") }]} current={style.strokeStyle} onPick={(value) => run("changeStrokeStyle", value)} />
      </Section>}
      {showSloppiness && <Section label={t("Style")}>
        <Choice options={[{ value: 0, label: t("Clean") }, { value: 1, label: t("Hand-drawn") }, { value: 2, label: t("Sketchy") }]} current={style.roughness} onPick={(value) => run("changeSloppiness", value)} />
      </Section>}
      {showRoundness && <Section label={t("Corners")}>
        <Choice options={[{ value: "sharp", label: t("Sharp") }, { value: "round", label: t("Round") }]} current={style.roundness} onPick={(value) => run("changeRoundness", value)} />
      </Section>}
      {showArrow && <>
        <Section label={t("Arrow type")}>
          <Choice options={[{ value: "sharp", label: t("Straight") }, { value: "round", label: t("Curved") }, { value: "elbow", label: t("Elbow") }]} current={style.arrowType} onPick={(value) => run("changeArrowType", value)} />
        </Section>
        <Section label={t("Arrowheads")}>
          <div className="whiteboard-row">
            <select className="whiteboard-select" aria-label={t("Start")} value={style.startArrowhead ?? ""} onChange={(event) => run("changeArrowhead", { position: "start", type: event.target.value || null })}>
              {ARROWHEADS.map((head) => <option key={`s${head.value}`} value={head.value ?? ""}>{t("Start")}: {t(head.label)}</option>)}
            </select>
            <select className="whiteboard-select" aria-label={t("End")} value={style.endArrowhead ?? ""} onChange={(event) => run("changeArrowhead", { position: "end", type: event.target.value || null })}>
              {ARROWHEADS.map((head) => <option key={`e${head.value}`} value={head.value ?? ""}>{t("End")}: {t(head.label)}</option>)}
            </select>
          </div>
        </Section>
      </>}
      {showText && <>
        <Section label={t("Font")}>
          <Choice options={FONTS.map((font) => ({ value: font.value, label: t(font.label) }))} current={style.fontFamily} onPick={(value) => run("changeFontFamily", { currentItemFontFamily: value })} />
        </Section>
        <Section label={t("Font size")}>
          <Choice options={FONT_SIZES.map((size) => ({ value: size.value, label: t(size.label), icon: size.short }))} current={style.fontSize} onPick={(value) => run("changeFontSize", value)} />
        </Section>
        <Section label={t("Text align")}>
          <Choice options={[{ value: "left", label: t("Left"), icon: <AlignLeft size={15} /> }, { value: "center", label: t("Center"), icon: <AlignCenter size={15} /> }, { value: "right", label: t("Right"), icon: <AlignRight size={15} /> }]}
            current={style.textAlign} onPick={(value) => run("changeTextAlign", value)} />
        </Section>
      </>}
      {!textOnly && <Section label={t("Opacity")}>
        <input type="range" className="whiteboard-range" min={10} max={100} step={10} value={style.opacity ?? 100} aria-label={t("Opacity")}
          onChange={(event) => run("changeOpacity", Number(event.target.value))} />
      </Section>}
      {selection && <Section label={t("Layers")}>
        <div className="whiteboard-row">
          <IconAction label={t("Send to back")} onClick={() => run("sendToBack")}><ArrowDownToLine size={15} /></IconAction>
          <IconAction label={t("Send backward")} onClick={() => run("sendBackward")}><ChevronsDown size={15} /></IconAction>
          <IconAction label={t("Bring forward")} onClick={() => run("bringForward")}><ChevronsUp size={15} /></IconAction>
          <IconAction label={t("Bring to front")} onClick={() => run("bringToFront")}><ArrowUpToLine size={15} /></IconAction>
        </div>
      </Section>}
      {selection && multi && <Section label={t("Align")}>
        <div className="whiteboard-row">
          <IconAction label={t("Align left")} onClick={() => run("alignLeft")}><AlignStartVertical size={15} /></IconAction>
          <IconAction label={t("Center horizontally")} onClick={() => run("alignHorizontallyCentered")}><AlignCenterVertical size={15} /></IconAction>
          <IconAction label={t("Align right")} onClick={() => run("alignRight")}><AlignEndVertical size={15} /></IconAction>
          <IconAction label={t("Align top")} onClick={() => run("alignTop")}><AlignStartHorizontal size={15} /></IconAction>
          <IconAction label={t("Center vertically")} onClick={() => run("alignVerticallyCentered")}><AlignCenterHorizontal size={15} /></IconAction>
          <IconAction label={t("Align bottom")} onClick={() => run("alignBottom")}><AlignEndHorizontal size={15} /></IconAction>
        </div>
        {ui.selectedCount >= 3 && <div className="whiteboard-row">
          <IconAction label={t("Distribute horizontally")} onClick={() => run("distributeHorizontally")}><AlignHorizontalDistributeCenter size={15} /></IconAction>
          <IconAction label={t("Distribute vertically")} onClick={() => run("distributeVertically")}><AlignVerticalDistributeCenter size={15} /></IconAction>
        </div>}
      </Section>}
    </>}
    {compact && <button type="button" className="whiteboard-panel-expand" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
      {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}<span>{expanded ? t("Fewer options") : t("More options")}</span>
    </button>}
  </div>;
}

function widthKeyOf(width: number | null, freedraw: boolean) {
  if (width === null) return null;
  const table = freedraw ? { thin: 0.5, medium: 1, bold: 2 } : { thin: 1, medium: 2, bold: 4 };
  return (Object.entries(table).find(([, value]) => value === width)?.[0]) ?? null;
}

function WidthIcon({ size }: { size: number }) {
  return <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><line x1="3" y1="9" x2="15" y2="9" stroke="currentColor" strokeWidth={size} strokeLinecap="round" /></svg>;
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return <fieldset className="whiteboard-section"><legend className="whiteboard-section-label">{label}</legend>{children}</fieldset>;
}

function Choice<T extends string | number>({ options, current, onPick }: { options: { value: T; label: string; icon?: ReactNode }[]; current: T | null; onPick: (value: T) => void }) {
  return <div className="whiteboard-choice" role="radiogroup">
    {options.map((option) => <button key={String(option.value)} type="button" role="radio" aria-checked={current === option.value} title={option.label}
      aria-label={option.label} className={`whiteboard-choice-item${current === option.value ? " is-active" : ""}`} onClick={() => onPick(option.value)}>
      {option.icon ?? option.label}
    </button>)}
  </div>;
}

function IconAction({ label, onClick, danger = false, children }: { label: string; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return <button type="button" className={`whiteboard-icon-action${danger ? " is-danger" : ""}`} aria-label={label} title={label} onClick={onClick}>{children}</button>;
}

function Swatches({ picks, current, display, onPick }: { picks: string[]; current: string | null; display: (color: string) => string; onPick: (color: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // 開いた色の一覧も「戻る」で閉じる。
  useBackToClose(open, () => setOpen(false));
  const [hex, setHex] = useState("");
  const normalized = current?.toLowerCase() ?? null;
  return <div className="whiteboard-swatches-wrap">
    <div className="whiteboard-swatches" role="radiogroup">
      {picks.map((color) => <button key={color} type="button" role="radio" aria-checked={normalized === color} aria-label={color === "transparent" ? t("Transparent") : color} title={color === "transparent" ? t("Transparent") : color}
        className={`whiteboard-swatch${color === "transparent" ? " is-transparent" : ""}${normalized === color ? " is-active" : ""}`} style={color === "transparent" ? undefined : { background: display(color) }}
        onClick={() => onPick(color)} />)}
      <button type="button" className={`whiteboard-swatch is-more${normalized && !picks.includes(normalized) ? " is-active" : ""}`} aria-expanded={open} aria-label={t("More colors")} title={t("More colors")}
        style={normalized && !picks.includes(normalized) && normalized !== "transparent" ? { background: display(normalized) } : undefined} onClick={() => setOpen((value) => !value)}>
        {!(normalized && !picks.includes(normalized)) && <Plus size={12} aria-hidden="true" />}
      </button>
    </div>
    {open && <div className="whiteboard-palette">
      {PALETTE.map((row, index) => <div key={index} className="whiteboard-palette-row">
        {row.map((color) => <button key={color} type="button" className={`whiteboard-swatch is-small${normalized === color ? " is-active" : ""}`} style={{ background: display(color) }}
          aria-label={color} title={color} onClick={() => { onPick(color); setOpen(false); }} />)}
      </div>)}
      <form className="whiteboard-hex" onSubmit={(event) => {
        event.preventDefault();
        const value = hex.trim().replace(/^#?/, "#");
        if (/^#[0-9a-f]{6}$/i.test(value)) { onPick(value.toLowerCase()); setOpen(false); setHex(""); }
      }}>
        <input className="whiteboard-hex-input" value={hex} placeholder="#1e1e1e" aria-label={t("Color code")} maxLength={7} onChange={(event) => setHex(event.target.value)} />
        <button type="submit" className="notion-button">{t("Apply")}</button>
      </form>
    </div>}
  </div>;
}

// 思考マップの節の操作：子・兄弟を足す、畳む・広げる、枝の向き（木全体）。
function MindmapSection({ mindmap }: { mindmap: WhiteboardMindmapPanel }) {
  const t = useT();
  const { selection } = mindmap;
  return <Section label={t("Mind map")}>
    <div className="whiteboard-actions-row" role="toolbar" aria-label={t("Mind map")}>
      <IconAction label={`${t("Add child")} — Tab`} onClick={() => mindmap.onAddChild(selection.nodeId)}><GitBranchPlus size={15} className="rtl-mirror" /></IconAction>
      {!selection.isRoot && <IconAction label={`${t("Add sibling")} — Enter`} onClick={() => mindmap.onAddSibling(selection.nodeId)}><ListPlus size={15} /></IconAction>}
      {selection.hasChildren && <IconAction label={selection.collapsed ? t("Expand branch") : t("Collapse branch")} onClick={() => mindmap.onToggle(selection.nodeId)}>
        {selection.collapsed ? <CirclePlus size={15} /> : <CircleMinus size={15} />}
      </IconAction>}
    </div>
    <Choice options={[
      { value: "right", label: t("Branches on the right"), icon: <MoveRight size={16} className="rtl-mirror" /> },
      { value: "both", label: t("Branches on both sides"), icon: <ArrowLeftRight size={16} /> },
    ]}
      current={selection.direction} onPick={(value) => mindmap.onDirection(selection.nodeId, value as MindmapDirection)} />
  </Section>;
}
