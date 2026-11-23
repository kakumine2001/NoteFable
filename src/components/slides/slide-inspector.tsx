"use client";

import {
  AlignCenter, AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignJustify, AlignLeft, AlignRight,
  AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, ArrowDown, ArrowUp,
  Bold, BringToFront, Code, Eye, EyeOff, Flag, Group, ImagePlus, Italic, Link, List, ListOrdered, Minus, Plus, SendToBack, Sigma, SquareFunction, Strikethrough, Trash2,
  Underline, Ungroup,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useT } from "@/components/i18n-provider";
import { ColorPicker, MenuButton } from "@/components/slides/slide-menus";
import type { TextCommands } from "@/components/slides/text-editor";
import { alignElements, distributeElements, selectionUnits, type AlignMode } from "@/lib/slides/geometry";
import { LAYOUTS } from "@/lib/slides/layouts";
import { SHAPE_KINDS, type ColorRef, type FontRole, type LayoutId, type LineCap, type Slide, type SlideElement, type TableElement, type TextStyle } from "@/lib/slides/model";
import { groupElements, reorderElements, ungroupElements, updateElements, type ZOrder } from "@/lib/slides/ops";
import { SHAPE_LABELS } from "@/lib/slides/shapes";
import { resolveColor, type ResolvedTheme } from "@/lib/slides/themes";
import { msg } from "@/lib/i18n/translate";

// 右側（スマホでは下）の設定欄。何も選んでいないときはその枚（版式・背景・隠す）、選んでいるときは要素の位置・書式・重なり。

const FONT_ROLES: { key: FontRole; label: string }[] = [{ key: "heading", label: msg("Heading font") }, { key: "body", label: msg("Body font") }, { key: "mono", label: msg("Monospace") }];
const CAPS: { key: LineCap; label: string }[] = [{ key: "none", label: msg("None") }, { key: "arrow", label: msg("Arrow") }, { key: "triangle", label: msg("Triangle") }, { key: "oval", label: msg("Dot") }];
const DASHES = [{ key: "solid", label: msg("Solid") }, { key: "dash", label: msg("Dashed") }, { key: "dot", label: msg("Dotted") }] as const;
export const ELEMENT_LABELS: Record<SlideElement["type"], string> = {
  text: msg("Text"), shape: msg("Shape"), line: msg("Line"), image: msg("Image"), table: msg("Table"), whiteboard: msg("Whiteboard frame"),
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="slides-inspector-section"><h3>{title}</h3>{children}</section>;
}

function IconButton({ label, onClick, active, disabled, children }: { label: string; onClick: () => void; active?: boolean; disabled?: boolean; children: ReactNode }) {
  return <button type="button" className={`slides-icon-button${active ? " is-active" : ""}`} aria-label={label} title={label} aria-pressed={active} disabled={disabled} onClick={onClick}>{children}</button>;
}

// 数字の入力（打っている途中の値は手元に持ち、確定した数だけ渡す）。
function NumberField({ label, value, onChange, min, max, step = 1, suffix }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  // 打っている途中の文字（確定前の空欄や「-」も保つ）。打っていないときは値をそのまま出す。
  const [draft, setDraft] = useState<string | null>(null);
  return <label className="slides-number">
    <span>{label}</span>
    <input type="number" inputMode="decimal" value={draft ?? String(Math.round(value * 100) / 100)} min={min} max={max} step={step}
      onBlur={() => setDraft(null)}
      onChange={(event) => {
        setDraft(event.target.value);
        const parsed = Number(event.target.value);
        if (event.target.value.trim() && Number.isFinite(parsed)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed)));
      }} />
    {suffix && <em>{suffix}</em>}
  </label>;
}

function ColorField({ label, value, theme, onChange, allowNone = false }: { label: string; value: ColorRef | null; theme: ResolvedTheme; onChange: (value: ColorRef | null) => void; allowNone?: boolean }) {
  const t = useT();
  return <div className="slides-field">
    <span>{label}</span>
    <MenuButton label={label} className="slides-color-button" icon={<span className={`slides-color-chip${value === null ? " is-none" : ""}`} style={value === null ? undefined : { background: resolveColor(value, theme) }} />}
      text={<span className="slides-color-name">{value === null ? t("None") : value.startsWith("#") ? value : t(TOKEN_NAME[value] ?? value)}</span>}>
      {(close) => <ColorPicker value={value} theme={theme} allowNone={allowNone} onChange={(next) => { onChange(next); close(); }} />}
    </MenuButton>
  </div>;
}
const TOKEN_NAME: Record<string, string> = {
  text: msg("Text"), heading: msg("Heading"), muted: msg("Muted"), accent: msg("Accent"), accent2: msg("Accent 2"), accent3: msg("Accent 3"),
  surface: msg("Surface"), background: msg("Background"), line: msg("Line"),
};

// 文字の書式（箱全体）：書体・大きさ・色・揃え・行間。
function TextStyleFields({ style, theme, onChange }: { style: TextStyle; theme: ResolvedTheme; onChange: (patch: Partial<TextStyle>, field: string) => void }) {
  const t = useT();
  return <>
    <div className="slides-field">
      <span>{t("Font")}</span>
      <select value={style.font} onChange={(event) => onChange({ font: event.target.value as FontRole }, "font")}>
        {FONT_ROLES.map((role) => <option key={role.key} value={role.key}>{t(role.label)}</option>)}
      </select>
    </div>
    <div className="slides-field-row">
      <NumberField label={t("Size")} value={style.size} min={4} max={800} onChange={(size) => onChange({ size }, "size")} />
      <NumberField label={t("Line spacing")} value={style.lineHeight} min={0.8} max={3} step={0.05} onChange={(lineHeight) => onChange({ lineHeight }, "lineHeight")} />
    </div>
    <ColorField label={t("Text color")} value={style.color} theme={theme} onChange={(color) => onChange({ color: color ?? "text" }, "color")} />
    <div className="slides-button-row" role="group" aria-label={t("Text style")}>
      <IconButton label={t("Bold")} active={style.bold} onClick={() => onChange({ bold: !style.bold }, "bold")}><Bold size={16} /></IconButton>
      <IconButton label={t("Italic")} active={style.italic} onClick={() => onChange({ italic: !style.italic }, "italic")}><Italic size={16} /></IconButton>
      <span className="slides-button-gap" />
      <IconButton label={t("Align left")} active={style.align === "left"} onClick={() => onChange({ align: "left" }, "align")}><AlignLeft size={16} className="rtl-mirror" /></IconButton>
      <IconButton label={t("Align center")} active={style.align === "center"} onClick={() => onChange({ align: "center" }, "align")}><AlignCenter size={16} /></IconButton>
      <IconButton label={t("Align right")} active={style.align === "right"} onClick={() => onChange({ align: "right" }, "align")}><AlignRight size={16} className="rtl-mirror" /></IconButton>
      <IconButton label={t("Justify")} active={style.align === "justify"} onClick={() => onChange({ align: "justify" }, "align")}><AlignJustify size={16} /></IconButton>
    </div>
    <div className="slides-button-row" role="group" aria-label={t("Vertical alignment")}>
      <IconButton label={t("Top")} active={style.valign === "top"} onClick={() => onChange({ valign: "top" }, "valign")}><AlignVerticalJustifyStart size={16} /></IconButton>
      <IconButton label={t("Middle")} active={style.valign === "middle"} onClick={() => onChange({ valign: "middle" }, "valign")}><AlignVerticalJustifyCenter size={16} /></IconButton>
      <IconButton label={t("Bottom")} active={style.valign === "bottom"} onClick={() => onChange({ valign: "bottom" }, "valign")}><AlignVerticalJustifyEnd size={16} /></IconButton>
    </div>
  </>;
}

function tableWithSize(element: TableElement, rows: number, cols: number): TableElement {
  const nextRows = Array.from({ length: rows }, (_, r) => ({ cells: Array.from({ length: cols }, (_, c) => element.rows[r]?.cells[c] ?? { text: "" }) }));
  const nextCols = Array.from({ length: cols }, (_, c) => element.cols[c] ?? 1);
  return { ...element, rows: nextRows, cols: nextCols, h: Math.max(element.h * (rows / element.rows.length), 40) };
}

export function SlideInspector({ slide, selection, theme, editable, onChange, onReplaceImage, onReportImage, onDelete, onLayout, onToggleHidden }: {
  slide: Slide;
  selection: Set<string>;
  theme: ResolvedTheme;
  editable: boolean;
  onChange: (next: Slide, merge?: string) => void;
  onReplaceImage: (elementId: string) => void;
  onReportImage: (elementId: string) => void;
  onDelete: () => void;
  onLayout: (layout: LayoutId) => void;
  onToggleHidden: () => void;
}) {
  const t = useT();
  const selected = slide.elements.filter((element) => selection.has(element.id));
  const update = (ids: Set<string>, patch: (element: SlideElement) => SlideElement, field: string) =>
    onChange(updateElements(slide, ids, patch), `${field}:${[...ids].join(",")}`);

  if (!selected.length) {
    return <div className="slides-inspector" aria-label={t("Slide settings")}>
      <Section title={t("Layout")}>
        <div className="slides-layout-grid">
          {LAYOUTS.map((layout) => <button key={layout.id} type="button" disabled={!editable} className={`slides-layout-option${slide.layout === layout.id ? " is-active" : ""}`}
            aria-pressed={slide.layout === layout.id} onClick={() => onLayout(layout.id)}>
            <LayoutPreview layout={layout.id} /><span>{t(layout.name)}</span>
          </button>)}
        </div>
      </Section>
      <Section title={t("Slide")}>
        <ColorField label={t("Background")} value={slide.background ?? "background"} theme={theme}
          onChange={(color) => onChange({ ...slide, background: color && color !== "background" ? color : null })} />
        <button type="button" className="slides-wide-button" disabled={!editable} onClick={onToggleHidden}>
          {slide.hidden ? <Eye size={16} aria-hidden="true" /> : <EyeOff size={16} aria-hidden="true" />}{slide.hidden ? t("Show slide") : t("Hide slide")}
        </button>
      </Section>
    </div>;
  }

  const ids = new Set(selected.map((element) => element.id));
  const units = selectionUnits(slide.elements, ids).length;
  const single = selected.length === 1 ? selected[0] : null;
  const grouped = selected.some((element) => element.group);
  const types = new Set(selected.map((element) => element.type));
  const allText = selected.every((element) => element.type === "text" || element.type === "shape");

  return <div className="slides-inspector" aria-label={t("Selection settings")}>
    <Section title={single ? t(ELEMENT_LABELS[single.type]) : t("{count} selected", { count: selected.length })}>
      <div className="slides-button-row" role="group" aria-label={t("Align")}>
        {([
          ["left", t("Align left edges"), <AlignStartVertical key="l" size={16} />], ["hcenter", t("Align centers horizontally"), <AlignCenterVertical key="c" size={16} />],
          ["right", t("Align right edges"), <AlignEndVertical key="r" size={16} />], ["top", t("Align top edges"), <AlignStartHorizontal key="t" size={16} />],
          ["vcenter", t("Align middles"), <AlignCenterHorizontal key="m" size={16} />], ["bottom", t("Align bottom edges"), <AlignEndHorizontal key="b" size={16} />],
        ] as [AlignMode, string, ReactNode][]).map(([mode, label, icon]) => <IconButton key={mode} label={label} disabled={!editable}
          onClick={() => onChange({ ...slide, elements: alignElements(slide.elements, ids, mode) })}>{icon}</IconButton>)}
      </div>
      <div className="slides-button-row" role="group" aria-label={t("Arrange")}>
        <IconButton label={t("Distribute horizontally")} disabled={!editable || units < 3} onClick={() => onChange({ ...slide, elements: distributeElements(slide.elements, ids, "x") })}><AlignHorizontalDistributeCenter size={16} /></IconButton>
        <IconButton label={t("Distribute vertically")} disabled={!editable || units < 3} onClick={() => onChange({ ...slide, elements: distributeElements(slide.elements, ids, "y") })}><AlignVerticalDistributeCenter size={16} /></IconButton>
        <span className="slides-button-gap" />
        {([
          ["front", t("Bring to front"), <BringToFront key="f" size={16} />], ["forward", t("Bring forward"), <ArrowUp key="u" size={16} />],
          ["backward", t("Send backward"), <ArrowDown key="d" size={16} />], ["back", t("Send to back"), <SendToBack key="b" size={16} />],
        ] as [ZOrder, string, ReactNode][]).map(([order, label, icon]) => <IconButton key={order} label={label} disabled={!editable}
          onClick={() => onChange(reorderElements(slide, ids, order))}>{icon}</IconButton>)}
      </div>
      <div className="slides-button-row">
        <IconButton label={t("Group")} disabled={!editable || units < 2} onClick={() => onChange(groupElements(slide, ids).slide)}><Group size={16} /></IconButton>
        <IconButton label={t("Ungroup")} disabled={!editable || !grouped} onClick={() => onChange(ungroupElements(slide, ids))}><Ungroup size={16} /></IconButton>
        <span className="slides-button-gap" />
        <IconButton label={t("Delete")} disabled={!editable} onClick={onDelete}><Trash2 size={16} /></IconButton>
      </div>
    </Section>

    {single && <Section title={t("Position and size")}>
      <div className="slides-field-row">
        <NumberField label="X" value={single.x} onChange={(x) => update(ids, (element) => ({ ...element, x }), "x")} />
        <NumberField label="Y" value={single.y} onChange={(y) => update(ids, (element) => ({ ...element, y }), "y")} />
      </div>
      <div className="slides-field-row">
        <NumberField label={t("Width")} value={single.w} min={0} onChange={(w) => update(ids, (element) => ({ ...element, w }), "w")} />
        <NumberField label={t("Height")} value={single.h} min={0} onChange={(h) => update(ids, (element) => (element.type === "text" ? { ...element, h, autoHeight: false } : { ...element, h }), "h")} />
      </div>
      {single.type !== "line" && <NumberField label={t("Rotation")} value={single.rotation} min={-360} max={360} suffix="°" onChange={(rotation) => update(ids, (element) => ({ ...element, rotation }), "rotation")} />}
    </Section>}

    {allText && single && (single.type === "text" || single.type === "shape") && <Section title={t("Text")}>
      <TextStyleFields style={single.style} theme={theme} onChange={(patch, field) => update(ids, (element) => (element.type === "text" || element.type === "shape" ? { ...element, style: { ...element.style, ...patch } } : element), `style.${field}`)} />
      {single.type === "text" && <ColorField label={t("Fill")} value={single.fill} theme={theme} allowNone onChange={(fill) => update(ids, (element) => (element.type === "text" ? { ...element, fill } : element), "fill")} />}
    </Section>}

    {single?.type === "shape" && <Section title={t("Shape")}>
      <div className="slides-field">
        <span>{t("Shape")}</span>
        <select value={single.shape} onChange={(event) => update(ids, (element) => (element.type === "shape" ? { ...element, shape: event.target.value as typeof element.shape } : element), "shape")}>
          {SHAPE_KINDS.map((shape) => <option key={shape} value={shape}>{t(SHAPE_LABELS[shape])}</option>)}
        </select>
      </div>
      <ColorField label={t("Fill")} value={single.fill} theme={theme} allowNone onChange={(fill) => update(ids, (element) => (element.type === "shape" ? { ...element, fill } : element), "fill")} />
      <ColorField label={t("Border")} value={single.stroke} theme={theme} allowNone
        onChange={(stroke) => update(ids, (element) => (element.type === "shape" ? { ...element, stroke, strokeWidth: stroke && !element.strokeWidth ? 4 : element.strokeWidth } : element), "stroke")} />
      <div className="slides-field-row">
        <NumberField label={t("Border width")} value={single.strokeWidth} min={0} max={200} onChange={(strokeWidth) => update(ids, (element) => (element.type === "shape" ? { ...element, strokeWidth } : element), "strokeWidth")} />
        <div className="slides-field">
          <span>{t("Style")}</span>
          <select value={single.dash} onChange={(event) => update(ids, (element) => (element.type === "shape" ? { ...element, dash: event.target.value as typeof element.dash } : element), "dash")}>
            {DASHES.map((dash) => <option key={dash.key} value={dash.key}>{t(dash.label)}</option>)}
          </select>
        </div>
      </div>
    </Section>}

    {single?.type === "line" && <Section title={t("Line")}>
      <ColorField label={t("Color")} value={single.stroke} theme={theme} onChange={(stroke) => update(ids, (element) => (element.type === "line" ? { ...element, stroke: stroke ?? "text" } : element), "stroke")} />
      <div className="slides-field-row">
        <NumberField label={t("Width")} value={single.strokeWidth} min={0.5} max={200} onChange={(strokeWidth) => update(ids, (element) => (element.type === "line" ? { ...element, strokeWidth } : element), "strokeWidth")} />
        <div className="slides-field">
          <span>{t("Style")}</span>
          <select value={single.dash} onChange={(event) => update(ids, (element) => (element.type === "line" ? { ...element, dash: event.target.value as typeof element.dash } : element), "dash")}>
            {DASHES.map((dash) => <option key={dash.key} value={dash.key}>{t(dash.label)}</option>)}
          </select>
        </div>
      </div>
      <div className="slides-field-row">
        {(["start", "end"] as const).map((end) => <div key={end} className="slides-field">
          <span>{end === "start" ? t("Start") : t("End")}</span>
          <select value={single[end]} onChange={(event) => update(ids, (element) => (element.type === "line" ? { ...element, [end]: event.target.value as LineCap } : element), end)}>
            {CAPS.map((cap) => <option key={cap.key} value={cap.key}>{t(cap.label)}</option>)}
          </select>
        </div>)}
      </div>
    </Section>}

    {single?.type === "image" && <Section title={t("Image")}>
      <button type="button" className="slides-wide-button" disabled={!editable} onClick={() => onReplaceImage(single.id)}><ImagePlus size={16} aria-hidden="true" />{single.src ? t("Replace image") : t("Add an image")}</button>
      <div className="slides-field">
        <span>{t("Fit")}</span>
        <select value={single.fit} onChange={(event) => update(ids, (element) => (element.type === "image" ? { ...element, fit: event.target.value as "cover" | "contain" } : element), "fit")}>
          <option value="cover">{t("Fill the frame")}</option>
          <option value="contain">{t("Show the whole image")}</option>
        </select>
      </div>
      <NumberField label={t("Corner radius")} value={single.radius} min={0} max={540} onChange={(radius) => update(ids, (element) => (element.type === "image" ? { ...element, radius } : element), "radius")} />
      <label className="slides-field">
        <span>{t("Alt text")}</span>
        <input type="text" value={single.alt} maxLength={500} onChange={(event) => update(ids, (element) => (element.type === "image" ? { ...element, alt: event.target.value } : element), "alt")} />
      </label>
      {single.generated && <button type="button" className="slides-wide-button" onClick={() => onReportImage(single.id)}><Flag size={16} aria-hidden="true" />{t("Report image")}</button>}
    </Section>}

    {single?.type === "table" && <Section title={t("Table")}>
      <div className="slides-field-row">
        <div className="slides-stepper">
          <span>{t("Rows")}</span>
          <IconButton label={t("Remove row")} disabled={!editable || single.rows.length <= 1} onClick={() => update(ids, (element) => (element.type === "table" ? tableWithSize(element, element.rows.length - 1, element.cols.length) : element), "rows")}><Minus size={14} /></IconButton>
          <b>{single.rows.length}</b>
          <IconButton label={t("Add row")} disabled={!editable || single.rows.length >= 50} onClick={() => update(ids, (element) => (element.type === "table" ? tableWithSize(element, element.rows.length + 1, element.cols.length) : element), "rows")}><Plus size={14} /></IconButton>
        </div>
        <div className="slides-stepper">
          <span>{t("Columns")}</span>
          <IconButton label={t("Remove column")} disabled={!editable || single.cols.length <= 1} onClick={() => update(ids, (element) => (element.type === "table" ? tableWithSize(element, element.rows.length, element.cols.length - 1) : element), "cols")}><Minus size={14} /></IconButton>
          <b>{single.cols.length}</b>
          <IconButton label={t("Add column")} disabled={!editable || single.cols.length >= 20} onClick={() => update(ids, (element) => (element.type === "table" ? tableWithSize(element, element.rows.length, element.cols.length + 1) : element), "cols")}><Plus size={14} /></IconButton>
        </div>
      </div>
      <label className="slides-check">
        <input type="checkbox" checked={single.header} onChange={(event) => update(ids, (element) => (element.type === "table" ? { ...element, header: event.target.checked } : element), "header")} />
        {t("Header row")}
      </label>
      <NumberField label={t("Size")} value={single.style.size} min={6} max={200} onChange={(size) => update(ids, (element) => (element.type === "table" ? { ...element, style: { ...element.style, size } } : element), "tsize")} />
      <ColorField label={t("Text color")} value={single.style.color} theme={theme} onChange={(color) => update(ids, (element) => (element.type === "table" ? { ...element, style: { ...element.style, color: color ?? "text" } } : element), "tcolor")} />
      <ColorField label={t("Header color")} value={single.style.headerFill} theme={theme} onChange={(headerFill) => update(ids, (element) => (element.type === "table" ? { ...element, style: { ...element.style, headerFill: headerFill ?? "surface" } } : element), "theader")} />
      <ColorField label={t("Border")} value={single.style.border} theme={theme} onChange={(border) => update(ids, (element) => (element.type === "table" ? { ...element, style: { ...element.style, border: border ?? "line" } } : element), "tborder")} />
    </Section>}

    {types.size > 0 && <Section title={t("Opacity")}>
      <input type="range" className="slides-range" min={0.05} max={1} step={0.05} value={single?.opacity ?? 1} aria-label={t("Opacity")}
        onChange={(event) => update(ids, (element) => ({ ...element, opacity: Number(event.target.value) >= 1 ? undefined : Number(event.target.value) }), "opacity")} />
    </Section>}
  </div>;
}

// 版式の小さな見本（置き場所の配置）。
export function LayoutPreview({ layout }: { layout: LayoutId }) {
  const definition = LAYOUTS.find((entry) => entry.id === layout)!;
  return <svg className="slides-layout-preview" viewBox="0 0 192 108" aria-hidden="true">
    <rect x="0.5" y="0.5" width="191" height="107" rx="4" className="slides-layout-preview-bg" />
    {definition.placeholders.map((placeholder, index) => <rect key={index} x={placeholder.x / 10 + 2} y={placeholder.y / 10 + 2} width={Math.max(2, placeholder.w / 10 - 4)} height={Math.max(2, placeholder.h / 10 - 4)} rx="2"
      className={placeholder.role === "image" ? "is-image" : placeholder.role === "title" || placeholder.role === "quote" ? "is-title" : "is-text"} />)}
  </svg>;
}

// 文字を編集している間の書式バー（選んだ文字に効く）：太字・斜体・下線・取り消し線・コード・リンク・箇条書き・揃え・数式。
export function TextFormatBar({ commands, tick, theme }: { commands: TextCommands | null; tick: number; theme: ResolvedTheme }) {
  const t = useT();
  void tick;
  const [linkText, setLinkText] = useState<string | null>(null);
  if (!commands) return null;
  const math = commands.selectedMath();
  const list = commands.list();
  const align = commands.align();
  return <div className="slides-format-bar" role="toolbar" aria-label={t("Text formatting")} onPointerDown={(event) => { if (!(event.target as HTMLElement).closest("input")) event.preventDefault(); }}>
    <IconButton label={t("Bold")} active={commands.active("strong")} onClick={() => commands.toggle("strong")}><Bold size={16} /></IconButton>
    <IconButton label={t("Italic")} active={commands.active("em")} onClick={() => commands.toggle("em")}><Italic size={16} /></IconButton>
    <IconButton label={t("Underline")} active={commands.active("underline")} onClick={() => commands.toggle("underline")}><Underline size={16} /></IconButton>
    <IconButton label={t("Strikethrough")} active={commands.active("strike")} onClick={() => commands.toggle("strike")}><Strikethrough size={16} /></IconButton>
    <IconButton label={t("Code")} active={commands.active("code")} onClick={() => commands.toggle("code")}><Code size={16} /></IconButton>
    <IconButton label={t("Link")} active={commands.active("link")} onClick={() => setLinkText(commands.link() ?? "")}><Link size={16} /></IconButton>
    <span className="slides-button-gap" />
    <IconButton label={t("Bulleted list")} active={list === "bullet"} onClick={() => commands.toggleList("bullet")}><List size={16} className="rtl-mirror" /></IconButton>
    <IconButton label={t("Numbered list")} active={list === "ordered"} onClick={() => commands.toggleList("ordered")}><ListOrdered size={16} className="rtl-mirror" /></IconButton>
    <IconButton label={t("Code block")} onClick={() => commands.toggleCodeBlock()}><Code size={16} strokeWidth={2.6} /></IconButton>
    <span className="slides-button-gap" />
    <IconButton label={t("Align left")} active={align === "left"} onClick={() => commands.setAlign("left")}><AlignLeft size={16} className="rtl-mirror" /></IconButton>
    <IconButton label={t("Align center")} active={align === "center"} onClick={() => commands.setAlign("center")}><AlignCenter size={16} /></IconButton>
    <IconButton label={t("Align right")} active={align === "right"} onClick={() => commands.setAlign("right")}><AlignRight size={16} className="rtl-mirror" /></IconButton>
    <span className="slides-button-gap" />
    <IconButton label={t("Inline equation")} onClick={() => commands.insertMath(false)}><Sigma size={16} /></IconButton>
    <IconButton label={t("Block equation")} onClick={() => commands.insertMath(true)}><SquareFunction size={16} /></IconButton>
    <MenuButton label={t("Text color")} className="slides-icon-button" icon={<span className="slides-color-chip is-text" style={{ background: theme.palette.accent }} />}>
      {(close) => <ColorPicker value={null} theme={theme} allowNone onChange={(color) => { commands.setColor(color); close(); }} />}
    </MenuButton>
    <MenuButton label={t("Font size")} className="slides-icon-button" text={<span className="slides-size-label">Aa</span>}>
      {(close) => <div className="slides-size-list">
        {[24, 32, 40, 48, 64, 80, 96, 120, 160].map((size) => <button key={size} type="button" role="menuitem" className="chat-menu-item" onClick={() => { commands.setSize(size); close(); }}>{size}</button>)}
        <button type="button" role="menuitem" className="chat-menu-item" onClick={() => { commands.setSize(null); close(); }}>{t("Default size")}</button>
      </div>}
    </MenuButton>
    {math && <label className="slides-math-input">
      <span>{math.display ? t("Block equation") : t("Inline equation")}</span>
      <input type="text" dir="ltr" value={math.latex} spellCheck={false} aria-label={t("TeX source")} onChange={(event) => commands.updateMath(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === "Escape") { event.preventDefault(); commands.focus(); } }} />
    </label>}
    {linkText !== null && <form className="slides-link-input" onSubmit={(event) => { event.preventDefault(); commands.setLink(linkText.trim() || null); setLinkText(null); }}>
      <input type="url" autoFocus value={linkText} placeholder="https://" aria-label={t("Link address")} onChange={(event) => setLinkText(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setLinkText(null); commands.focus(); } }} />
      <button type="submit" className="notion-button">{t("Apply")}</button>
      {commands.active("link") && <button type="button" className="notion-button" onClick={() => { commands.setLink(null); setLinkText(null); }}>{t("Remove link")}</button>}
    </form>}
  </div>;
}
