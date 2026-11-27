import { MAX_SLIDE_ELEMENTS, MAX_SLIDE_NOTES } from "@/lib/canvas-document";
import {
  DECK_FORMAT,
  newId,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  type Dash,
  type ImageElement,
  type LineCap,
  type LineElement,
  type Role,
  type ShapeElement,
  type ShapeKind,
  type Slide,
  type SlideElement,
  type SlideTransition,
  type TableElement,
  type TextElement,
  type TextStyle,
  type VAlign,
} from "@/lib/slides/model";
import { isRichDocEmpty, normalizeRichDoc, richDocFromText, richDocText, type RichBlock, type RichDoc, type RichInline, type RichListItem, type RichMark, type RichParagraph } from "@/lib/slides/rich-text";
import { hexLuminance, resolveColorFromParent, type ColorContext, type ResolvedColor } from "@/lib/slides/pptx/colors";
import { probePptxImage } from "@/lib/slides/pptx/image-probe";
import {
  applyColorMapOverride,
  DEFAULT_COLOR_MAP,
  DEFAULT_COLOR_SCHEME,
  extractRelId,
  findLayoutRel,
  findRelByTypeSuffix,
  findThemeRel,
  fontRoleFor,
  isMonospaceFont,
  loadLayout,
  loadMaster,
  mapAlign,
  matchDeckTheme,
  matchPlaceholder,
  mergeTextLevelStyles,
  parseBulletSpec,
  parseLineSpacing,
  parseRunProps,
  parseSections,
  parseTextStyleLevels,
  parseThemeDoc,
  pickLevelStyle,
  readPlaceholderInfo,
  type FontScheme,
  type ParsedLayout,
  type ParsedMaster,
  type ParsedTheme,
  type PlaceholderEntry,
  type TextLevelStyle,
  type TextStyleLevels,
} from "@/lib/slides/pptx/theme-master";
import {
  MAX_PPTX_MEDIA_ENTRY_BYTES,
  MAX_PPTX_SLIDES,
  PPTX_ASSET_PREFIX,
  PPTX_ERROR_MESSAGES,
  PptxImportError,
  type ImageCropRect,
  type ParsedPptx,
  type PendingPptxImage,
  type PptxSlideIssue,
  type PptxSlideReport,
  type PptxUnsupportedKind,
  type XmlParserLike,
} from "@/lib/slides/pptx/types";
import {
  attr,
  attrLocal,
  boolAttr,
  childElements,
  findChild,
  findChildren,
  findDescendant,
  localName,
  numAttr,
  PptxEntryTooLargeError,
  SafePptxZip,
  type RelEntry,
} from "@/lib/slides/pptx/zip-reader";

// PPTX 全体の変換（ブラウザ側で JSZip + DOMParser だけで完結する）。
// 母版・版式・主題色・グループ変形・プレースホルダー継承を解決し、NoteFable の Deck（1920 × 1080）と
// ページごとの非対応項目レポートを作る。

const DEFAULT_SLIDE_CX = 12_192_000; // 13.333 in（16:9 ワイド）
const DEFAULT_SLIDE_CY = 6_858_000; // 7.5 in
const EMU_PER_PT = 12_700;

// ---- 2D アフィン変換（グループ入れ子・回転・反転をまとめて計算） ----
type Mat2D = [number, number, number, number, number, number]; // [a, b, c, d, tx, ty]
const MAT_ID: Mat2D = [1, 0, 0, 1, 0, 0];

function mulMat(m1: Mat2D, m2: Mat2D): Mat2D {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function applyMat(m: Mat2D, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function translateMat(tx: number, ty: number): Mat2D {
  return [1, 0, 0, 1, tx, ty];
}

function scaleMat(sx: number, sy: number): Mat2D {
  return [sx, 0, 0, sy, 0, 0];
}

function rotateMat(rad: number): Mat2D {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, s, -s, c, 0, 0];
}

type Xfrm = {
  x: number;
  y: number;
  w: number;
  h: number;
  rotDeg: number;
  flipH: boolean;
  flipV: boolean;
  chX?: number;
  chY?: number;
  chW?: number;
  chH?: number;
};

function parseXfrm(xfrmEl: Element | null | undefined): Xfrm | null {
  if (!xfrmEl) return null;
  const off = findChild(xfrmEl, "off");
  const ext = findChild(xfrmEl, "ext");
  if (!off || !ext) return null;
  const x = numAttr(off, "x");
  const y = numAttr(off, "y");
  const w = numAttr(ext, "cx");
  const h = numAttr(ext, "cy");
  if (x === null || y === null || w === null || h === null) return null;
  const rotRaw = numAttr(xfrmEl, "rot") ?? 0;
  const rotDeg = rotRaw / 60_000;
  const flipH = boolAttr(xfrmEl, "flipH") === true;
  const flipV = boolAttr(xfrmEl, "flipV") === true;
  const chOff = findChild(xfrmEl, "chOff");
  const chExt = findChild(xfrmEl, "chExt");
  return {
    x, y, w, h, rotDeg, flipH, flipV,
    chX: chOff ? (numAttr(chOff, "x") ?? 0) : undefined,
    chY: chOff ? (numAttr(chOff, "y") ?? 0) : undefined,
    chW: chExt ? (numAttr(chExt, "cx") ?? 0) : undefined,
    chH: chExt ? (numAttr(chExt, "cy") ?? 0) : undefined,
  };
}

function xfrmBoxMat(xfrm: Xfrm, includeFlip: boolean): Mat2D {
  let m = translateMat(xfrm.x + xfrm.w / 2, xfrm.y + xfrm.h / 2);
  if (xfrm.rotDeg) m = mulMat(m, rotateMat((xfrm.rotDeg * Math.PI) / 180));
  if (includeFlip && (xfrm.flipH || xfrm.flipV)) m = mulMat(m, scaleMat(xfrm.flipH ? -1 : 1, xfrm.flipV ? -1 : 1));
  return mulMat(m, translateMat(-xfrm.w / 2, -xfrm.h / 2));
}

function groupChildMat(parentMat: Mat2D, xfrm: Xfrm): Mat2D {
  const chX = xfrm.chX ?? 0;
  const chY = xfrm.chY ?? 0;
  const chW = xfrm.chW ?? xfrm.w;
  const chH = xfrm.chH ?? xfrm.h;
  const sx = chW > 0 ? xfrm.w / chW : 1;
  const sy = chH > 0 ? xfrm.h / chH : 1;
  // child coords -> group local (0..w, 0..h) -> group parent
  const toLocal = mulMat(scaleMat(sx, sy), translateMat(-chX, -chY));
  const toParent = mulMat(xfrmBoxMat(xfrm, true), toLocal);
  return mulMat(parentMat, toParent);
}

type ViewportFit = { scale: number; offsetX: number; offsetY: number; cx: number; cy: number };

const round2 = (v: number) => Math.round(v * 100) / 100;

function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return Math.abs(d) < 0.05 ? 0 : round2(d);
}

type ResolvedBox = { x: number; y: number; w: number; h: number; rotation: number; flipH: boolean; flipV: boolean };

function resolveBox(parentMat: Mat2D, xfrm: Xfrm, fit: ViewportFit): ResolvedBox {
  const m = mulMat(parentMat, xfrmBoxMat(xfrm, true));
  const [cx, cy] = applyMat(m, xfrm.w / 2, xfrm.h / 2);
  const finalW = Math.hypot(m[0] * xfrm.w, m[1] * xfrm.w);
  const finalH = Math.hypot(m[2] * xfrm.h, m[3] * xfrm.h);
  const det = m[0] * m[3] - m[1] * m[2];
  let rotation: number;
  let flipH = false;
  let flipV = false;
  if (det >= 0) {
    rotation = normalizeDeg((Math.atan2(m[1], m[0]) * 180) / Math.PI);
  } else {
    // 鏡映（det < 0）を R(rotation) * S(flipH, flipV) に分解する。
    // 回転角の絶対値が小さい方を選び、水平反転が 180° 逆さ回転にならないようにする。
    const rotH = normalizeDeg((Math.atan2(-m[1], -m[0]) * 180) / Math.PI);
    const rotV = normalizeDeg((Math.atan2(m[1], m[0]) * 180) / Math.PI);
    if (Math.abs(rotH) <= Math.abs(rotV)) {
      rotation = rotH;
      flipH = true;
    } else {
      rotation = rotV;
      flipV = true;
    }
  }
  return {
    x: round2((cx - finalW / 2) * fit.scale + fit.offsetX),
    y: round2((cy - finalH / 2) * fit.scale + fit.offsetY),
    w: round2(finalW * fit.scale),
    h: round2(finalH * fit.scale),
    rotation,
    flipH,
    flipV,
  };
}

function resolveLineEndpoints(parentMat: Mat2D, xfrm: Xfrm, fit: ViewportFit): { x: number; y: number; w: number; h: number; flipH: boolean; flipV: boolean } {
  const m = mulMat(parentMat, xfrmBoxMat(xfrm, true));
  const [x0, y0] = applyMat(m, 0, 0);
  const [x1, y1] = applyMat(m, xfrm.w, xfrm.h);
  const px0 = x0 * fit.scale + fit.offsetX;
  const py0 = y0 * fit.scale + fit.offsetY;
  const px1 = x1 * fit.scale + fit.offsetX;
  const py1 = y1 * fit.scale + fit.offsetY;
  const minX = Math.min(px0, px1);
  const minY = Math.min(py0, py1);
  const maxX = Math.max(px0, px1);
  const maxY = Math.max(py0, py1);
  return {
    x: round2(minX),
    y: round2(minY),
    w: round2(maxX - minX),
    h: round2(maxY - minY),
    flipH: px0 > px1 + 0.01,
    flipV: py0 > py1 + 0.01,
  };
}

// ---- 安全なハイパーリンク検証（http / https / mailto だけ。tel / javascript / file / data は落とす） ----
export function safePptxHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const href = value.trim();
  if (!href || href.length > 2000 || /[\u0000-\u001f\u007f]/.test(href)) return null;
  if (/^(https?:\/\/|mailto:)/i.test(href)) return href;
  return null;
}

// ---- 図形の種類（OOXML prstGeom → NoteFable の 15 種類 + 別名） ----
const LINE_PRESETS = new Set([
  "line", "lineInv", "straightConnector1",
  "bentConnector2", "bentConnector3", "bentConnector4", "bentConnector5",
  "curvedConnector2", "curvedConnector3", "curvedConnector4", "curvedConnector5",
]);

function mapPresetShape(prst: string | null): { kind: ShapeKind; extraRotation?: number; swapSize?: boolean } | "line" | null {
  if (!prst) return null;
  if (LINE_PRESETS.has(prst)) return "line";
  switch (prst) {
    case "rect": return { kind: "rect" };
    case "roundRect":
    case "round1Rect":
    case "round2SameRect":
    case "round2DiagRect":
    case "snip1Rect":
    case "snip2SameRect":
    case "snip2DiagRect":
    case "snipRoundRect":
    case "plaque":
    case "flowChartAlternateProcess":
      return { kind: "roundRect" };
    case "ellipse":
    case "oval":
    case "donut":
    case "pie":
    case "chord":
    case "arc":
    case "flowChartConnector":
    case "flowChartTerminator":
      return { kind: "ellipse" };
    case "triangle":
    case "isoscelesTriangle":
    case "flowChartExtract":
    case "flowChartMerge":
      return { kind: "triangle" };
    case "rtTriangle":
      return { kind: "rightTriangle" };
    case "diamond":
    case "flowChartDecision":
      return { kind: "diamond" };
    case "pentagon":
    case "homePlate":
      return { kind: "pentagon" };
    case "hexagon":
    case "heptagon":
    case "octagon":
    case "decagon":
    case "dodecagon":
    case "flowChartPreparation":
      return { kind: "hexagon" };
    case "star4":
    case "star5":
    case "star6":
    case "star7":
    case "star8":
    case "star10":
    case "star12":
    case "star16":
    case "star24":
    case "star32":
    case "irregularSeal1":
    case "irregularSeal2":
      return { kind: "star" };
    case "rightArrow":
    case "notchedRightArrow":
    case "stripedRightArrow":
    case "curvedRightArrow":
    case "bentArrow":
    case "uturnArrow":
    case "leftRightArrow":
      return { kind: "arrowRight" };
    case "leftArrow":
    case "curvedLeftArrow":
      return { kind: "arrowLeft" };
    case "upArrow":
      return { kind: "arrowRight", extraRotation: -90, swapSize: true };
    case "downArrow":
      return { kind: "arrowRight", extraRotation: 90, swapSize: true };
    case "chevron":
      return { kind: "chevron" };
    case "parallelogram":
    case "trapezoid":
    case "flowChartInputOutput":
      return { kind: "parallelogram" };
    case "plus":
    case "mathPlus":
      return { kind: "plus" };
    case "wedgeRectCallout":
    case "wedgeRoundRectCallout":
    case "wedgeEllipseCallout":
    case "cloudCallout":
    case "borderCallout1":
    case "borderCallout2":
    case "borderCallout3":
    case "accentCallout1":
    case "accentCallout2":
    case "accentCallout3":
    case "callout1":
    case "callout2":
    case "callout3":
    case "accentBorderCallout1":
    case "accentBorderCallout2":
    case "accentBorderCallout3":
      return { kind: "callout" };
    default:
      return null;
  }
}

function mapDash(val: string | null): Dash {
  if (!val || val === "solid") return "solid";
  if (val === "sysDot" || val === "dot") return "dot";
  return "dash";
}

function mapLineCap(val: string | null): LineCap {
  switch (val) {
    case "arrow":
    case "stealth":
      return "arrow";
    case "triangle":
      return "triangle";
    case "oval":
    case "diamond":
      return "oval";
    default:
      return "none";
  }
}

function mapVAlign(val: string | null): VAlign | null {
  switch (val) {
    case "t": return "top";
    case "ctr": return "middle";
    case "b": return "bottom";
    default: return null;
  }
}

function mapPlaceholderRole(phType: string | null): Role | undefined {
  switch (phType) {
    case "title":
    case "ctrTitle":
      return "title";
    case "subTitle":
      return "subtitle";
    case "body":
    case "obj":
      return "body";
    default:
      return undefined;
  }
}

// ---- 塗り・線の解決（spPr + p:style fillRef / lnRef） ----

function blendHex(fgHex: `#${string}`, bgHex: `#${string}`, alpha: number): `#${string}` {
  const a = Math.min(1, Math.max(0, alpha));
  const parse = (h: string) => [
    parseInt(h.slice(1, 3), 16) || 0,
    parseInt(h.slice(3, 5), 16) || 0,
    parseInt(h.slice(5, 7), 16) || 0,
  ];
  const [fr, fg, fb] = parse(fgHex);
  const [br, bg, bb] = parse(bgHex);
  const hex2 = (n: number) => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, "0");
  return `#${hex2(fr * a + br * (1 - a))}${hex2(fg * a + bg * (1 - a))}${hex2(fb * a + bb * (1 - a))}`;
}

function resolveFillNode(fillEl: Element | null | undefined, colorCtx: ColorContext): ResolvedColor | "none" | null {
  if (!fillEl) return null;
  const tag = localName(fillEl);
  if (tag === "noFill") return "none";
  if (tag === "solidFill") return resolveColorFromParent(fillEl, colorCtx);
  // グラデーションは中間のストップ色を代表色として使う（暗い背景が白く抜けないように）。
  if (tag === "gradFill") {
    const gsLst = findChild(fillEl, "gsLst");
    const stops = findChildren(gsLst, "gs");
    if (stops.length) {
      const mid = stops[Math.floor(stops.length / 2)];
      return resolveColorFromParent(mid, colorCtx);
    }
  }
  if (tag === "pattFill") {
    return resolveColorFromParent(findChild(fillEl, "bgClr"), colorCtx) ?? resolveColorFromParent(findChild(fillEl, "fgClr"), colorCtx);
  }
  return null;
}

function resolveFillFromContainer(container: Element | null | undefined, colorCtx: ColorContext): ResolvedColor | "none" | null {
  if (!container) return null;
  for (const child of childElements(container)) {
    const resolved = resolveFillNode(child, colorCtx);
    if (resolved !== null) return resolved;
  }
  return null;
}

function resolveStyleFill(shapeEl: Element, theme: ParsedTheme, colorCtx: ColorContext): ResolvedColor | null {
  const styleEl = findChild(shapeEl, "style");
  const fillRef = findChild(styleEl, "fillRef");
  if (!fillRef) return null;
  const idx = numAttr(fillRef, "idx") ?? 0;
  if (idx <= 0) return null;
  const phClr = resolveColorFromParent(fillRef, colorCtx);
  if (!phClr) return null;
  const list = idx >= 1001 ? theme.bgFillStyles : theme.fillStyles;
  const styleNode = list[(idx >= 1001 ? idx - 1001 : idx - 1)];
  if (styleNode) {
    const subCtx: ColorContext = { ...colorCtx, phClr };
    const resolved = resolveFillNode(styleNode, subCtx);
    if (resolved === "none") return null;
    if (resolved) return resolved;
  }
  return phClr;
}

type ResolvedLine = {
  color: ResolvedColor;
  widthPx: number;
  dash: Dash;
  start: LineCap;
  end: LineCap;
};

function resolveLine(
  spPr: Element | null,
  inheritedSpPr: (Element | null)[],
  shapeEl: Element,
  theme: ParsedTheme,
  colorCtx: ColorContext,
  fit: ViewportFit,
): ResolvedLine | null {
  const ln = findChild(spPr, "ln") ?? inheritedSpPr.map((el) => findChild(el, "ln")).find(Boolean) ?? null;
  if (ln && findChild(ln, "noFill")) return null;

  let color: ResolvedColor | null = null;
  let widthEmu = ln ? numAttr(ln, "w") : null;
  let dash: Dash = mapDash(attr(findChild(ln, "prstDash"), "val"));
  const start = mapLineCap(attr(findChild(ln, "headEnd"), "type"));
  const end = mapLineCap(attr(findChild(ln, "tailEnd"), "type"));

  if (ln) {
    const fill = resolveFillFromContainer(ln, colorCtx);
    if (fill === "none") return null;
    if (fill) color = fill;
  }
  if (!color) {
    // p:style/a:lnRef の参照をたどる。
    const lnRef = findChild(findChild(shapeEl, "style"), "lnRef");
    const idx = numAttr(lnRef, "idx") ?? 0;
    if (lnRef && idx > 0) {
      const phClr = resolveColorFromParent(lnRef, colorCtx);
      const refLn = theme.lineStyles[idx - 1];
      if (refLn && findChild(refLn, "noFill")) return null;
      if (phClr) {
        const refFill = refLn ? resolveFillFromContainer(refLn, { ...colorCtx, phClr }) : null;
        color = refFill && refFill !== "none" ? refFill : phClr;
        if (widthEmu === null && refLn) widthEmu = numAttr(refLn, "w");
        if (dash === "solid" && refLn) dash = mapDash(attr(findChild(refLn, "prstDash"), "val"));
      }
    }
  }
  if (!color) return null;
  const px = widthEmu !== null && widthEmu > 0 ? widthEmu * fit.scale : 2;
  return {
    color,
    widthPx: round2(Math.min(200, Math.max(0.5, px))),
    dash,
    start,
    end,
  };
}

// ---- 画像アセット管理（スライド全体で重複排除） ----

class AssetStore {
  private readonly byKey = new Map<string, PendingPptxImage>();
  private readonly ordered: PendingPptxImage[] = [];

  async resolveBlip(
    zip: SafePptxZip,
    rels: Map<string, RelEntry>,
    blipFill: Element | null | undefined,
    signal?: AbortSignal,
    options: { flipH?: boolean; flipV?: boolean; maxMediaEntryBytes?: number } = {},
  ): Promise<{ ok: true; src: string; width: number; height: number } | { ok: false; kind: "externalImage" | "unsupportedImage" | "oversizedImage" } | null> {
    if (!blipFill) return null;
    const blip = findChild(blipFill, "blip");
    if (!blip) return null;
    const embedId = attrLocal(blip, "embed");
    const linkId = attrLocal(blip, "link");
    const rel = embedId ? rels.get(embedId) : linkId ? rels.get(linkId) : undefined;
    if (!rel) return null;
    if (rel.external || !rel.resolvedPath) {
      return { ok: false, kind: "externalImage" };
    }
    let bytes: Uint8Array | null;
    try {
      bytes = await zip.readBytes(rel.resolvedPath, options.maxMediaEntryBytes ?? MAX_PPTX_MEDIA_ENTRY_BYTES, signal);
    } catch (error) {
      if (error instanceof PptxEntryTooLargeError) {
        return { ok: false, kind: "oversizedImage" };
      }
      throw error;
    }
    if (!bytes) return { ok: false, kind: "unsupportedImage" };
    const probe = probePptxImage(bytes, rel.resolvedPath);
    if (!probe.ok) {
      return { ok: false, kind: probe.reason === "oversized" ? "oversizedImage" : "unsupportedImage" };
    }
    const crop = parseSrcRect(findChild(blipFill, "srcRect"));
    const cropKey = crop ? `${crop.left.toFixed(4)},${crop.top.toFixed(4)},${crop.right.toFixed(4)},${crop.bottom.toFixed(4)}` : "";
    const flipKey = `${options.flipH ? "H" : ""}${options.flipV ? "V" : ""}`;
    const assetKey = `${rel.resolvedPath.toLowerCase()}|${cropKey}${flipKey ? `|${flipKey}` : ""}`;
    if (!this.byKey.has(assetKey)) {
      const pending: PendingPptxImage = {
        assetKey,
        zipPath: rel.resolvedPath,
        mimeType: probe.mimeType,
        width: probe.width,
        height: probe.height,
        bytes,
        ...(crop ? { crop } : {}),
        ...(options.flipH ? { flipH: true } : {}),
        ...(options.flipV ? { flipV: true } : {}),
      };
      this.byKey.set(assetKey, pending);
      this.ordered.push(pending);
    }
    return { ok: true, src: `${PPTX_ASSET_PREFIX}${assetKey}`, width: probe.width, height: probe.height };
  }

  list(): PendingPptxImage[] {
    return this.ordered;
  }
}

function parseSrcRect(el: Element | null): ImageCropRect | undefined {
  if (!el) return undefined;
  const frac = (name: string) => {
    const raw = numAttr(el, name);
    if (raw === null) return 0;
    return Math.min(0.95, Math.max(0, raw / 100_000));
  };
  const left = frac("l");
  const top = frac("t");
  const right = frac("r");
  const bottom = frac("b");
  if (left <= 0.002 && top <= 0.002 && right <= 0.002 && bottom <= 0.002) return undefined;
  if (left + right >= 0.98 || top + bottom >= 0.98) return undefined;
  return { left, top, right, bottom };
}

function parseImageAlpha(blipFill: Element | null | undefined): number | undefined {
  const blip = findChild(blipFill, "blip");
  const alphaMod = findChild(blip, "alphaModFix");
  const amt = numAttr(alphaMod, "amt");
  if (amt === null) return undefined;
  const value = Math.min(1, Math.max(0, amt / 100_000));
  return value < 0.995 ? round2(value) : undefined;
}

// ---- テキスト（RichDoc + TextStyle） ----

type RunRecord = {
  text: string;
  style: TextLevelStyle;
  href: string | null;
  code: boolean;
};

type ParagraphRecord = {
  align: TextStyle["align"] | undefined;
  lineHeight: number | undefined;
  bullet: { kind: "bullet" } | { kind: "number"; startAt: number } | null;
  level: number;
  items: ({ kind: "run"; run: RunRecord } | { kind: "br" })[];
  fallbackStyle: TextLevelStyle;
};

function parseTextBody(
  txBody: Element | null,
  shapeEl: Element,
  layoutPh: PlaceholderEntry | null,
  masterPh: PlaceholderEntry | null,
  masterTxStyle: TextStyleLevels | null,
  defaultTextStyle: TextStyleLevels | null,
  isTitle: boolean,
  hasDarkFill: boolean,
  colorCtx: ColorContext,
  fonts: FontScheme,
  rels: Map<string, RelEntry>,
  fit: ViewportFit,
  defaultValign: VAlign,
): { doc: RichDoc; style: TextStyle; hasText: boolean } {
  const bodyPr = findChild(txBody, "bodyPr")
    ?? findChild(findChild(layoutPh?.element, "txBody"), "bodyPr")
    ?? findChild(findChild(masterPh?.element, "txBody"), "bodyPr");
  const valign = mapVAlign(attr(bodyPr, "anchor")) ?? defaultValign;
  const shapeLstStyle = parseTextStyleLevels(findChild(txBody, "lstStyle"), colorCtx, fonts);

  // p:style/a:fontRef からの既定色・書体
  const fontRef = findChild(findChild(shapeEl, "style"), "fontRef");
  const fontRefColor = resolveColorFromParent(fontRef, colorCtx);
  const fontRefIdx = attr(fontRef, "idx");
  const fontRefFace = fontRefIdx === "major" ? fonts.major : fontRefIdx === "minor" ? fonts.minor : undefined;
  const baseFallbackColor: ResolvedColor = fontRefColor
    ?? { hex: `#${hasDarkFill ? (colorCtx.scheme[colorCtx.map.bg1 ?? "lt1"] ?? "ffffff") : (colorCtx.scheme[colorCtx.map.tx1 ?? "dk1"] ?? "000000")}`, alpha: 1 };
  const baseDefault: TextLevelStyle = {
    fontSizePt: isTitle ? 44 : 18,
    bold: false,
    italic: false,
    color: baseFallbackColor,
    fontFace: fontRefFace ?? (isTitle ? fonts.major : fonts.minor),
    align: "left",
    lineHeight: 1.25,
  };

  const paragraphs = findChildren(txBody, "p");
  const records: ParagraphRecord[] = [];
  const allRuns: RunRecord[] = [];

  for (const p of paragraphs) {
    const pPr = findChild(p, "pPr");
    const level = Math.max(0, Math.min(8, numAttr(pPr, "lvl") ?? 0));
    const inherited = mergeTextLevelStyles(
      baseDefault,
      pickLevelStyle(defaultTextStyle, level),
      pickLevelStyle(masterTxStyle, level),
      pickLevelStyle(masterPh?.lstStyle, level),
      pickLevelStyle(layoutPh?.lstStyle, level),
      pickLevelStyle(shapeLstStyle, level),
    );
    const pStyle = mergeTextLevelStyles(
      inherited,
      parseRunProps(findChild(pPr, "defRPr"), colorCtx, fonts),
      {
        align: mapAlign(attr(pPr, "algn")),
        bullet: parseBulletSpec(pPr),
        lineHeight: parseLineSpacing(pPr),
      },
    );

    const items: ParagraphRecord["items"] = [];
    for (const child of childElements(p)) {
      const tag = localName(child);
      if (tag === "br") {
        items.push({ kind: "br" });
      } else if (tag === "r" || tag === "fld") {
        const tEl = findChild(child, "t");
        const text = tEl?.textContent ?? "";
        if (!text) continue;
        const rPr = findChild(child, "rPr");
        const runStyle = mergeTextLevelStyles(pStyle, parseRunProps(rPr, colorCtx, fonts));
        const hlink = findChild(rPr, "hlinkClick");
        let href: string | null = null;
        if (hlink && !attr(hlink, "action")) {
          const rId = extractRelId(hlink);
          const rel = rId ? rels.get(rId) : undefined;
          if (rel?.external) href = safePptxHref(rel.target);
        }
        const run: RunRecord = {
          text,
          style: runStyle,
          href,
          code: isMonospaceFont(runStyle.fontFace),
        };
        items.push({ kind: "run", run });
        allRuns.push(run);
      }
    }

    const bullet = pStyle.bullet && pStyle.bullet.kind !== "none" ? pStyle.bullet : null;
    records.push({
      align: pStyle.align,
      lineHeight: pStyle.lineHeight,
      bullet,
      level,
      items,
      fallbackStyle: pStyle,
    });
  }

  // 要素の基準 TextStyle を最初の実テキスト（無ければ最初の段落）から決める。
  const sample = allRuns[0]?.style ?? records[0]?.fallbackStyle ?? baseDefault;
  const ptToPx = (pt: number) => Math.min(800, Math.max(4, Math.round(pt * EMU_PER_PT * fit.scale)));
  const baseSizePx = ptToPx(sample.fontSizePt ?? (isTitle ? 44 : 18));
  const baseColor = sample.color?.hex ?? "#000000";
  const baseAlign = records.find((r) => r.align)?.align ?? sample.align ?? "left";
  const baseLineHeight = records.find((r) => r.lineHeight !== undefined)?.lineHeight ?? sample.lineHeight ?? 1.25;
  const allBold = allRuns.length > 0 && allRuns.every((r) => r.style.bold === true);
  const allItalic = allRuns.length > 0 && allRuns.every((r) => r.style.italic === true);
  const allMono = allRuns.length > 0 && allRuns.every((r) => r.code);

  const style: TextStyle = {
    font: allMono ? "mono" : fontRoleFor(sample.fontFace, fonts, isTitle),
    size: baseSizePx,
    color: baseColor,
    align: baseAlign,
    valign,
    lineHeight: baseLineHeight,
    bold: allBold,
    italic: allItalic,
  };

  // RichDoc のブロック（段落と入れ子リスト）を組み立てる。
  const blocks: RichBlock[] = [];
  type OpenList = { kind: "bullet" | "number"; level: number; items: RichListItem[]; order: number };
  const listStack: OpenList[] = [];

  const flushLists = () => {
    listStack.length = 0;
  };

  for (const rec of records) {
    const inline: RichInline[] = [];
    for (const item of rec.items) {
      if (item.kind === "br") {
        inline.push({ type: "hard_break" });
        continue;
      }
      const { run } = item;
      const marks: RichMark[] = [];
      if (run.style.bold && !style.bold) marks.push({ type: "strong" });
      if (run.style.italic && !style.italic) marks.push({ type: "em" });
      if (run.style.underline) marks.push({ type: "underline" });
      if (run.style.strike) marks.push({ type: "strike" });
      if (run.code && style.font !== "mono") marks.push({ type: "code" });
      if (run.style.color && run.style.color.hex.toLowerCase() !== style.color.toLowerCase()) {
        marks.push({ type: "color", attrs: { color: run.style.color.hex } });
      }
      const runSizePx = run.style.fontSizePt ? ptToPx(run.style.fontSizePt) : baseSizePx;
      if (Math.abs(runSizePx - style.size) >= 1) {
        marks.push({ type: "size", attrs: { size: runSizePx } });
      }
      if (run.href) marks.push({ type: "link", attrs: { href: run.href } });
      inline.push(marks.length ? { type: "text", text: run.text, marks } : { type: "text", text: run.text });
    }
    const paraAlign = rec.align && rec.align !== style.align ? rec.align : null;
    const para: RichParagraph = inline.length
      ? { type: "paragraph", attrs: { align: paraAlign }, content: inline }
      : { type: "paragraph", attrs: { align: paraAlign } };

    if (!rec.bullet) {
      flushLists();
      blocks.push(para);
      continue;
    }

    const targetLevel = Math.min(rec.level, 4);
    const kind = rec.bullet.kind;
    while (listStack.length && (listStack[listStack.length - 1].level > targetLevel
      || (listStack[listStack.length - 1].level === targetLevel && listStack[listStack.length - 1].kind !== kind))) {
      listStack.pop();
    }
    if (!listStack.length || listStack[listStack.length - 1].level < targetLevel) {
      const order = rec.bullet.kind === "number" ? rec.bullet.startAt : 1;
      const listItems: RichListItem[] = [];
      const listNode: RichBlock = kind === "bullet"
        ? { type: "bullet_list", content: listItems }
        : { type: "ordered_list", attrs: { order }, content: listItems };
      if (!listStack.length) {
        blocks.push(listNode);
      } else {
        const parent = listStack[listStack.length - 1];
        const parentItem = parent.items[parent.items.length - 1];
        if (parentItem) parentItem.content.push(listNode);
        else blocks.push(listNode);
      }
      listStack.push({ kind, level: targetLevel, items: listItems, order });
    }
    listStack[listStack.length - 1].items.push({ type: "list_item", content: [para] });
  }

  const doc = normalizeRichDoc({ type: "doc", content: blocks.length ? blocks : [{ type: "paragraph", attrs: { align: null } }] });
  const hasText = !isRichDocEmpty(doc);
  return { doc, style, hasText };
}

// ---- スライド単位の解析コンテキスト ----

type SlideIssueTracker = Map<PptxUnsupportedKind, { count: number; previewCount: number }>;

function recordIssue(tracker: SlideIssueTracker, kind: PptxUnsupportedKind, hasPreview = false, count = 1) {
  const entry = tracker.get(kind) ?? { count: 0, previewCount: 0 };
  entry.count += count;
  if (hasPreview) entry.previewCount += count;
  tracker.set(kind, entry);
}

type ParseSlideCtx = {
  zip: SafePptxZip;
  rels: Map<string, RelEntry>;
  theme: ParsedTheme;
  colorCtx: ColorContext;
  bgHex: `#${string}`;
  layout: ParsedLayout | null;
  master: ParsedMaster | null;
  defaultTextStyle: TextStyleLevels | null;
  fit: ViewportFit;
  assets: AssetStore;
  issues: SlideIssueTracker;
  elements: SlideElement[];
  omittedElements: number;
  isBackgroundLayer: boolean;
  maxMediaEntryBytes: number;
  signal?: AbortSignal;
};

function pushElement(ctx: ParseSlideCtx, el: SlideElement) {
  if (ctx.elements.length < MAX_SLIDE_ELEMENTS) {
    ctx.elements.push(el);
  } else {
    ctx.omittedElements += 1;
  }
}

function isMediaPic(picEl: Element, rels: Map<string, RelEntry>): "video" | "audio" | null {
  const nvPr = findChild(findChild(picEl, "nvPicPr"), "nvPr");
  if (!nvPr) return null;
  if (findChild(nvPr, "videoFile") || findChild(nvPr, "quickTimeFile")) return "video";
  if (findChild(nvPr, "audioFile") || findChild(nvPr, "wavAudioFile") || findChild(nvPr, "audioCd")) return "audio";
  const p14Media = findDescendant(nvPr, "media");
  if (p14Media) {
    const rId = attrLocal(p14Media, "embed") ?? attrLocal(p14Media, "link");
    const rel = rId ? rels.get(rId) : undefined;
    if (rel?.type.toLowerCase().includes("audio")) return "audio";
    return "video";
  }
  return null;
}

async function parsePicElement(
  picEl: Element,
  parentMat: Mat2D,
  groupId: string | undefined,
  ctx: ParseSlideCtx,
  suppressIssue = false,
): Promise<ImageElement | null> {
  const mediaKind = isMediaPic(picEl, ctx.rels);
  const ph = readPlaceholderInfo(picEl);
  const layoutPh = ph && ctx.layout ? matchPlaceholder(ctx.layout.placeholders, ph.type, ph.idx) : null;
  const masterPh = ph && ctx.master ? matchPlaceholder(ctx.master.placeholders, ph.type, ph.idx) : null;
  const spPr = findChild(picEl, "spPr");
  const xfrm = parseXfrm(findChild(spPr, "xfrm"))
    ?? parseXfrm(findChild(findChild(layoutPh?.element, "spPr"), "xfrm"))
    ?? parseXfrm(findChild(findChild(masterPh?.element, "spPr"), "xfrm"));
  if (!xfrm) {
    if (mediaKind && !suppressIssue) recordIssue(ctx.issues, mediaKind, false);
    return null;
  }

  const box = resolveBox(parentMat, xfrm, ctx.fit);
  const blipFill = findChild(picEl, "blipFill");
  const resolved = await ctx.assets.resolveBlip(ctx.zip, ctx.rels, blipFill, ctx.signal, {
    flipH: box.flipH,
    flipV: box.flipV,
    maxMediaEntryBytes: ctx.maxMediaEntryBytes,
  });
  if (!resolved) {
    if (mediaKind && !suppressIssue) recordIssue(ctx.issues, mediaKind, false);
    return null;
  }
  if (!resolved.ok) {
    if (mediaKind) {
      if (!suppressIssue) recordIssue(ctx.issues, mediaKind, false);
    } else if (!suppressIssue) {
      recordIssue(ctx.issues, resolved.kind, false);
    }
    return null;
  }

  if (mediaKind && !suppressIssue) recordIssue(ctx.issues, mediaKind, true);

  const cNvPr = findChild(findChild(picEl, "nvPicPr"), "cNvPr");
  const alt = (attr(cNvPr, "descr") ?? attr(cNvPr, "title") ?? attr(cNvPr, "name") ?? "").trim().slice(0, 500);
  const opacity = parseImageAlpha(blipFill);
  const prst = attr(findChild(spPr, "prstGeom"), "prst");
  const radius = prst === "roundRect" ? Math.round(Math.min(box.w, box.h) * 0.12) : prst === "ellipse" ? Math.round(Math.min(box.w, box.h) / 2) : 0;

  const img: ImageElement = {
    id: newId(),
    type: "image",
    x: box.x,
    y: box.y,
    w: Math.max(1, box.w),
    h: Math.max(1, box.h),
    rotation: box.rotation,
    ...(groupId ? { group: groupId } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
    src: resolved.src,
    alt,
    fit: "contain",
    radius,
  };
  return img;
}

function parseTableElement(
  frameEl: Element,
  tblEl: Element,
  parentMat: Mat2D,
  groupId: string | undefined,
  ctx: ParseSlideCtx,
): TableElement | null {
  const xfrm = parseXfrm(findChild(frameEl, "xfrm"));
  if (!xfrm) return null;
  const box = resolveBox(parentMat, xfrm, ctx.fit);

  const gridCols = findChildren(findChild(tblEl, "tblGrid"), "gridCol").slice(0, 20);
  const rawRows = findChildren(tblEl, "tr").slice(0, 50);
  if (!rawRows.length) return null;

  const colCount = Math.min(20, Math.max(1, gridCols.length, ...rawRows.map((tr) => findChildren(tr, "tc").length)));
  const rawWidths = gridCols.length === colCount
    ? gridCols.map((col) => Math.max(1, numAttr(col, "w") ?? 1))
    : Array.from({ length: colCount }, () => 1);
  const minW = Math.min(...rawWidths) || 1;
  const cols = rawWidths.map((w) => round2(Math.min(20, Math.max(0.05, w / minW))));

  const tblPr = findChild(tblEl, "tblPr");
  let header = boolAttr(tblPr, "firstRow") !== false;
  let headerFill: `#${string}` | "surface" = "surface";
  let borderColor: `#${string}` | "line" = "line";
  let textColor: `#${string}` | "text" = "text";
  let fontSizePx = 28;
  let fontRole: TextStyle["font"] = "body";
  let foundSampleRun = false;
  let row0Bold = false;
  let row0HasFill = false;

  const rows = rawRows.map((tr, rowIndex) => {
    const tcs = findChildren(tr, "tc");
    const cells = Array.from({ length: colCount }, (_, colIndex) => {
      const tc = tcs[colIndex];
      if (!tc) return { text: "" };
      // 結合の継続セル（hMerge / vMerge）は重複文字を出さない。
      if (boolAttr(tc, "hMerge") === true || boolAttr(tc, "vMerge") === true) return { text: "" };
      const tcPr = findChild(tc, "tcPr");
      if (rowIndex === 0 && !row0HasFill) {
        const fill = resolveFillFromContainer(tcPr, ctx.colorCtx);
        if (fill && fill !== "none") {
          headerFill = fill.hex;
          row0HasFill = true;
        }
      }
      if (borderColor === "line" && tcPr) {
        for (const side of ["lnB", "lnT", "lnL", "lnR"]) {
          const lnFill = resolveFillFromContainer(findChild(tcPr, side), ctx.colorCtx);
          if (lnFill && lnFill !== "none") { borderColor = lnFill.hex; break; }
        }
      }
      const txBody = findChild(tc, "txBody");
      const paraTexts: string[] = [];
      for (const p of findChildren(txBody, "p")) {
        let line = "";
        for (const child of childElements(p)) {
          const tag = localName(child);
          if (tag === "br") { line += "\n"; continue; }
          if (tag !== "r" && tag !== "fld") continue;
          const tText = findChild(child, "t")?.textContent ?? "";
          line += tText;
          if (!foundSampleRun && tText.trim()) {
            const rPr = findChild(child, "rPr");
            const props = parseRunProps(rPr, ctx.colorCtx, ctx.theme.fonts);
            if (props.fontSizePt) fontSizePx = Math.min(200, Math.max(6, Math.round(props.fontSizePt * EMU_PER_PT * ctx.fit.scale)));
            if (props.color) textColor = props.color.hex;
            if (props.fontFace) fontRole = fontRoleFor(props.fontFace, ctx.theme.fonts, false);
            if (rowIndex === 0 && props.bold) row0Bold = true;
            foundSampleRun = true;
          } else if (rowIndex === 0 && !row0Bold && tText.trim()) {
            if (boolAttr(findChild(child, "rPr"), "b") === true) row0Bold = true;
          }
        }
        paraTexts.push(line);
      }
      return { text: paraTexts.join("\n").slice(0, 2000) };
    });
    return { cells };
  });

  if (boolAttr(tblPr, "firstRow") === null) {
    header = row0HasFill || row0Bold;
  }

  return {
    id: newId(),
    type: "table",
    x: box.x,
    y: box.y,
    w: Math.max(40, box.w),
    h: Math.max(30, box.h),
    rotation: box.rotation,
    ...(groupId ? { group: groupId } : {}),
    rows,
    cols,
    header,
    style: {
      size: fontSizePx,
      color: textColor,
      border: borderColor,
      headerFill,
      font: fontRole,
    },
  };
}

function classifyGraphicFrame(frameEl: Element): "table" | "chart" | "smartart" | "ole" | null {
  const graphicData = findDescendant(frameEl, "graphicData");
  if (!graphicData) return null;
  const uri = (attr(graphicData, "uri") ?? "").toLowerCase();
  if (findChild(graphicData, "tbl") || uri.includes("/table")) return "table";
  if (findDescendant(graphicData, "chart") || uri.includes("/chart")) return "chart";
  if (findDescendant(graphicData, "relIds") || uri.includes("/diagram")) return "smartart";
  const oleObj = findDescendant(graphicData, "oleObj");
  if (oleObj || uri.includes("/ole")) {
    const progId = (attr(oleObj, "progId") ?? "").toLowerCase();
    return progId.includes("chart") ? "chart" : "ole";
  }
  return null;
}

async function parseGraphicFrame(
  frameEl: Element,
  parentMat: Mat2D,
  groupId: string | undefined,
  ctx: ParseSlideCtx,
  fallbackPic: Element | null,
) {
  const kind = classifyGraphicFrame(frameEl);
  if (kind === "table") {
    const tbl = findDescendant(frameEl, "tbl");
    if (tbl) {
      const tableEl = parseTableElement(frameEl, tbl, parentMat, groupId, ctx);
      if (tableEl) pushElement(ctx, tableEl);
    }
    return;
  }
  if (!kind) return;

  // OLE の中や AlternateContent の Fallback に静止プレビュー画像があれば配置する。
  const embeddedPic = fallbackPic ?? findDescendant(frameEl, "pic");
  let placed = false;
  if (embeddedPic) {
    const img = await parsePicElement(embeddedPic, parentMat, groupId, ctx, true);
    if (img) {
      pushElement(ctx, img);
      placed = true;
    }
  }
  recordIssue(ctx.issues, kind, placed);
}

function parseConnectorOrShape(
  el: Element,
  isConnector: boolean,
  parentMat: Mat2D,
  groupId: string | undefined,
  ctx: ParseSlideCtx,
) {
  const ph = readPlaceholderInfo(el);
  // スライド上のフッター・日付・ページ番号プレースホルダーは、実テキストが無いなら飛ばす。
  const isChromePh = ph && (ph.type === "sldNum" || ph.type === "dt" || ph.type === "ftr" || ph.type === "hdr");
  const layoutPh = ph && ctx.layout ? matchPlaceholder(ctx.layout.placeholders, ph.type, ph.idx) : null;
  const masterPh = ph && ctx.master ? matchPlaceholder(ctx.master.placeholders, ph.type, ph.idx) : null;

  const spPr = findChild(el, "spPr");
  const layoutSpPr = findChild(layoutPh?.element, "spPr");
  const masterSpPr = findChild(masterPh?.element, "spPr");

  const xfrm = parseXfrm(findChild(spPr, "xfrm"))
    ?? parseXfrm(findChild(layoutSpPr, "xfrm"))
    ?? parseXfrm(findChild(masterSpPr, "xfrm"));
  if (!xfrm) return;

  const prstGeom = findChild(spPr, "prstGeom") ?? findChild(layoutSpPr, "prstGeom") ?? findChild(masterSpPr, "prstGeom");
  const prst = attr(prstGeom, "prst");
  const mappedShape = isConnector ? "line" : mapPresetShape(prst);

  const line = resolveLine(spPr, [layoutSpPr, masterSpPr], el, ctx.theme, ctx.colorCtx, ctx.fit);

  // 線・コネクター
  if (mappedShape === "line") {
    const lineColor = line?.color ?? { hex: `#${ctx.colorCtx.scheme[ctx.colorCtx.map.tx1 ?? "dk1"] ?? "000000"}`, alpha: 1 };
    const geom = resolveLineEndpoints(parentMat, xfrm, ctx.fit);
    const lineEl: LineElement = {
      id: newId(),
      type: "line",
      x: geom.x,
      y: geom.y,
      w: geom.w,
      h: geom.h,
      rotation: 0,
      ...(groupId ? { group: groupId } : {}),
      ...(lineColor.alpha < 0.995 ? { opacity: round2(lineColor.alpha) } : {}),
      stroke: lineColor.hex,
      strokeWidth: line?.widthPx ?? 2,
      dash: line?.dash ?? "solid",
      start: line?.start ?? "none",
      end: line?.end ?? "none",
      flipH: geom.flipH,
      flipV: geom.flipV,
    };
    pushElement(ctx, lineEl);
    return;
  }

  // 塗りの解決（spPr -> layoutPh -> masterPh -> p:style/fillRef）
  let fillResolved: ResolvedColor | null = null;
  const ownFill = resolveFillFromContainer(spPr, ctx.colorCtx);
  if (ownFill === "none") {
    fillResolved = null;
  } else if (ownFill) {
    fillResolved = ownFill;
  } else {
    const layoutFill = resolveFillFromContainer(layoutSpPr, ctx.colorCtx);
    if (layoutFill && layoutFill !== "none") fillResolved = layoutFill;
    else if (layoutFill !== "none") {
      const masterFill = resolveFillFromContainer(masterSpPr, ctx.colorCtx);
      if (masterFill && masterFill !== "none") fillResolved = masterFill;
      else if (masterFill !== "none") fillResolved = resolveStyleFill(el, ctx.theme, ctx.colorCtx);
    }
  }
  // ほぼ完全透過の塗り・線は「塗りなし／線なし」として扱い、要素全体の opacity で文字や枠線が消えないようにする。
  if (fillResolved && fillResolved.alpha <= 0.02) fillResolved = null;
  const effectiveLine = line && line.color.alpha <= 0.02 ? null : line;

  const cNvSpPr = findChild(findChild(el, "nvSpPr"), "cNvSpPr");
  const isTxBox = boolAttr(cNvSpPr, "txBox") === true;
  const isTitle = ph?.type === "title" || ph?.type === "ctrTitle";
  const masterTxStyle = isTitle
    ? ctx.master?.txStyles.title ?? null
    : ph ? ctx.master?.txStyles.body ?? null : ctx.master?.txStyles.other ?? null;
  const txBody = findChild(el, "txBody");
  const fillAppearanceHex = fillResolved
    ? (fillResolved.alpha < 0.995 ? blendHex(fillResolved.hex, ctx.bgHex, fillResolved.alpha) : fillResolved.hex)
    : null;
  const hasDarkFill = fillAppearanceHex !== null && hexLuminance(fillAppearanceHex) < 0.45;
  const defaultValign: VAlign = isTxBox || ph ? "top" : "middle";

  const textResult = txBody
    ? parseTextBody(
        txBody, el, layoutPh, masterPh, masterTxStyle, ctx.defaultTextStyle, isTitle, hasDarkFill,
        ctx.colorCtx, ctx.theme.fonts, ctx.rels, ctx.fit, defaultValign,
      )
    : null;

  if (isChromePh && !textResult?.hasText) return;
  // 空のプレースホルダー（スライド上の未入力枠で塗りも線も無いもの）は出さない。
  if (ph && !textResult?.hasText && !fillResolved && !effectiveLine) return;
  // 背景レイヤー（母版・版式）の空文字枠も出さない。
  if (ctx.isBackgroundLayer && !textResult?.hasText && !fillResolved && !effectiveLine) return;

  const box = resolveBox(parentMat, xfrm, ctx.fit);
  const isPlainRect = !prst || prst === "rect";
  const asText = isTxBox || (isPlainRect && !effectiveLine && (Boolean(textResult?.hasText) || Boolean(ph)));

  // 文字または不透明な枠線がある図形で塗りが半透明のときは、要素全体の opacity を落とさず背景色へ合成する。
  const hasText = Boolean(textResult?.hasText);
  const hasSemiFill = Boolean(fillResolved && fillResolved.alpha < 0.995);
  const hasSemiStroke = Boolean(effectiveLine && effectiveLine.color.alpha < 0.995);
  let fillHex: `#${string}` | null = fillResolved ? fillResolved.hex : null;
  let strokeHex: `#${string}` | null = effectiveLine ? effectiveLine.color.hex : null;
  let opacity: number | undefined;
  if (hasText) {
    if (hasSemiFill && fillResolved) fillHex = blendHex(fillResolved.hex, ctx.bgHex, fillResolved.alpha);
    if (hasSemiStroke && effectiveLine) strokeHex = blendHex(effectiveLine.color.hex, ctx.bgHex, effectiveLine.color.alpha);
  } else if (hasSemiFill && effectiveLine && !hasSemiStroke) {
    fillHex = blendHex(fillResolved!.hex, ctx.bgHex, fillResolved!.alpha);
  } else if (hasSemiStroke && fillResolved && !hasSemiFill) {
    strokeHex = blendHex(effectiveLine!.color.hex, ctx.bgHex, effectiveLine!.color.alpha);
  } else if (hasSemiFill && fillResolved) {
    opacity = round2(fillResolved.alpha);
  } else if (hasSemiStroke && effectiveLine) {
    opacity = round2(effectiveLine.color.alpha);
  }
  const role = mapPlaceholderRole(ph?.type ?? null);

  if (asText && textResult) {
    const textEl: TextElement = {
      id: newId(),
      type: "text",
      x: box.x,
      y: box.y,
      w: Math.max(10, box.w),
      h: Math.max(10, box.h),
      rotation: box.rotation,
      ...(groupId ? { group: groupId } : {}),
      ...(role ? { role } : {}),
      ...(opacity !== undefined ? { opacity } : {}),
      doc: textResult.doc,
      style: textResult.style,
      fill: fillHex,
      autoHeight: false,
    };
    pushElement(ctx, textEl);
    return;
  }

  // 図形（ShapeElement）
  let shapeKind: ShapeKind = mappedShape ? mappedShape.kind : "rect";
  let { x, y, w, h, rotation } = box;
  if (mappedShape?.extraRotation) {
    const extraRot = mappedShape.swapSize && box.flipV ? -mappedShape.extraRotation : mappedShape.extraRotation;
    rotation = normalizeDeg(rotation + extraRot);
    if (mappedShape.swapSize) {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const nextW = h;
      const nextH = w;
      w = nextW;
      h = nextH;
      x = round2(cx - w / 2);
      y = round2(cy - h / 2);
    }
  } else {
    if (box.flipH) {
      if (shapeKind === "arrowRight") shapeKind = "arrowLeft";
      else if (shapeKind === "arrowLeft") shapeKind = "arrowRight";
      else if (shapeKind === "chevron" && !hasText) rotation = normalizeDeg(rotation + 180);
    }
    if (box.flipV) {
      if ((shapeKind === "triangle" || shapeKind === "pentagon" || shapeKind === "star") && !hasText) {
        rotation = normalizeDeg(rotation + 180);
      }
    }
  }
  const shapeEl: ShapeElement = {
    id: newId(),
    type: "shape",
    x,
    y,
    w: Math.max(1, w),
    h: Math.max(1, h),
    rotation,
    ...(groupId ? { group: groupId } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
    shape: shapeKind,
    fill: fillHex,
    stroke: strokeHex,
    strokeWidth: effectiveLine ? effectiveLine.widthPx : 0,
    dash: effectiveLine ? effectiveLine.dash : "solid",
    doc: textResult?.doc ?? richDocFromText(""),
    style: textResult?.style ?? { font: "body", size: 32, color: hasDarkFill ? "#ffffff" : "#000000", align: "center", valign: "middle", lineHeight: 1.25, bold: false, italic: false },
  };
  pushElement(ctx, shapeEl);
}

async function parseTreeNode(node: Element, parentMat: Mat2D, groupId: string | undefined, ctx: ParseSlideCtx) {
  const tag = localName(node);
  if (tag === "sp") {
    parseConnectorOrShape(node, false, parentMat, groupId, ctx);
    return;
  }
  if (tag === "cxnSp") {
    parseConnectorOrShape(node, true, parentMat, groupId, ctx);
    return;
  }
  if (tag === "pic") {
    const img = await parsePicElement(node, parentMat, groupId, ctx);
    if (img) pushElement(ctx, img);
    return;
  }
  if (tag === "graphicFrame") {
    await parseGraphicFrame(node, parentMat, groupId, ctx, null);
    return;
  }
  if (tag === "grpSp") {
    const grpSpPr = findChild(node, "grpSpPr");
    const xfrm = parseXfrm(findChild(grpSpPr, "xfrm"));
    const nextMat = xfrm ? groupChildMat(parentMat, xfrm) : parentMat;
    // 最上位グループに共通の group ID を振って、取り込み後もまとめて動かせるようにする。
    const nextGroup = groupId ?? newId();
    for (const child of childElements(node)) {
      const childTag = localName(child);
      if (childTag === "nvGrpSpPr" || childTag === "grpSpPr") continue;
      await parseTreeNode(child, nextMat, nextGroup, ctx);
    }
    return;
  }
  if (tag === "AlternateContent") {
    const choice = findChild(node, "Choice");
    const fallback = findChild(node, "Fallback");
    const choiceFrame = findChild(choice, "graphicFrame");
    if (choiceFrame) {
      const kind = classifyGraphicFrame(choiceFrame);
      if (kind && kind !== "table") {
        // 新しいチャート（cx:chart）や SmartArt・OLE：Fallback に静止プレビュー画像（p:pic）があれば配置する。
        const fallbackPic = findDescendant(fallback, "pic");
        await parseGraphicFrame(choiceFrame, parentMat, groupId, ctx, fallbackPic);
        return;
      }
    }
    // 3D モデルなど Choice 側に非対応要素しかない場合は Fallback を使う。
    const choiceChildren = childElements(choice).filter((el) => ["sp", "cxnSp", "pic", "graphicFrame", "grpSp", "AlternateContent"].includes(localName(el)));
    if (choiceChildren.length) {
      for (const child of choiceChildren) await parseTreeNode(child, parentMat, groupId, ctx);
    } else if (fallback) {
      for (const child of childElements(fallback)) await parseTreeNode(child, parentMat, groupId, ctx);
    }
  }
}

// ---- 背景・切り替え・アニメーション・演説者ノート ----

async function resolveBackground(
  bgCandidates: { bg: Element | null; rels: Map<string, RelEntry>; colorCtx: ColorContext; theme: ParsedTheme }[],
  fit: ViewportFit,
  zip: SafePptxZip,
  assets: AssetStore,
  issues: SlideIssueTracker,
  maxMediaEntryBytes: number,
  signal?: AbortSignal,
): Promise<{ color: `#${string}`; bgImage: ImageElement | null }> {
  for (const cand of bgCandidates) {
    if (!cand.bg) continue;
    const bgPr = findChild(cand.bg, "bgPr");
    if (bgPr) {
      const blipFill = findChild(bgPr, "blipFill");
      if (blipFill) {
        const resolved = await assets.resolveBlip(zip, cand.rels, blipFill, signal, { maxMediaEntryBytes });
        if (resolved?.ok) {
          const img: ImageElement = {
            id: newId(),
            type: "image",
            x: round2(fit.offsetX),
            y: round2(fit.offsetY),
            w: round2(fit.cx * fit.scale),
            h: round2(fit.cy * fit.scale),
            rotation: 0,
            src: resolved.src,
            alt: "",
            fit: "cover",
            radius: 0,
          };
          const fallbackHex = `#${cand.colorCtx.scheme[cand.colorCtx.map.bg1 ?? "lt1"] ?? "ffffff"}` as `#${string}`;
          return { color: fallbackHex, bgImage: img };
        }
        if (resolved && !resolved.ok) recordIssue(issues, resolved.kind, false);
      }
      const fill = resolveFillFromContainer(bgPr, cand.colorCtx);
      if (fill && fill !== "none") return { color: fill.hex, bgImage: null };
    }
    const bgRef = findChild(cand.bg, "bgRef");
    if (bgRef) {
      const phClr = resolveColorFromParent(bgRef, cand.colorCtx);
      const idx = numAttr(bgRef, "idx") ?? 0;
      const styleNode = idx >= 1001 ? cand.theme.bgFillStyles[idx - 1001] : undefined;
      if (styleNode && phClr) {
        const resolved = resolveFillNode(styleNode, { ...cand.colorCtx, phClr });
        if (resolved === "none") continue;
        if (resolved) return { color: resolved.hex, bgImage: null };
      }
      if (phClr) return { color: phClr.hex, bgImage: null };
    }
  }
  const last = bgCandidates[bgCandidates.length - 1];
  const fallback = last?.colorCtx.scheme[last.colorCtx.map.bg1 ?? "lt1"] ?? "ffffff";
  return { color: `#${fallback}` as `#${string}`, bgImage: null };
}

function parseSlideTransition(slideRoot: Element, issues: SlideIssueTracker): SlideTransition | undefined {
  // transition は直下または mc:AlternateContent の中にある。
  let trans = findChild(slideRoot, "transition");
  if (!trans) {
    for (const ac of findChildren(slideRoot, "AlternateContent")) {
      const fromChoice = findChild(findChild(ac, "Choice"), "transition");
      const fromFallback = findChild(findChild(ac, "Fallback"), "transition");
      trans = fromChoice ?? fromFallback;
      if (trans) break;
    }
  }
  if (!trans) return undefined;
  const effects = childElements(trans).filter((el) => localName(el) !== "sndAc" && localName(el) !== "extLst");
  if (!effects.length) return undefined;
  const kind = localName(effects[0]);
  if (kind === "fade" || kind === "dissolve") return "fade";
  if (kind === "push" || kind === "cover" || kind === "pull" || kind === "wipe") return "slide";
  if (kind === "cut") return undefined;
  recordIssue(issues, "transition", false);
  return undefined;
}

const ANIMATION_TAGS = new Set(["anim", "animEffect", "animMotion", "animRot", "animScale", "animClr", "set"]);

function hasSlideAnimations(slideRoot: Element): boolean {
  const timing = findChild(slideRoot, "timing");
  if (!timing) return false;
  const stack = childElements(timing);
  while (stack.length) {
    const el = stack.pop()!;
    if (ANIMATION_TAGS.has(localName(el))) {
      // tgtEl（対象要素）を持つ実際のアニメーション動作だけを数える（空のひな形を誤検出しない）。
      if (findDescendant(el, "spTgt") || findDescendant(el, "txEl") || findDescendant(el, "graphicEl")) return true;
    }
    for (const child of childElements(el)) stack.push(child);
  }
  return false;
}

const REL_NOTES_SLIDE = "/notesslide";

async function parseSpeakerNotes(zip: SafePptxZip, slideRels: Map<string, RelEntry>, signal?: AbortSignal): Promise<string | undefined> {
  const rel = findRelByTypeSuffix(slideRels, REL_NOTES_SLIDE);
  if (!rel?.resolvedPath) return undefined;
  const doc = await zip.readXml(rel.resolvedPath, signal);
  const spTree = findChild(findChild(doc?.documentElement, "cSld"), "spTree");
  if (!spTree) return undefined;
  const blocks: string[] = [];
  for (const sp of findChildren(spTree, "sp")) {
    const ph = readPlaceholderInfo(sp);
    // ページ番号・ヘッダー・スライドサムネイル枠は除外し、本文プレースホルダー（body）または非プレースホルダーだけ読む。
    if (ph && ph.type !== "body") continue;
    const txBody = findChild(sp, "txBody");
    if (!txBody) continue;
    const lines: string[] = [];
    for (const p of findChildren(txBody, "p")) {
      let line = "";
      for (const child of childElements(p)) {
        const tag = localName(child);
        if (tag === "br") line += "\n";
        else if (tag === "r" || tag === "fld") line += findChild(child, "t")?.textContent ?? "";
      }
      lines.push(line);
    }
    const text = lines.join("\n").trim();
    if (text) blocks.push(text);
  }
  const joined = blocks.join("\n\n").trim();
  return joined ? joined.slice(0, MAX_SLIDE_NOTES) : undefined;
}

function slideTitleSnippet(elements: SlideElement[]): string | undefined {
  const titled = elements.find((el): el is TextElement => el.type === "text" && el.role === "title" && !isRichDocEmpty(el.doc));
  const candidate = titled ?? elements.find((el): el is TextElement => el.type === "text" && !isRichDocEmpty(el.doc));
  if (!candidate) return undefined;
  const firstLine = richDocText(candidate.doc).split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  return firstLine ? firstLine.slice(0, 80) : undefined;
}

const REL_OFFICE_DOC = "/officedocument";
const REL_CORE_PROPS = "/metadata/core-properties";

export type ParsePptxOptions = {
  fileName?: string;
  xmlParser?: XmlParserLike;
  maxUncompressedBytes?: number;
  maxMediaEntryBytes?: number;
  signal?: AbortSignal;
  onSlideProgress?: (done: number, total: number) => void;
};

export async function parsePptx(data: ArrayBuffer | Uint8Array, options: ParsePptxOptions = {}): Promise<ParsedPptx> {
  const zip = await SafePptxZip.open(data, {
    xmlParser: options.xmlParser,
    maxUncompressedBytes: options.maxUncompressedBytes,
  });

  // ルート .rels から presentation.xml と core.xml の場所をたどる（標準パスへフォールバック）。
  const rootRels = await zip.readRels("", options.signal);
  const presPath = findRelByTypeSuffix(rootRels, REL_OFFICE_DOC)?.resolvedPath ?? "ppt/presentation.xml";
  const presDoc = await zip.readXml(presPath, options.signal);
  const presRoot = presDoc?.documentElement;
  if (!presRoot || localName(presRoot) !== "presentation") {
    throw new PptxImportError("invalid_archive", PPTX_ERROR_MESSAGES.invalidArchive);
  }
  const presRels = await zip.readRels(presPath, options.signal);

  // 題名（core.xml の dc:title → ファイル名 → "Untitled"）
  let title = "";
  const corePath = findRelByTypeSuffix(rootRels, REL_CORE_PROPS)?.resolvedPath ?? "docProps/core.xml";
  const coreDoc = zip.has(corePath) ? await zip.readXml(corePath, options.signal).catch(() => null) : null;
  if (coreDoc?.documentElement) {
    title = (findDescendant(coreDoc.documentElement, "title")?.textContent ?? "").trim();
  }
  if (!title && options.fileName) {
    title = options.fileName.replace(/\.pptx$/i, "").trim();
  }
  if (!title) title = "Untitled";
  title = title.slice(0, 200);

  // スライド寸法 → 1920 × 1080 へ等比フィット
  const sldSz = findChild(presRoot, "sldSz");
  const cx = Math.max(1, numAttr(sldSz, "cx") ?? DEFAULT_SLIDE_CX);
  const cy = Math.max(1, numAttr(sldSz, "cy") ?? DEFAULT_SLIDE_CY);
  const scale = Math.min(SLIDE_WIDTH / cx, SLIDE_HEIGHT / cy);
  const fit: ViewportFit = {
    scale,
    offsetX: (SLIDE_WIDTH - cx * scale) / 2,
    offsetY: (SLIDE_HEIGHT - cy * scale) / 2,
    cx,
    cy,
  };

  // スライド一覧と枚数上限（200 枚）
  const sldIdLst = findChild(presRoot, "sldIdLst");
  const sldIdNodes = findChildren(sldIdLst, "sldId");
  if (!sldIdNodes.length) {
    throw new PptxImportError("no_slides", PPTX_ERROR_MESSAGES.noSlides);
  }
  if (sldIdNodes.length > MAX_PPTX_SLIDES) {
    throw new PptxImportError("too_many_slides", PPTX_ERROR_MESSAGES.tooManySlides);
  }

  // 既定の母版を読み込む（スライドの版式が母版を指さない場合のフォールバック + 主題フォントの基準）。
  const masterCache = new Map<string, ParsedMaster>();
  const layoutCache = new Map<string, ParsedLayout>();
  let firstMaster: ParsedMaster | null = null;
  const masterIdLst = findChild(presRoot, "sldMasterIdLst");
  for (const mNode of findChildren(masterIdLst, "sldMasterId")) {
    const rId = extractRelId(mNode);
    const rel = rId ? presRels.get(rId) : undefined;
    if (rel && !rel.external && rel.resolvedPath) {
      firstMaster = await loadMaster(zip, rel.resolvedPath, masterCache, options.signal);
      break;
    }
  }

  let fallbackTheme: ParsedTheme | null = firstMaster?.theme ?? null;
  if (!fallbackTheme) {
    const presThemeRel = findThemeRel(presRels);
    if (presThemeRel?.resolvedPath) {
      fallbackTheme = parseThemeDoc(await zip.readXml(presThemeRel.resolvedPath, options.signal));
    }
  }
  const defaultTheme: ParsedTheme = fallbackTheme ?? {
    colors: { ...DEFAULT_COLOR_SCHEME },
    fonts: { major: "Calibri", minor: "Calibri" },
    fillStyles: [],
    lineStyles: [],
    bgFillStyles: [],
  };
  const defaultColorCtx: ColorContext = { scheme: defaultTheme.colors, map: firstMaster?.colorMap ?? DEFAULT_COLOR_MAP };
  const defaultTextStyle = parseTextStyleLevels(findChild(presRoot, "defaultTextStyle"), defaultColorCtx, defaultTheme.fonts);
  const sections = parseSections(presRoot);
  const assets = new AssetStore();

  const slides: Slide[] = [];
  const slideReports: PptxSlideReport[] = [];
  let darkBgCount = 0;

  for (let i = 0; i < sldIdNodes.length; i += 1) {
    if (options.signal?.aborted) throw new PptxImportError("aborted", PPTX_ERROR_MESSAGES.aborted);
    options.onSlideProgress?.(i, sldIdNodes.length);

    const sldIdNode = sldIdNodes[i];
    const sldNumId = attr(sldIdNode, "id") ?? "";
    const rId = extractRelId(sldIdNode);
    const slideRel = rId ? presRels.get(rId) : undefined;
    if (!slideRel || slideRel.external || !slideRel.resolvedPath) continue;

    const slideDoc = await zip.readXml(slideRel.resolvedPath, options.signal);
    const slideRoot = slideDoc?.documentElement;
    if (!slideRoot) continue;
    const slideRels = await zip.readRels(slideRel.resolvedPath, options.signal);
    const layoutRel = findLayoutRel(slideRels);
    const layout = layoutRel?.resolvedPath
      ? await loadLayout(zip, layoutRel.resolvedPath, layoutCache, masterCache, firstMaster, options.signal)
      : null;
    const master = layout?.master ?? firstMaster;
    const theme = layout?.theme ?? master?.theme ?? defaultTheme;
    const colorMap = applyColorMapOverride(slideRoot, layout?.colorMap ?? master?.colorMap ?? DEFAULT_COLOR_MAP);
    const colorCtx: ColorContext = { scheme: theme.colors, map: colorMap };

    const maxMediaEntryBytes = options.maxMediaEntryBytes ?? MAX_PPTX_MEDIA_ENTRY_BYTES;
    const issues: SlideIssueTracker = new Map();
    const bgElements: SlideElement[] = [];
    let bgOmitted = 0;

    const cSld = findChild(slideRoot, "cSld");
    const slideBgEl = findChild(cSld, "bg");
    const bg = await resolveBackground(
      [
        { bg: slideBgEl, rels: slideRels, colorCtx, theme },
        ...(layout ? [{ bg: layout.bgElement, rels: layout.rels, colorCtx: { scheme: layout.theme.colors, map: layout.colorMap }, theme: layout.theme }] : []),
        ...(master ? [{ bg: master.bgElement, rels: master.rels, colorCtx: { scheme: master.theme.colors, map: master.colorMap }, theme: master.theme }] : []),
      ],
      fit,
      zip,
      assets,
      issues,
      maxMediaEntryBytes,
      options.signal,
    );
    if (hexLuminance(bg.color) < 0.35) darkBgCount += 1;
    if (bg.bgImage) bgElements.push(bg.bgImage);

    // 母版・版式の非プレースホルダー装飾要素（showMasterSp が false でなければ後ろに置く）。
    const showMasterSp = boolAttr(slideRoot, "showMasterSp") !== false;
    if (showMasterSp && master && (!layout || layout.showMasterSp)) {
      const masterCtx: ParseSlideCtx = {
        zip, rels: master.rels, theme: master.theme, colorCtx: { scheme: master.theme.colors, map: master.colorMap },
        bgHex: bg.color, layout: null, master, defaultTextStyle, fit, assets, issues, elements: bgElements,
        omittedElements: 0, isBackgroundLayer: true, maxMediaEntryBytes, signal: options.signal,
      };
      for (const shape of master.backgroundShapes) {
        await parseTreeNode(shape, MAT_ID, undefined, masterCtx);
      }
      bgOmitted += masterCtx.omittedElements;
    }
    if (showMasterSp && layout) {
      const layoutCtx: ParseSlideCtx = {
        zip, rels: layout.rels, theme: layout.theme, colorCtx: { scheme: layout.theme.colors, map: layout.colorMap },
        bgHex: bg.color, layout, master, defaultTextStyle, fit, assets, issues, elements: bgElements,
        omittedElements: 0, isBackgroundLayer: true, maxMediaEntryBytes, signal: options.signal,
      };
      for (const shape of layout.backgroundShapes) {
        await parseTreeNode(shape, MAT_ID, undefined, layoutCtx);
      }
      bgOmitted += layoutCtx.omittedElements;
    }

    // スライド本体の要素（1,000 件の上限に当たるときは母版・版式の装飾よりスライド本体を優先する）。
    const slideElements: SlideElement[] = [];
    const slideCtx: ParseSlideCtx = {
      zip, rels: slideRels, theme, colorCtx, bgHex: bg.color, layout, master, defaultTextStyle,
      fit, assets, issues, elements: slideElements, omittedElements: 0, isBackgroundLayer: false,
      maxMediaEntryBytes, signal: options.signal,
    };
    const spTree = findChild(cSld, "spTree");
    for (const child of childElements(spTree)) {
      const tag = localName(child);
      if (tag === "nvGrpSpPr" || tag === "grpSpPr") continue;
      await parseTreeNode(child, MAT_ID, undefined, slideCtx);
    }

    const bgBudget = Math.max(0, MAX_SLIDE_ELEMENTS - slideElements.length);
    const keptBg = bgElements.slice(0, bgBudget);
    const omittedCount = slideCtx.omittedElements + bgOmitted + (bgElements.length - keptBg.length);
    if (omittedCount > 0) recordIssue(issues, "elementLimit", false, omittedCount);
    const elements: SlideElement[] = [...keptBg, ...slideElements];

    const hidden = boolAttr(slideRoot, "show") === false;
    const transition = parseSlideTransition(slideRoot, issues);
    if (hasSlideAnimations(slideRoot)) recordIssue(issues, "animation", false);
    const notes = await parseSpeakerNotes(zip, slideRels, options.signal);
    const section = sections.get(sldNumId);

    const slide: Slide = {
      id: newId(),
      layout: "blank",
      background: bg.color,
      elements,
      ...(hidden ? { hidden: true } : {}),
      ...(notes ? { notes } : {}),
      ...(section !== undefined ? { section } : {}),
      ...(transition ? { transition } : {}),
    };
    slides.push(slide);

    if (issues.size > 0) {
      const list: PptxSlideIssue[] = [...issues.entries()].map(([kind, stats]) => ({
        kind,
        count: stats.count,
        previewCount: stats.previewCount,
      }));
      const snippet = slideTitleSnippet(elements);
      slideReports.push({
        slideNumber: slides.length,
        ...(snippet ? { slideTitle: snippet } : {}),
        issues: list,
      });
    }
  }

  if (!slides.length) {
    throw new PptxImportError("no_slides", PPTX_ERROR_MESSAGES.noSlides);
  }
  options.onSlideProgress?.(slides.length, slides.length);

  const darkMode = darkBgCount > slides.length / 2;
  const deckTheme = matchDeckTheme(defaultTheme.fonts, darkMode);
  const totalUnsupported = slideReports.reduce((sum, s) => sum + s.issues.reduce((inner, item) => inner + item.count, 0), 0);
  const totalPreviews = slideReports.reduce((sum, s) => sum + s.issues.reduce((inner, item) => inner + item.previewCount, 0), 0);

  // 要素上限で落ちたスライド要素の画像が余分にアップロードされないよう、最終の slides から参照されている画像だけを残す。
  const usedAssetKeys = new Set<string>();
  for (const slide of slides) {
    for (const el of slide.elements) {
      if (el.type === "image" && el.src.startsWith(PPTX_ASSET_PREFIX)) {
        usedAssetKeys.add(el.src.slice(PPTX_ASSET_PREFIX.length));
      }
    }
  }
  const usedImages = assets.list().filter((img) => usedAssetKeys.has(img.assetKey));

  return {
    title,
    deck: { format: DECK_FORMAT, theme: deckTheme, slides },
    images: usedImages,
    report: {
      slideCount: slides.length,
      uploadedImageCount: usedImages.length,
      slides: slideReports,
      totalUnsupported,
      totalPreviews,
    },
  };
}
