import type PptxGenJS from "pptxgenjs";
import { saveExportFile, type SaveExportResult } from "@/lib/export-file";
import { SLIDE_HEIGHT, SLIDE_WIDTH, type Deck, type ImageElement, type Slide, type SlideElement, type TextStyle, type WhiteboardElement } from "@/lib/slides/model";
import { isRichDocEmpty, safeHref, type RichBlock, type RichDoc, type RichInline } from "@/lib/slides/rich-text";
import { PPTX_SHAPES } from "@/lib/slides/shapes";
import { resolveColor, resolveTheme, type ResolvedTheme } from "@/lib/slides/themes";
import type { NotesPageInput } from "@/components/slides/slide-capture";

// スライドの書き出し（ブラウザの中で作る）。重いライブラリ（modern-screenshot・jsPDF・JSZip・PptxGenJS）は書き出すときだけ読み込む。
//   PNG: 1 枚ずつの画像（2 枚以上なら ZIP）。PDF: 1 枚 1 ページ（ノートつきは A4 縦に画像とノート）。どちらも放映と同じく隠した枚は入れない。
//   PPTX: 文字・図形・線・表は PowerPoint / Google スライドで編集できる形。画像は枠に合わせて切った画像。隠した枚は「非表示」として入れる。
//   数式は PPTX では TeX の文字（$…$）として入れる（PowerPoint の数式には変換しない）。

export type ExportFormat = "pdf" | "pdf-notes" | "png" | "pptx";

// 保存先に使えない文字を除いたファイル名（拡張子は別に付ける）。
export function exportFileBase(title: string, fallback = "slides") {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return base && base !== "Untitled" ? base : fallback;
}
export type SlideCapture = {
  renderSlide: (slide: Slide) => Promise<HTMLElement>;
  renderNotesPage: (input: NotesPageInput) => Promise<HTMLElement>;
  done: () => void;
};

const SCALE = 1;

async function slideCanvas(capture: SlideCapture, slide: Slide, background: string, scale = SCALE) {
  const { domToCanvas } = await import("modern-screenshot");
  const node = await capture.renderSlide(slide);
  return domToCanvas(node, { width: SLIDE_WIDTH, height: SLIDE_HEIGHT, scale, backgroundColor: background });
}

function canvasBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("canvas"))), type, quality));
}

const pad = (value: number, count: number) => String(value).padStart(String(count).length < 2 ? 2 : String(count).length, "0");
const hasPhoto = (slide: Slide) => slide.elements.some((element) => (element.type === "image" || element.type === "whiteboard") && element.src);

async function exportPng(deck: Deck, theme: ResolvedTheme, base: string, capture: SlideCapture) {
  const slides = deck.slides.filter((slide) => !slide.hidden);
  const blobs: Blob[] = [];
  for (const slide of slides) blobs.push(await canvasBlob(await slideCanvas(capture, slide, resolveColor(slide.background ?? "background", theme, "background"), 1)));
  if (blobs.length === 1) return saveExportFile(blobs[0], `${base}.png`);
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  blobs.forEach((blob, index) => zip.file(`${base}-${pad(index + 1, blobs.length)}.png`, blob));
  return saveExportFile(await zip.generateAsync({ type: "blob", mimeType: "application/zip" }), `${base}.zip`);
}

async function exportPdf(deck: Deck, theme: ResolvedTheme, base: string, title: string, capture: SlideCapture, notes: boolean) {
  const { jsPDF } = await import("jspdf");
  const slides = deck.slides.filter((slide) => !slide.hidden);
  // 16:9 のページ（13.333 × 7.5 インチ）、ノートつきは A4 縦。
  const pdf = notes ? new jsPDF({ orientation: "portrait", unit: "pt", format: "a4", compress: true }) : new jsPDF({ orientation: "landscape", unit: "pt", format: [960, 540], compress: true });
  pdf.setProperties({ title });
  for (const [index, slide] of slides.entries()) {
    const canvas = await slideCanvas(capture, slide, resolveColor(slide.background ?? "background", theme, "background"), notes ? 1 : 1.25);
    // 写真があれば JPEG（小さい）、文字と図形だけなら PNG（文字がにじまない）。
    const photo = hasPhoto(slide);
    const image = photo ? canvas.toDataURL("image/jpeg", 0.9) : canvas.toDataURL("image/png");
    if (index) pdf.addPage();
    if (!notes) { pdf.addImage(image, photo ? "JPEG" : "PNG", 0, 0, 960, 540, undefined, "FAST"); continue; }
    const page = await capture.renderNotesPage({ image, number: deck.slides.indexOf(slide) + 1, count: deck.slides.length, title, notes: slide.notes ?? "" });
    const { domToCanvas } = await import("modern-screenshot");
    const pageCanvas = await domToCanvas(page, { width: 1240, height: 1754, scale: 1, backgroundColor: "#ffffff" });
    pdf.addImage(pageCanvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight(), undefined, "FAST");
  }
  return saveExportFile(pdf.output("blob"), `${base}.pdf`);
}

// ---- PPTX ----

const inch = (px: number) => px / 144;
const pt = (px: number) => px / 2;
const DASH: Record<string, "solid" | "dash" | "sysDot"> = { solid: "solid", dash: "dash", dot: "sysDot" };
const ARROW: Record<string, "none" | "arrow" | "triangle" | "oval"> = { none: "none", arrow: "arrow", triangle: "triangle", oval: "oval" };

type Run = PptxGenJS.TextProps;
type RunOptions = NonNullable<Run["options"]>;

function textRuns(doc: RichDoc, style: TextStyle, theme: ResolvedTheme): Run[] {
  const hex = (ref: string | null | undefined) => resolveColor(ref, theme).slice(1).toUpperCase();
  const base: RunOptions = {
    fontFace: theme.fonts[style.font].pptx, fontSize: pt(style.size), color: hex(style.color), bold: style.bold, italic: style.italic,
    align: style.align, lineSpacingMultiple: style.lineHeight,
  };
  const runs: Run[] = [];
  const endParagraph = () => {
    const last = runs[runs.length - 1];
    if (last) last.options = { ...last.options, breakLine: true };
  };
  const inline = (nodes: RichInline[] | undefined, paragraph: RunOptions) => {
    const content = nodes ?? [];
    if (!content.length) { runs.push({ text: "", options: { ...base, ...paragraph } }); return; }
    let softBreak = false;
    for (const node of content) {
      if (node.type === "hard_break") { softBreak = true; continue; }
      const options: RunOptions = { ...base, ...paragraph, ...(softBreak ? { softBreakBefore: true } : {}) };
      softBreak = false;
      if (node.type === "math_inline") { runs.push({ text: `$${node.attrs.latex}$`, options: { ...options, fontFace: theme.fonts.mono.pptx } }); continue; }
      for (const mark of node.marks ?? []) {
        if (mark.type === "strong") options.bold = true;
        if (mark.type === "em") options.italic = true;
        if (mark.type === "underline") options.underline = { style: "sng" };
        if (mark.type === "strike") options.strike = "sngStrike";
        if (mark.type === "code") options.fontFace = theme.fonts.mono.pptx;
        if (mark.type === "color") options.color = hex(mark.attrs.color);
        if (mark.type === "size") options.fontSize = pt(mark.attrs.size);
        if (mark.type === "link") { const href = safeHref(mark.attrs.href); if (href) options.hyperlink = { url: href }; }
      }
      runs.push({ text: node.text, options });
    }
  };
  const blocks = (list: RichBlock[], level: number, bullet: RunOptions["bullet"] | undefined) => {
    for (const block of list) {
      if (block.type === "paragraph") {
        const paragraph: RunOptions = { ...(block.attrs?.align ? { align: block.attrs.align as RunOptions["align"] } : {}), ...(bullet ? { bullet, indentLevel: level } : {}) };
        inline(block.content, paragraph);
        endParagraph();
      } else if (block.type === "code_block") {
        for (const line of (block.content?.[0]?.text ?? "").split("\n")) { runs.push({ text: line, options: { ...base, fontFace: theme.fonts.mono.pptx, align: "left" } }); endParagraph(); }
      } else if (block.type === "math_block") {
        runs.push({ text: `$$${block.attrs.latex}$$`, options: { ...base, fontFace: theme.fonts.mono.pptx, align: "center" } });
        endParagraph();
      } else {
        block.content.forEach((item, index) => {
          const marker: RunOptions["bullet"] = block.type === "bullet_list" ? true : { type: "number", ...(index === 0 && (block.attrs?.order ?? 1) !== 1 ? { numberStartAt: block.attrs?.order } : {}) };
          blocks(item.content, block.type === "bullet_list" || block.type === "ordered_list" ? level + (bullet ? 1 : 0) : level, marker);
        });
      }
    }
  };
  blocks(doc.content, 0, undefined);
  const last = runs[runs.length - 1];
  if (last?.options?.breakLine) last.options = { ...last.options, breakLine: false };
  return runs.length ? runs : [{ text: "", options: base }];
}

function textBox(style: TextStyle) {
  return { valign: style.valign, margin: [3.6, 7.2, 3.6, 7.2] as [number, number, number, number], isTextBox: true, fit: "none" as const };
}

// 画像を枠に合わせる：cover は枠の縦横比で切り取り、contain は枠の中に収まる位置と大きさにする（PowerPoint でも同じ見た目になるように）。
async function placedImage(element: ImageElement | WhiteboardElement): Promise<{ data: string; x: number; y: number; w: number; h: number } | null> {
  try {
    const response = await fetch(element.src, { credentials: "same-origin" });
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
    const fit = element.type === "image" ? element.fit : "contain";
    const boxRatio = element.w / Math.max(element.h, 1);
    const imageRatio = bitmap.width / Math.max(bitmap.height, 1);
    const canvas = document.createElement("canvas");
    let place = { x: element.x, y: element.y, w: element.w, h: element.h };
    if (fit === "cover") {
      const sw = imageRatio > boxRatio ? bitmap.height * boxRatio : bitmap.width;
      const sh = imageRatio > boxRatio ? bitmap.height : bitmap.width / boxRatio;
      canvas.width = Math.round(Math.min(sw, 2400));
      canvas.height = Math.round(canvas.width / boxRatio);
      canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
    } else {
      const w = imageRatio > boxRatio ? element.w : element.h * imageRatio;
      const h = imageRatio > boxRatio ? element.w / imageRatio : element.h;
      place = { x: element.x + (element.w - w) / 2, y: element.y + (element.h - h) / 2, w, h };
      canvas.width = Math.min(bitmap.width, 2400);
      canvas.height = Math.round(canvas.width / imageRatio);
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    }
    bitmap.close();
    return { data: canvas.toDataURL("image/png"), ...place };
  } catch {
    return null;
  }
}

function elementVisible(element: SlideElement) {
  if (element.type === "text") return !(element.role && isRichDocEmpty(element.doc) && !element.fill && !JSON.stringify(element.doc).includes("math_"));
  if (element.type === "image" || element.type === "whiteboard") return !!element.src;
  return true;
}

async function addElement(pptx: PptxGenJS, target: PptxGenJS.Slide, element: SlideElement, theme: ResolvedTheme) {
  const hex = (ref: string | null | undefined) => resolveColor(ref, theme).slice(1).toUpperCase();
  const frame = { x: inch(element.x), y: inch(element.y), w: inch(Math.max(element.w, 1)), h: inch(Math.max(element.h, 1)), ...(element.rotation ? { rotate: element.rotation } : {}) };
  const transparency = element.opacity !== undefined ? Math.round((1 - element.opacity) * 100) : undefined;
  switch (element.type) {
    case "text":
      target.addText(textRuns(element.doc, element.style, theme), { ...frame, ...textBox(element.style), ...(element.fill ? { fill: { color: hex(element.fill), transparency } } : {}) });
      return;
    case "shape": {
      const options: PptxGenJS.ShapeProps = {
        ...frame,
        fill: element.fill ? { color: hex(element.fill), transparency } : { type: "none" },
        line: element.stroke && element.strokeWidth > 0 ? { color: hex(element.stroke), width: pt(element.strokeWidth), dashType: DASH[element.dash] } : { type: "none" },
      };
      const shape = PPTX_SHAPES[element.shape] as PptxGenJS.ShapeType;
      if (isRichDocEmpty(element.doc)) target.addShape(shape, options);
      else target.addText(textRuns(element.doc, element.style, theme), { ...options, ...textBox(element.style), shape } as PptxGenJS.TextPropsOptions);
      return;
    }
    case "line":
      target.addShape(pptx.ShapeType.line, {
        x: inch(element.x), y: inch(element.y), w: inch(element.w), h: inch(element.h), flipH: element.flipH, flipV: element.flipV,
        line: { color: hex(element.stroke), width: pt(element.strokeWidth), dashType: DASH[element.dash], beginArrowType: ARROW[element.start], endArrowType: ARROW[element.end], transparency },
      });
      return;
    case "image": case "whiteboard": {
      const placed = await placedImage(element);
      if (!placed) return;
      target.addImage({ data: placed.data, x: inch(placed.x), y: inch(placed.y), w: inch(placed.w), h: inch(placed.h), ...(element.rotation ? { rotate: element.rotation } : {}),
        altText: element.type === "image" ? element.alt : element.frameName, ...(transparency ? { transparency } : {}) });
      return;
    }
    case "table": {
      const total = element.cols.reduce((sum, col) => sum + col, 0) || 1;
      const rows: PptxGenJS.TableRow[] = element.rows.map((row, rowIndex) => row.cells.map((cell) => ({
        text: cell.text,
        options: element.header && rowIndex === 0 ? { bold: true, fill: { color: hex(element.style.headerFill) } } : {},
      })));
      target.addTable(rows, {
        x: frame.x, y: frame.y, w: frame.w, colW: element.cols.map((col) => (frame.w * col) / total), rowH: frame.h / element.rows.length,
        fontFace: theme.fonts[element.style.font].pptx, fontSize: pt(element.style.size), color: hex(element.style.color),
        border: { type: "solid", pt: 0.75, color: hex(element.style.border) }, valign: "middle", margin: 4,
      });
      return;
    }
  }
}

async function exportPptx(deck: Deck, theme: ResolvedTheme, base: string, title: string) {
  const PptxGenJSClass = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJSClass();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = title;
  pptx.theme = { headFontFace: theme.fonts.heading.pptx, bodyFontFace: theme.fonts.body.pptx };
  for (const slide of deck.slides) {
    const target = pptx.addSlide();
    target.background = { color: resolveColor(slide.background ?? "background", theme, "background").slice(1).toUpperCase() };
    if (slide.hidden) target.hidden = true;
    for (const element of slide.elements) if (elementVisible(element)) await addElement(pptx, target, element, theme);
    if (slide.notes?.trim()) target.addNotes(slide.notes);
  }
  const blob = await pptx.write({ outputType: "blob", compression: true }) as Blob;
  return saveExportFile(new Blob([blob], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }), `${base}.pptx`);
}

// 結果は saveExportFile と同じ（download・app・unsupported：ファイルを受け取れない古いアプリ・failed：アプリへ送る途中で失敗）。
export async function exportDeckFiles(deck: Deck, title: string, format: ExportFormat, capture: SlideCapture): Promise<SaveExportResult> {
  const theme = resolveTheme(deck.theme);
  const base = exportFileBase(title);
  const name = title.trim() && title !== "Untitled" ? title : base;
  try {
    if (format === "png") return await exportPng(deck, theme, base, capture);
    if (format === "pptx") return await exportPptx(deck, theme, base, name);
    return await exportPdf(deck, theme, base, name, capture, format === "pdf-notes");
  } finally {
    capture.done();
  }
}
