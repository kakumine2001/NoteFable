import { msg } from "@/lib/i18n/translate";
import {
  DEFAULT_TEXT_STYLE, newId, type ImageElement, type LayoutId, type Role, type Slide, type SlideElement, type TextElement, type TextStyle,
} from "@/lib/slides/model";
import { isRichDocEmpty, normalizeRichDoc, richBulletsFromText, richDocFromText, type RichDoc } from "@/lib/slides/rich-text";

// 8 つの版式（標題・章・要点・2 段・図と文・引用・全面の画像・空白）。それぞれ役目ごとの置き場所（プレースホルダー）を持つ。
// 版式を替えるときは、役目の合う要素を新しい置き場所へ移して中身を残す（applyLayout）。

type Placeholder = { role: Role; x: number; y: number; w: number; h: number; style?: Partial<TextStyle>; fill?: "surface" | null; list?: boolean };
export type LayoutDefinition = { id: LayoutId; name: string; placeholders: Placeholder[] };

const titleStyle: Partial<TextStyle> = { font: "heading", color: "heading", bold: true, lineHeight: 1.1 };
const top = (role: Role, list = false): Placeholder => ({ role, x: 120, y: 290, w: 1680, h: 690, style: { size: 44 }, list });

export const LAYOUTS: LayoutDefinition[] = [
  {
    id: "title", name: msg("Title"), placeholders: [
      { role: "title", x: 160, y: 300, w: 1600, h: 280, style: { ...titleStyle, size: 120, align: "center", valign: "bottom" } },
      { role: "subtitle", x: 160, y: 620, w: 1600, h: 160, style: { size: 48, color: "muted", align: "center" } },
    ],
  },
  {
    id: "section", name: msg("Section"), placeholders: [
      { role: "subtitle", x: 160, y: 330, w: 1600, h: 100, style: { size: 40, color: "accent", bold: true, valign: "bottom" } },
      { role: "title", x: 160, y: 450, w: 1600, h: 300, style: { ...titleStyle, size: 112 } },
    ],
  },
  {
    id: "bullets", name: msg("Bullets"), placeholders: [
      { role: "title", x: 120, y: 80, w: 1680, h: 170, style: { ...titleStyle, size: 76, valign: "bottom" } },
      top("body", true),
    ],
  },
  {
    id: "twoColumn", name: msg("Two columns"), placeholders: [
      { role: "title", x: 120, y: 80, w: 1680, h: 170, style: { ...titleStyle, size: 76, valign: "bottom" } },
      { role: "body", x: 120, y: 290, w: 810, h: 690, style: { size: 40 }, list: true },
      { role: "body2", x: 990, y: 290, w: 810, h: 690, style: { size: 40 }, list: true },
    ],
  },
  {
    id: "imageText", name: msg("Image and text"), placeholders: [
      { role: "title", x: 120, y: 120, w: 840, h: 260, style: { ...titleStyle, size: 72, valign: "bottom" } },
      { role: "body", x: 120, y: 420, w: 840, h: 560, style: { size: 40 } },
      { role: "image", x: 1040, y: 0, w: 880, h: 1080 },
    ],
  },
  {
    id: "quote", name: msg("Quote"), placeholders: [
      { role: "quote", x: 200, y: 260, w: 1520, h: 440, style: { font: "heading", size: 76, italic: true, align: "center", valign: "middle", color: "heading", lineHeight: 1.2 } },
      { role: "attribution", x: 200, y: 740, w: 1520, h: 90, style: { size: 36, color: "muted", align: "center" } },
    ],
  },
  {
    id: "fullImage", name: msg("Full image"), placeholders: [
      { role: "image", x: 0, y: 0, w: 1920, h: 1080 },
      { role: "caption", x: 80, y: 900, w: 1000, h: 110, style: { size: 36, valign: "middle" }, fill: "surface" },
    ],
  },
  { id: "blank", name: msg("Blank"), placeholders: [] },
];

export function layoutDefinition(id: LayoutId): LayoutDefinition {
  return LAYOUTS.find((layout) => layout.id === id) ?? LAYOUTS[LAYOUTS.length - 1];
}

// 置き場所が空のときに編集画面で出す案内（放映・書き出しでは出さない）。
export const ROLE_HINTS: Record<Role, string> = {
  title: msg("Click to add title"),
  subtitle: msg("Click to add subtitle"),
  body: msg("Click to add text"),
  body2: msg("Click to add text"),
  image: msg("Add an image"),
  quote: msg("Click to add a quote"),
  attribution: msg("Click to add the source"),
  caption: msg("Click to add a caption"),
};

function placeholderStyle(placeholder: Placeholder): TextStyle {
  return { ...DEFAULT_TEXT_STYLE, ...placeholder.style };
}

function emptyDoc(placeholder: Placeholder): RichDoc {
  return placeholder.list ? richBulletsFromText("") : richDocFromText("");
}

function makePlaceholder(placeholder: Placeholder): SlideElement {
  const frame = { id: newId(), x: placeholder.x, y: placeholder.y, w: placeholder.w, h: placeholder.h, rotation: 0, role: placeholder.role };
  if (placeholder.role === "image") return { ...frame, type: "image", src: "", alt: "", fit: "cover", radius: 0 } satisfies ImageElement;
  return { ...frame, type: "text", doc: emptyDoc(placeholder), style: placeholderStyle(placeholder), fill: placeholder.fill ?? null, autoHeight: false } satisfies TextElement;
}

// 新しい 1 枚（版式の置き場所つき）。text は役目ごとの最初の文字（AI や「スライドを追加」用）。
export function createSlide(layout: LayoutId, text: Partial<Record<Role, string>> = {}): Slide {
  const elements = layoutDefinition(layout).placeholders.map((placeholder) => {
    const element = makePlaceholder(placeholder);
    const value = text[placeholder.role];
    if (value && element.type === "text") element.doc = placeholder.list ? richBulletsFromText(value) : richDocFromText(value);
    return element;
  });
  return { id: newId(), layout, elements };
}

// 役目が合わないときに中身を移す先の候補（前から順に探す）。
const FALLBACK_ROLES: Record<Role, Role[]> = {
  title: ["title", "quote"],
  subtitle: ["subtitle", "attribution", "caption"],
  body: ["body", "quote", "body2", "caption"],
  body2: ["body2"],
  image: ["image"],
  quote: ["quote", "body", "title"],
  attribution: ["attribution", "subtitle", "caption"],
  caption: ["caption", "subtitle", "attribution", "body"],
};

// 置き場所の要素に中身があるか（空の置き場所は版式を替えると消える。図形・線・表は見た目自体が中身なので常に残す）。
export function placeholderHasContent(element: SlideElement): boolean {
  if (element.type === "text") return !isRichDocEmpty(element.doc);
  if (element.type === "image") return Boolean(element.src || element.pendingImagePrompt);
  if (element.type === "whiteboard") return Boolean(element.src);
  return true;
}

// 版式を替える。新しい版式の置き場所ごとに、役目の合う要素（なければ候補の役目）を移して大きさと書式を合わせる。
// 移らなかった置き場所の要素は、中身があればその場に残して自由な要素にし（中身を消さない）、空なら消す。自由に置いた要素はそのまま。
export function applyLayout(slide: Slide, layout: LayoutId): Slide {
  const definition = layoutDefinition(layout);
  const placeholders = slide.elements.filter((element) => element.role);
  const used = new Set<string>();
  const placed = new Map<Role, SlideElement>();
  for (const placeholder of definition.placeholders) {
    const candidates = FALLBACK_ROLES[placeholder.role];
    let source: SlideElement | undefined;
    for (const role of candidates) {
      source = placeholders.find((element) => !used.has(element.id) && element.role === role
        && (placeholder.role === "image" ? element.type === "image" || element.type === "whiteboard" : element.type === "text"));
      if (source) break;
    }
    if (!source) { placed.set(placeholder.role, makePlaceholder(placeholder)); continue; }
    used.add(source.id);
    const frame = { x: placeholder.x, y: placeholder.y, w: placeholder.w, h: placeholder.h, rotation: 0, role: placeholder.role };
    if (source.type === "text") {
      placed.set(placeholder.role, { ...source, ...frame, style: placeholderStyle(placeholder), fill: placeholder.fill ?? null, doc: normalizeRichDoc(source.doc), autoHeight: false });
    } else {
      placed.set(placeholder.role, { ...source, ...frame });
    }
  }
  const elements: SlideElement[] = [];
  // 置き場所は版式の順に後ろへ（画像は先＝奥）、自由な要素の前後関係は保つ。
  for (const placeholder of definition.placeholders) {
    const element = placed.get(placeholder.role);
    if (element && placeholder.role === "image") elements.push(element);
  }
  for (const element of slide.elements) {
    if (!element.role) { elements.push(element); continue; }
    if (used.has(element.id)) continue;
    // 移らなかった置き場所：中身があれば自由な要素として残す。
    if (placeholderHasContent(element)) {
      const { role: _role, ...free } = element;
      void _role;
      elements.push(free as SlideElement);
    }
  }
  for (const placeholder of definition.placeholders) {
    const element = placed.get(placeholder.role);
    if (element && placeholder.role !== "image") elements.push(element);
  }
  return { ...slide, layout, elements };
}
