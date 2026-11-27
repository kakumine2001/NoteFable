import { SLIDE_THEMES } from "@/lib/slides/themes";
import type { DeckTheme, FontRole, HAlign } from "@/lib/slides/model";
import { resolveColorFromParent, type ColorContext, type ResolvedColor } from "@/lib/slides/pptx/colors";
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
  type RelEntry,
  type SafePptxZip,
} from "@/lib/slides/pptx/zip-reader";

// PPTX の主題（theme）・母版（slideMaster）・版式（slideLayout）とテキストスタイルの継承を扱う。

export type ColorScheme = Record<string, string>; // key: dk1, lt1, dk2, lt2, accent1..6, hlink, folHlink -> "rrggbb"
export type ColorMap = Record<string, string>; // key: bg1, tx1, bg2, tx2, accent1..6, hlink, folHlink -> ColorScheme key

export const DEFAULT_COLOR_SCHEME: ColorScheme = {
  dk1: "000000",
  lt1: "ffffff",
  dk2: "1f497d",
  lt2: "eeece1",
  accent1: "4f81bd",
  accent2: "c0504d",
  accent3: "9bbb59",
  accent4: "8064a2",
  accent5: "4bacc6",
  accent6: "f79646",
  hlink: "0000ff",
  folHlink: "800080",
};

export const DEFAULT_COLOR_MAP: ColorMap = {
  bg1: "lt1",
  tx1: "dk1",
  bg2: "lt2",
  tx2: "dk2",
  accent1: "accent1",
  accent2: "accent2",
  accent3: "accent3",
  accent4: "accent4",
  accent5: "accent5",
  accent6: "accent6",
  hlink: "hlink",
  folHlink: "folHlink",
};

export type FontScheme = {
  major: string;
  minor: string;
};

export type ParsedTheme = {
  colors: ColorScheme;
  fonts: FontScheme;
  fillStyles: Element[];
  lineStyles: Element[];
  bgFillStyles: Element[];
};

export type BulletSpec =
  | { kind: "none" }
  | { kind: "bullet" }
  | { kind: "number"; startAt: number };

export type TextLevelStyle = {
  fontSizePt?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: ResolvedColor;
  fontFace?: string;
  align?: HAlign;
  bullet?: BulletSpec;
  lineHeight?: number;
};

// index 0..8 = lvl1pPr..lvl9pPr, def = defPPr
export type TextStyleLevels = {
  def?: TextLevelStyle;
  levels: (TextLevelStyle | undefined)[];
};

export type PlaceholderEntry = {
  type: string; // normalized: title / subTitle / body / dt / ftr / sldNum / pic / tbl / ...
  idx: string | null;
  element: Element;
  lstStyle: TextStyleLevels | null;
};

export type ParsedMaster = {
  path: string;
  rels: Map<string, RelEntry>;
  theme: ParsedTheme;
  colorMap: ColorMap;
  bgElement: Element | null;
  placeholders: PlaceholderEntry[];
  backgroundShapes: Element[];
  txStyles: {
    title: TextStyleLevels | null;
    body: TextStyleLevels | null;
    other: TextStyleLevels | null;
  };
};

export type ParsedLayout = {
  path: string;
  rels: Map<string, RelEntry>;
  master: ParsedMaster;
  theme: ParsedTheme;
  colorMap: ColorMap;
  bgElement: Element | null;
  showMasterSp: boolean;
  placeholders: PlaceholderEntry[];
  backgroundShapes: Element[];
};

const MONO_FONT = /mono|courier|consolas|menlo|monaco|fira\s*code|source\s*code|inconsolata|hack|dejavu\s*sans\s*mono|liberation\s*mono|jetbrains/i;

export function isMonospaceFont(face: string | undefined): boolean {
  return Boolean(face && MONO_FONT.test(face));
}

export function resolveFontFace(raw: string | null | undefined, fonts: FontScheme): string | undefined {
  if (!raw) return undefined;
  if (raw.startsWith("+mj")) return fonts.major || undefined;
  if (raw.startsWith("+mn")) return fonts.minor || undefined;
  return raw;
}

export function fontRoleFor(face: string | undefined, fonts: FontScheme, isTitle: boolean): FontRole {
  if (isMonospaceFont(face)) return "mono";
  if (isTitle) return "heading";
  if (face && fonts.major && face.toLowerCase() === fonts.major.toLowerCase() && fonts.major.toLowerCase() !== fonts.minor.toLowerCase()) {
    return "heading";
  }
  return "body";
}

export function mapAlign(raw: string | null | undefined): HAlign | undefined {
  switch (raw) {
    case "l": return "left";
    case "ctr": return "center";
    case "r": return "right";
    case "just":
    case "justLow":
    case "dist":
    case "thaiDist":
      return "justify";
    default:
      return undefined;
  }
}

export function parseBulletSpec(pPr: Element | null | undefined): BulletSpec | undefined {
  if (!pPr) return undefined;
  if (findChild(pPr, "buNone")) return { kind: "none" };
  const autoNum = findChild(pPr, "buAutoNum");
  if (autoNum) {
    const start = numAttr(autoNum, "startAt");
    return { kind: "number", startAt: start !== null && start >= 0 ? Math.min(9999, Math.round(start)) : 1 };
  }
  if (findChild(pPr, "buChar") || findChild(pPr, "buBlip")) {
    return { kind: "bullet" };
  }
  return undefined;
}

export function parseLineSpacing(pPr: Element | null | undefined): number | undefined {
  const lnSpc = findChild(pPr, "lnSpc");
  if (!lnSpc) return undefined;
  const spcPct = findChild(lnSpc, "spcPct");
  const raw = attr(spcPct, "val");
  if (!raw) return undefined;
  const num = raw.endsWith("%") ? Number.parseFloat(raw.slice(0, -1)) / 100 : Number.parseFloat(raw) / 100_000;
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return Math.min(3, Math.max(0.8, Math.round(num * 100) / 100));
}

export function parseRunProps(rPr: Element | null | undefined, colorCtx: ColorContext, fonts: FontScheme): TextLevelStyle {
  if (!rPr) return {};
  const style: TextLevelStyle = {};
  const sz = numAttr(rPr, "sz");
  if (sz !== null && sz > 0) style.fontSizePt = sz / 100;
  const b = boolAttr(rPr, "b");
  if (b !== null) style.bold = b;
  const i = boolAttr(rPr, "i");
  if (i !== null) style.italic = i;
  const u = attr(rPr, "u");
  if (u !== null) style.underline = u !== "none" && u !== "";
  const strike = attr(rPr, "strike");
  if (strike !== null) style.strike = strike !== "noStrike" && strike !== "";
  const solid = findChild(rPr, "solidFill");
  if (solid) {
    const color = resolveColorFromParent(solid, colorCtx);
    if (color) style.color = color;
  }
  const latin = findChild(rPr, "latin");
  const ea = findChild(rPr, "ea");
  const cs = findChild(rPr, "cs");
  const face = resolveFontFace(attr(latin, "typeface") ?? attr(ea, "typeface") ?? attr(cs, "typeface"), fonts);
  if (face) style.fontFace = face;
  return style;
}

export function parseParagraphLevelStyle(pPr: Element | null | undefined, colorCtx: ColorContext, fonts: FontScheme): TextLevelStyle | undefined {
  if (!pPr) return undefined;
  const defRPr = findChild(pPr, "defRPr");
  const base = parseRunProps(defRPr, colorCtx, fonts);
  const align = mapAlign(attr(pPr, "algn"));
  if (align) base.align = align;
  const bullet = parseBulletSpec(pPr);
  if (bullet) base.bullet = bullet;
  const lineHeight = parseLineSpacing(pPr);
  if (lineHeight !== undefined) base.lineHeight = lineHeight;
  return Object.keys(base).length ? base : undefined;
}

export function parseTextStyleLevels(container: Element | null | undefined, colorCtx: ColorContext, fonts: FontScheme): TextStyleLevels | null {
  if (!container) return null;
  const def = parseParagraphLevelStyle(findChild(container, "defPPr"), colorCtx, fonts);
  const levels: (TextLevelStyle | undefined)[] = Array.from({ length: 9 }, (_, index) =>
    parseParagraphLevelStyle(findChild(container, `lvl${index + 1}pPr`), colorCtx, fonts),
  );
  if (!def && levels.every((item) => !item)) return null;
  return { def, levels };
}

export function mergeTextLevelStyles(...styles: (TextLevelStyle | undefined)[]): TextLevelStyle {
  const out: TextLevelStyle = {};
  for (const style of styles) {
    if (!style) continue;
    if (style.fontSizePt !== undefined) out.fontSizePt = style.fontSizePt;
    if (style.bold !== undefined) out.bold = style.bold;
    if (style.italic !== undefined) out.italic = style.italic;
    if (style.underline !== undefined) out.underline = style.underline;
    if (style.strike !== undefined) out.strike = style.strike;
    if (style.color !== undefined) out.color = style.color;
    if (style.fontFace !== undefined) out.fontFace = style.fontFace;
    if (style.align !== undefined) out.align = style.align;
    if (style.bullet !== undefined) out.bullet = style.bullet;
    if (style.lineHeight !== undefined) out.lineHeight = style.lineHeight;
  }
  return out;
}

export function pickLevelStyle(levels: TextStyleLevels | null | undefined, level: number): TextLevelStyle | undefined {
  if (!levels) return undefined;
  const idx = Math.max(0, Math.min(8, level));
  return mergeTextLevelStyles(levels.def, levels.levels[idx]);
}

function parseColorScheme(clrScheme: Element | null): ColorScheme {
  const colors: ColorScheme = { ...DEFAULT_COLOR_SCHEME };
  if (!clrScheme) return colors;
  const tempCtx: ColorContext = { scheme: colors, map: DEFAULT_COLOR_MAP };
  for (const slot of childElements(clrScheme)) {
    const key = localName(slot);
    const resolved = resolveColorFromParent(slot, tempCtx);
    if (resolved) colors[key] = resolved.hex.slice(1);
  }
  return colors;
}

function pickTypeface(fontGroup: Element | null): string {
  if (!fontGroup) return "";
  const latin = attr(findChild(fontGroup, "latin"), "typeface") ?? "";
  if (latin) return latin;
  const ea = attr(findChild(fontGroup, "ea"), "typeface") ?? "";
  if (ea) return ea;
  return attr(findChild(fontGroup, "cs"), "typeface") ?? "";
}

export function parseThemeDoc(doc: Document | null): ParsedTheme {
  const fallback: ParsedTheme = {
    colors: { ...DEFAULT_COLOR_SCHEME },
    fonts: { major: "Calibri", minor: "Calibri" },
    fillStyles: [],
    lineStyles: [],
    bgFillStyles: [],
  };
  if (!doc?.documentElement) return fallback;
  const elements = findChild(doc.documentElement, "themeElements") ?? doc.documentElement;
  const colors = parseColorScheme(findChild(elements, "clrScheme"));
  const fontScheme = findChild(elements, "fontScheme");
  const fonts: FontScheme = {
    major: pickTypeface(findChild(fontScheme, "majorFont")) || "Calibri",
    minor: pickTypeface(findChild(fontScheme, "minorFont")) || "Calibri",
  };
  const fmtScheme = findChild(elements, "fmtScheme");
  return {
    colors,
    fonts,
    fillStyles: childElements(findChild(fmtScheme, "fillStyleLst")),
    lineStyles: childElements(findChild(fmtScheme, "lnStyleLst")),
    bgFillStyles: childElements(findChild(fmtScheme, "bgFillStyleLst")),
  };
}

export function parseColorMap(el: Element | null, fallback: ColorMap = DEFAULT_COLOR_MAP): ColorMap {
  if (!el) return { ...fallback };
  const map: ColorMap = { ...fallback };
  for (const key of Object.keys(DEFAULT_COLOR_MAP)) {
    const val = attr(el, key);
    if (val) map[key] = val;
  }
  return map;
}

export function applyColorMapOverride(root: Element | null, base: ColorMap): ColorMap {
  const ovr = findChild(root, "clrMapOvr");
  if (!ovr) return base;
  const overrideMapping = findChild(ovr, "overrideClrMapping");
  if (!overrideMapping) return base;
  return parseColorMap(overrideMapping, base);
}

/** 要素のプレースホルダー情報（<p:ph type="..." idx="..."/>）を読む。なければ null。 */
export function readPlaceholderInfo(shapeEl: Element): { type: string; idx: string | null } | null {
  const nv = findChild(shapeEl, "nvSpPr") ?? findChild(shapeEl, "nvPicPr") ?? findChild(shapeEl, "nvGraphicFramePr") ?? findChild(shapeEl, "nvCxnSpPr");
  const nvPr = findChild(nv, "nvPr");
  const ph = findChild(nvPr, "ph");
  if (!ph) return null;
  const type = attr(ph, "type") ?? "body";
  const idx = attr(ph, "idx");
  return { type, idx };
}

function collectPlaceholdersAndBgShapes(
  spTree: Element | null,
  colorCtx: ColorContext,
  fonts: FontScheme,
): { placeholders: PlaceholderEntry[]; backgroundShapes: Element[] } {
  const placeholders: PlaceholderEntry[] = [];
  const backgroundShapes: Element[] = [];
  if (!spTree) return { placeholders, backgroundShapes };
  for (const child of childElements(spTree)) {
    const tag = localName(child);
    if (tag === "nvGrpSpPr" || tag === "grpSpPr") continue;
    if (tag === "sp" || tag === "pic" || tag === "graphicFrame" || tag === "cxnSp") {
      const ph = readPlaceholderInfo(child);
      if (ph) {
        const txBody = findChild(child, "txBody");
        const lstStyle = parseTextStyleLevels(findChild(txBody, "lstStyle"), colorCtx, fonts);
        placeholders.push({ type: ph.type, idx: ph.idx, element: child, lstStyle });
      } else {
        backgroundShapes.push(child);
      }
    } else if (tag === "grpSp" || tag === "AlternateContent") {
      backgroundShapes.push(child);
    }
  }
  return { placeholders, backgroundShapes };
}

/** プレースホルダーの一致検索（idx 優先、次に type の同義グループで一致）。 */
export function matchPlaceholder(list: PlaceholderEntry[], type: string, idx: string | null): PlaceholderEntry | null {
  if (idx !== null) {
    const byIdx = list.find((entry) => entry.idx === idx);
    if (byIdx) return byIdx;
  }
  const exact = list.find((entry) => entry.type === type);
  if (exact) return exact;
  if (type === "ctrTitle") return list.find((entry) => entry.type === "title") ?? null;
  if (type === "title") return list.find((entry) => entry.type === "ctrTitle") ?? null;
  if (type === "subTitle" || type === "obj" || type === "pic" || type === "tbl" || type === "chart" || type === "dgm") {
    return list.find((entry) => entry.type === "body") ?? null;
  }
  return null;
}

const REL_THEME = "/theme";
const REL_THEME_OVERRIDE = "/themeoverride";
const REL_SLIDE_MASTER = "/slidemaster";
const REL_SLIDE_LAYOUT = "/slidelayout";

export function findRelByTypeSuffix(rels: Map<string, RelEntry>, suffix: string): RelEntry | null {
  const lower = suffix.toLowerCase();
  for (const rel of rels.values()) {
    if (!rel.external && rel.resolvedPath && rel.type.toLowerCase().endsWith(lower)) return rel;
  }
  return null;
}

export function findThemeRel(rels: Map<string, RelEntry>): RelEntry | null {
  return findRelByTypeSuffix(rels, REL_THEME);
}

export async function loadMaster(
  zip: SafePptxZip,
  masterPath: string,
  cache: Map<string, ParsedMaster>,
  signal?: AbortSignal,
): Promise<ParsedMaster> {
  const cached = cache.get(masterPath.toLowerCase());
  if (cached) return cached;
  const doc = await zip.readXml(masterPath, signal);
  const rels = await zip.readRels(masterPath, signal);
  const themeRel = findThemeRel(rels);
  const themeDoc = themeRel?.resolvedPath ? await zip.readXml(themeRel.resolvedPath, signal) : null;
  const theme = parseThemeDoc(themeDoc);
  const root = doc?.documentElement ?? null;
  const colorMap = parseColorMap(findChild(root, "clrMap"));
  const colorCtx: ColorContext = { scheme: theme.colors, map: colorMap };
  const cSld = findChild(root, "cSld");
  const bgElement = findChild(cSld, "bg");
  const spTree = findChild(cSld, "spTree");
  const { placeholders, backgroundShapes } = collectPlaceholdersAndBgShapes(spTree, colorCtx, theme.fonts);
  const txStylesEl = findChild(root, "txStyles");
  const parsed: ParsedMaster = {
    path: masterPath,
    rels,
    theme,
    colorMap,
    bgElement,
    placeholders,
    backgroundShapes,
    txStyles: {
      title: parseTextStyleLevels(findChild(txStylesEl, "titleStyle"), colorCtx, theme.fonts),
      body: parseTextStyleLevels(findChild(txStylesEl, "bodyStyle"), colorCtx, theme.fonts),
      other: parseTextStyleLevels(findChild(txStylesEl, "otherStyle"), colorCtx, theme.fonts),
    },
  };
  cache.set(masterPath.toLowerCase(), parsed);
  return parsed;
}

function mergeThemeOverride(base: ParsedTheme, overrideDoc: Document | null): ParsedTheme {
  if (!overrideDoc?.documentElement) return base;
  const clr = findChild(overrideDoc.documentElement, "clrScheme");
  const font = findChild(overrideDoc.documentElement, "fontScheme");
  if (!clr && !font) return base;
  return {
    ...base,
    colors: clr ? parseColorScheme(clr) : base.colors,
    fonts: font ? {
      major: pickTypeface(findChild(font, "majorFont")) || base.fonts.major,
      minor: pickTypeface(findChild(font, "minorFont")) || base.fonts.minor,
    } : base.fonts,
  };
}

export async function loadLayout(
  zip: SafePptxZip,
  layoutPath: string,
  layoutCache: Map<string, ParsedLayout>,
  masterCache: Map<string, ParsedMaster>,
  fallbackMaster: ParsedMaster | null,
  signal?: AbortSignal,
): Promise<ParsedLayout | null> {
  const cached = layoutCache.get(layoutPath.toLowerCase());
  if (cached) return cached;
  const doc = await zip.readXml(layoutPath, signal);
  if (!doc?.documentElement) return null;
  const rels = await zip.readRels(layoutPath, signal);
  const masterRel = findRelByTypeSuffix(rels, REL_SLIDE_MASTER);
  const master = masterRel?.resolvedPath
    ? await loadMaster(zip, masterRel.resolvedPath, masterCache, signal)
    : fallbackMaster;
  if (!master) return null;

  const ovrRel = findRelByTypeSuffix(rels, REL_THEME_OVERRIDE);
  const ovrDoc = ovrRel?.resolvedPath ? await zip.readXml(ovrRel.resolvedPath, signal) : null;
  const theme = mergeThemeOverride(master.theme, ovrDoc);
  const root = doc.documentElement;
  const colorMap = applyColorMapOverride(root, master.colorMap);
  const colorCtx: ColorContext = { scheme: theme.colors, map: colorMap };
  const cSld = findChild(root, "cSld");
  const bgElement = findChild(cSld, "bg");
  const spTree = findChild(cSld, "spTree");
  const showMasterSp = boolAttr(root, "showMasterSp") !== false;
  const { placeholders, backgroundShapes } = collectPlaceholdersAndBgShapes(spTree, colorCtx, theme.fonts);
  const parsed: ParsedLayout = {
    path: layoutPath,
    rels,
    master,
    theme,
    colorMap,
    bgElement,
    showMasterSp,
    placeholders,
    backgroundShapes,
  };
  layoutCache.set(layoutPath.toLowerCase(), parsed);
  return parsed;
}

export function findLayoutRel(rels: Map<string, RelEntry>): RelEntry | null {
  return findRelByTypeSuffix(rels, REL_SLIDE_LAYOUT);
}

/** 発表資料全体の章分け（p14:sectionLst）を読み、スライド ID（p:sldId/@id）→ 章の名前の対応を返す。 */
export function parseSections(presRoot: Element): Map<string, string> {
  const out = new Map<string, string>();
  const sectionLst = findDescendant(presRoot, "sectionLst");
  if (!sectionLst) return out;
  const sections = findChildren(sectionLst, "section");
  sections.forEach((section, index) => {
    const name = (attr(section, "name") ?? "").trim();
    const sldIdLst = findChild(section, "sldIdLst");
    const first = findChild(sldIdLst, "sldId");
    const id = attr(first, "id");
    // 先頭の章が無名（既定のセクション）のときは section を付けない。
    if (id && (index > 0 || name)) out.set(id, name);
  });
  return out;
}

/** PPTX の主題フォントと背景の明暗から、一番近い NoteFable の DeckTheme を選ぶ（往復変換の精度を高める）。 */
export function matchDeckTheme(fonts: FontScheme, dark: boolean): DeckTheme {
  const major = fonts.major.toLowerCase();
  const minor = fonts.minor.toLowerCase();
  const matched = SLIDE_THEMES.find((theme) => {
    const heading = theme.heading;
    const body = theme.body;
    // SLIDE_FONTS の PPTX 書体名と一致させる。
    const map: Record<string, string> = {
      inter: "inter",
      playfair: "playfair display",
      sourceSerif: "source serif 4",
      montserrat: "montserrat",
      openSans: "open sans",
      spaceGrotesk: "space grotesk",
      dmSans: "dm sans",
      fraunces: "fraunces",
      workSans: "work sans",
      nunito: "nunito",
      jetbrainsMono: "jetbrains mono",
      notoSerif: "noto serif",
      notoSans: "noto sans",
    };
    return map[heading] === major && map[body] === minor;
  }) ?? SLIDE_THEMES.find((theme) => {
    const headingMap: Record<string, string> = {
      playfair: "playfair display",
      montserrat: "montserrat",
      spaceGrotesk: "space grotesk",
      fraunces: "fraunces",
      nunito: "nunito",
      jetbrainsMono: "jetbrains mono",
      notoSerif: "noto serif",
    };
    return headingMap[theme.heading] === major;
  });
  return { id: matched?.id ?? "simple", mode: dark ? "dark" : "light" };
}

export function extractRelId(el: Element | null | undefined): string | null {
  return attrLocal(el, "id");
}
