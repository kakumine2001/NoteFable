"use client";

import { ImageIcon, PenTool } from "lucide-react";
import { createContext, Fragment, memo, useContext, useMemo, type CSSProperties, type ReactNode } from "react";
import { useT } from "@/components/i18n-provider";
import { SLIDE_FONT_CLASSES } from "@/components/slides/slide-fonts";
import { slideMathHtml, useSlideKatex } from "@/components/slides/slide-math";
import { ROLE_HINTS } from "@/lib/slides/layouts";
import {
  SLIDE_HEIGHT, SLIDE_WIDTH, type ImageElement, type LineElement, type ShapeElement, type Slide, type SlideElement, type TableElement, type TextElement, type TextStyle,
  type WhiteboardElement,
} from "@/lib/slides/model";
import { isRichDocEmpty, mathKey, safeHref, type RichBlock, type RichDoc, type RichInline, type RichMark } from "@/lib/slides/rich-text";
import { shapePath } from "@/lib/slides/shapes";
import { resolveColor, type ResolvedTheme } from "@/lib/slides/themes";

// 1 枚のスライドを描く（編集画面の縮小図・放映・書き出し・公開ページで共通）。編集の操作は slide-stage.tsx が上に重ねる。
// 座標はすべて 1920 × 1080 の論理ピクセルで、外側で縮める。

// 文字枠の内側の余白（PPTX の既定の余白 0.1 / 0.05 インチと同じ。書き出しても文字の位置が変わらないように）。
export const TEXT_INSET = { x: 14.4, y: 7.2 };

export type SlideRenderOptions = {
  theme: ResolvedTheme;
  // edit: 空の置き場所に案内を出す。view: 放映・書き出し・公開（空の置き場所は出さない）。
  mode: "edit" | "view";
  // 画像の URL を書き換える（公開ページは /s/:token/file を通す）。
  imageSrc?: (src: string) => string;
  // サーバーが先に描いた数式（mathKey → HTML）。無ければブラウザで KaTeX を読み込む。
  mathHtml?: Record<string, string>;
};
const SlideRenderContext = createContext<SlideRenderOptions | null>(null);
export const SlideRenderProvider = SlideRenderContext.Provider;
export function useSlideRender(): SlideRenderOptions {
  const value = useContext(SlideRenderContext);
  if (!value) throw new Error("SlideRenderProvider is missing");
  return value;
}

// ---- 書式つき文字 ----

function docHasMath(doc: RichDoc): boolean {
  const walk = (blocks: RichBlock[]): boolean => blocks.some((block) =>
    block.type === "math_block" || (block.type === "paragraph" && (block.content ?? []).some((node) => node.type === "math_inline"))
    || ((block.type === "bullet_list" || block.type === "ordered_list") && block.content.some((item) => walk(item.content))));
  return walk(doc.content);
}

function MathView({ latex, display }: { latex: string; display: boolean }) {
  const { mathHtml } = useSlideRender();
  const preset = mathHtml?.[mathKey(latex, display)];
  const api = useSlideKatex(preset === undefined && !!latex.trim());
  const html = preset ?? slideMathHtml(api, latex, display);
  const Tag = display ? "div" : "span";
  if (!latex.trim()) return <Tag className={display ? "slide-math-block is-empty" : "slide-math-inline is-empty"} dir="ltr">{display ? " " : ""}</Tag>;
  return html
    ? <Tag className={display ? "slide-math-block" : "slide-math-inline"} dir="ltr" dangerouslySetInnerHTML={{ __html: html }} />
    : <Tag className={display ? "slide-math-block" : "slide-math-inline"} dir="ltr">{latex}</Tag>;
}

function markStyle(marks: RichMark[] | undefined, theme: ResolvedTheme): CSSProperties | undefined {
  let style: CSSProperties | undefined;
  for (const mark of marks ?? []) {
    if (mark.type === "color") style = { ...style, color: resolveColor(mark.attrs.color, theme) };
    if (mark.type === "size") style = { ...style, fontSize: `${mark.attrs.size}px` };
  }
  return style;
}

function InlineView({ nodes, theme, link }: { nodes: RichInline[] | undefined; theme: ResolvedTheme; link: boolean }) {
  return <>{(nodes ?? []).map((node, index) => {
    if (node.type === "hard_break") return <br key={index} />;
    if (node.type === "math_inline") return <MathView key={index} latex={node.attrs.latex} display={false} />;
    let content: ReactNode = node.text;
    const marks = node.marks ?? [];
    const style = markStyle(marks, theme);
    if (style) content = <span style={style}>{content}</span>;
    for (const mark of marks) {
      if (mark.type === "strong") content = <strong>{content}</strong>;
      else if (mark.type === "em") content = <em>{content}</em>;
      else if (mark.type === "underline") content = <u>{content}</u>;
      else if (mark.type === "strike") content = <s>{content}</s>;
      else if (mark.type === "code") content = <code className="slide-code">{content}</code>;
      else if (mark.type === "link") {
        const href = safeHref(mark.attrs.href);
        // 編集中は押しても開かない（文字を選ぶ操作と重ならないように）。放映・公開では新しいタブで開く。
        if (href) content = link ? <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="slide-link">{content}</a> : <span className="slide-link">{content}</span>;
      }
    }
    return <Fragment key={index}>{content}</Fragment>;
  })}</>;
}

function BlocksView({ blocks, theme, link }: { blocks: RichBlock[]; theme: ResolvedTheme; link: boolean }) {
  return <>{blocks.map((block, index) => {
    if (block.type === "paragraph") {
      const align = block.attrs?.align ?? undefined;
      return <p key={index} style={align ? { textAlign: align as CSSProperties["textAlign"] } : undefined}>
        {block.content?.length ? <InlineView nodes={block.content} theme={theme} link={link} /> : <br />}
      </p>;
    }
    if (block.type === "math_block") return <MathView key={index} latex={block.attrs.latex} display />;
    if (block.type === "code_block") return <pre key={index} className="slide-code-block" dir="ltr" data-language={block.attrs?.language || undefined}>
      {block.attrs?.language && <span className="slide-code-lang" aria-hidden="true">{block.attrs.language}</span>}
      <code>{block.content?.[0]?.text ?? ""}</code>
    </pre>;
    const items = block.content.map((item, itemIndex) => <li key={itemIndex}><BlocksView blocks={item.content} theme={theme} link={link} /></li>);
    return block.type === "bullet_list"
      ? <ul key={index}>{items}</ul>
      : <ol key={index} start={block.attrs?.order ?? 1}>{items}</ol>;
  })}</>;
}

export function RichTextView({ doc, link = false }: { doc: RichDoc; link?: boolean }) {
  const { theme } = useSlideRender();
  return <BlocksView blocks={doc.content} theme={theme} link={link} />;
}

// 文字の箱の書式（文字枠と、図形の中の文字で共通）。
export function textStyleCss(style: TextStyle, theme: ResolvedTheme): CSSProperties {
  return {
    fontFamily: theme.fonts[style.font].css,
    fontSize: `${style.size}px`,
    color: resolveColor(style.color, theme),
    textAlign: style.align,
    lineHeight: style.lineHeight,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? "italic" : "normal",
    justifyContent: style.valign === "top" ? "flex-start" : style.valign === "middle" ? "center" : "flex-end",
    padding: `${TEXT_INSET.y}px ${TEXT_INSET.x}px`,
  };
}

// ---- 要素 ----

function TextContent({ element, link, hint }: { element: TextElement; link: boolean; hint: string | null }) {
  const { theme } = useSlideRender();
  const empty = isRichDocEmpty(element.doc) && !docHasMath(element.doc);
  return <div className="slide-text" style={{ ...textStyleCss(element.style, theme), background: element.fill ? resolveColor(element.fill, theme) : undefined }}>
    {empty && hint ? <p className="slide-placeholder-hint">{hint}</p> : <RichTextView doc={element.doc} link={link} />}
  </div>;
}

const DASH: Record<string, string | undefined> = { solid: undefined, dash: "4 2", dot: "1 1.6" };

function ShapeContent({ element, link }: { element: ShapeElement; link: boolean }) {
  const { theme } = useSlideRender();
  const fill = element.fill ? resolveColor(element.fill, theme) : "none";
  const stroke = element.stroke && element.strokeWidth > 0 ? resolveColor(element.stroke, theme) : "none";
  const dash = DASH[element.dash]?.split(" ").map((value) => Number(value) * Math.max(1, element.strokeWidth)).join(" ");
  return <>
    <svg className="slide-shape" width={element.w} height={element.h} viewBox={`0 0 ${Math.max(element.w, 0.01)} ${Math.max(element.h, 0.01)}`} overflow="visible" aria-hidden="true">
      <path d={shapePath(element.shape, element.w, element.h)} fill={fill} stroke={stroke} strokeWidth={element.strokeWidth} strokeDasharray={dash} strokeLinejoin="round" />
    </svg>
    {!isRichDocEmpty(element.doc) && <div className="slide-text" style={textStyleCss(element.style, theme)}><RichTextView doc={element.doc} link={link} /></div>}
  </>;
}

function LineContent({ element }: { element: LineElement }) {
  const { theme } = useSlideRender();
  const color = resolveColor(element.stroke, theme);
  const x1 = element.flipH ? element.w : 0;
  const x2 = element.flipH ? 0 : element.w;
  const y1 = element.flipV ? element.h : 0;
  const y2 = element.flipV ? 0 : element.h;
  const dash = DASH[element.dash]?.split(" ").map((value) => Number(value) * element.strokeWidth).join(" ");
  const id = `line-${element.id}`;
  const marker = (cap: LineElement["start"], side: "start" | "end") => {
    if (cap === "none") return null;
    const shape = cap === "oval" ? <circle cx="5" cy="5" r="3.5" fill={color} />
      : cap === "triangle" ? <path d="M0,0 L10,5 L0,10 Z" fill={color} />
      : <path d="M0,0 L10,5 L0,10" fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />;
    return <marker id={`${id}-${side}`} viewBox="0 0 10 10" refX={cap === "oval" ? 5 : 9} refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse" markerUnits="strokeWidth">{shape}</marker>;
  };
  return <svg className="slide-line" width={Math.max(element.w, 1)} height={Math.max(element.h, 1)} overflow="visible" aria-hidden="true">
    <defs>{marker(element.start, "start")}{marker(element.end, "end")}</defs>
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={element.strokeWidth} strokeDasharray={dash} strokeLinecap={element.dash === "dot" ? "round" : "butt"}
      markerStart={element.start !== "none" ? `url(#${id}-start)` : undefined} markerEnd={element.end !== "none" ? `url(#${id}-end)` : undefined} />
  </svg>;
}

function ImageContent({ element, edit }: { element: ImageElement | WhiteboardElement; edit: boolean }) {
  const t = useT();
  const { imageSrc } = useSlideRender();
  if (!element.src) {
    if (!edit) return null;
    return <div className="slide-image-empty">
      {element.type === "whiteboard" ? <PenTool size={64} strokeWidth={1.4} aria-hidden="true" /> : <ImageIcon size={64} strokeWidth={1.4} aria-hidden="true" />}
      <span>{t(ROLE_HINTS.image)}</span>
    </div>;
  }
  const fit = element.type === "image" ? element.fit : "contain";
  const radius = element.type === "image" ? element.radius : 0;
  // eslint-disable-next-line @next/next/no-img-element -- 自分の note-files（公開ページは /s/:token/file）を所有者の確認つきで読む。
  return <img className="slide-image" src={imageSrc ? imageSrc(element.src) : element.src} alt={element.type === "image" ? element.alt : element.frameName}
    draggable={false} style={{ objectFit: fit, borderRadius: radius ? `${radius}px` : undefined }} />;
}

function TableContent({ element }: { element: TableElement }) {
  const { theme } = useSlideRender();
  const total = element.cols.reduce((sum, col) => sum + col, 0) || 1;
  const border = resolveColor(element.style.border, theme);
  return <table className="slide-table" style={{
    fontFamily: theme.fonts[element.style.font].css, fontSize: `${element.style.size}px`, color: resolveColor(element.style.color, theme), borderColor: border,
  }}>
    <colgroup>{element.cols.map((col, index) => <col key={index} style={{ width: `${(col / total) * 100}%` }} />)}</colgroup>
    <tbody>{element.rows.map((row, rowIndex) => <tr key={rowIndex} style={{ height: `${100 / element.rows.length}%` }}>
      {row.cells.map((cell, cellIndex) => {
        const header = element.header && rowIndex === 0;
        const Cell = header ? "th" : "td";
        return <Cell key={cellIndex} style={{ borderColor: border, background: header ? resolveColor(element.style.headerFill, theme) : undefined }}>{cell.text}</Cell>;
      })}
    </tr>)}</tbody>
  </table>;
}

export function ElementContent({ element, link = false }: { element: SlideElement; link?: boolean }) {
  const t = useT();
  const { mode } = useSlideRender();
  const edit = mode === "edit";
  switch (element.type) {
    case "text": return <TextContent element={element} link={link} hint={edit && element.role ? t(ROLE_HINTS[element.role]) : null} />;
    case "shape": return <ShapeContent element={element} link={link} />;
    case "line": return <LineContent element={element} />;
    case "image": case "whiteboard": return <ImageContent element={element} edit={edit} />;
    case "table": return <TableContent element={element} />;
  }
}

// 要素の位置・大きさ・回転を持つ箱。
export function elementBoxStyle(element: SlideElement): CSSProperties {
  return {
    left: element.x, top: element.y, width: element.w, height: element.h,
    transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
    opacity: element.opacity ?? undefined,
  };
}

// 放映・書き出しで出さない要素（空の置き場所）。
export function isHiddenInView(element: SlideElement) {
  if (!element.role) return false;
  if (element.type === "text") return isRichDocEmpty(element.doc) && !docHasMath(element.doc) && !element.fill;
  if (element.type === "image" || element.type === "whiteboard") return !element.src;
  return false;
}

// 1920 × 1080 の 1 枚。children は編集の操作など、上に重ねるもの。skip は描かない要素（文字を編集中の要素）。
export const SlideSurface = memo(function SlideSurface({ slide, skip, children, link = false }: { slide: Slide; skip?: string | null; children?: ReactNode; link?: boolean }) {
  const { theme, mode } = useSlideRender();
  const background = resolveColor(slide.background ?? "background", theme, "background");
  // 主題の色を CSS 変数にも置く（編集中の文字の色の書式が var(--slide-color-<名前>) で参照する）。
  const variables = Object.fromEntries(Object.entries(theme.palette).map(([token, value]) => [`--slide-color-${token}`, value]));
  return <div className={`slide-surface ${SLIDE_FONT_CLASSES}`} style={{ ...variables, width: SLIDE_WIDTH, height: SLIDE_HEIGHT, background, color: theme.palette.text, fontFamily: theme.fonts.body.css }}
    data-theme-mode={theme.mode}>
    {slide.elements.map((element) => element.id === skip || (mode === "view" && isHiddenInView(element)) ? null
      : <div key={element.id} className={`slide-element slide-element-${element.type}`} style={elementBoxStyle(element)} data-element-id={element.id}>
        <ElementContent element={element} link={link} />
      </div>)}
    {children}
  </div>;
});

// 幅 width の枠に縮めて描く（縮小図・放映・公開）。
export function SlideFrame({ slide, width, className = "", children, link = false }: { slide: Slide; width: number; className?: string; children?: ReactNode; link?: boolean }) {
  const scale = width / SLIDE_WIDTH;
  return <div className={`slide-frame ${className}`} style={{ width, height: width * (SLIDE_HEIGHT / SLIDE_WIDTH) }}>
    <div className="slide-frame-inner" style={{ transform: `scale(${scale})` }}>
      <SlideSurface slide={slide} link={link}>{children}</SlideSurface>
    </div>
  </div>;
}

// 主題を解いて渡す。
export function SlideRenderRoot({ theme, mode, imageSrc, mathHtml, children }: SlideRenderOptions & { children: ReactNode }) {
  const value = useMemo(() => ({ theme, mode, imageSrc, mathHtml }), [theme, mode, imageSrc, mathHtml]);
  return <SlideRenderProvider value={value}>{children}</SlideRenderProvider>;
}
