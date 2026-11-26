import { isLocale, type Locale } from "@/lib/i18n/locale";
import { isRecordId } from "@/lib/page-ai/ids";
import type { DeckTheme } from "@/lib/slides/model";
import { SLIDE_THEMES } from "@/lib/slides/themes";
import { MAX_MESSAGE_NOTES } from "@/types/chat";

// 「AI でスライドを作る」の、画面（ウィザード）とサーバーが共有する形と上限（docs/architecture/slides.md の「AI 生成幻灯片」）。
// prisma と DOM は使わない。parse* は壊れた値・上限を超えた値に null を返し、ルートは 400 にする。

export type SlidesSource =
  | { type: "topic"; topic: string }
  | { type: "notes"; pageIds: string[] }
  | { type: "chat"; sessionId: string };

export const SLIDES_TONES = ["auto", "professional", "casual", "academic", "persuasive"] as const;
export type SlidesTone = (typeof SLIDES_TONES)[number];
export const SLIDES_WORDINGS = ["condense", "keep"] as const;
export type SlidesWording = (typeof SLIDES_WORDINGS)[number];

export type SlidesOptions = {
  // 表紙を含む全体の枚数。
  pageCount: "auto" | number;
  tone: SlidesTone;
  audience: string;
  // auto は材料（テーマ）の言語。
  language: "auto" | Locale;
  wording: SlidesWording;
  theme: DeckTheme;
};

// 表紙は slides に含めない。
export type SlidesOutline = { title: string; slides: { title: string; points: string[] }[] };

export const MAX_TOPIC_CHARS = 300;
export const MAX_SLIDES_SOURCE_NOTES = MAX_MESSAGE_NOTES;
export const MIN_PAGE_COUNT = 3;
export const MAX_PAGE_COUNT = 30;
export const MAX_AUDIENCE_CHARS = 200;
export const MAX_OUTLINE_TITLE_CHARS = 200;
export const MAX_OUTLINE_SLIDES = MAX_PAGE_COUNT - 1;
export const MAX_SLIDE_TITLE_CHARS = 200;
export const MAX_SLIDE_POINTS = 12;
export const MAX_POINT_CHARS = 500;

export const DEFAULT_SLIDES_OPTIONS: SlidesOptions = {
  pageCount: "auto", tone: "auto", audience: "", language: "auto", wording: "condense", theme: { id: "simple", mode: "light" },
};

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
// PostgreSQL の jsonb と上流の API が受け付けない文字（NUL は除き、片方だけのサロゲートは置き換える）。
export const cleanText = (text: string) => text.replace(/\u0000/g, "").replace(LONE_SURROGATE, "\uFFFD");
// 改行と続く空白を 1 つの空白にした 1 行。
export const oneLine = (text: string) => cleanText(text).replace(/\s+/g, " ").trim();

// 1 行にして 1〜max 文字ならその文字列。それ以外は null。
function line(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = oneLine(value);
  return text && text.length <= max ? text : null;
}

export function parseSource(value: unknown): SlidesSource | null {
  if (!object(value)) return null;
  if (value.type === "topic") {
    const topic = line(value.topic, MAX_TOPIC_CHARS);
    return topic ? { type: "topic", topic } : null;
  }
  if (value.type === "notes") {
    const ids = value.pageIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > MAX_SLIDES_SOURCE_NOTES) return null;
    if (!ids.every(isRecordId) || new Set(ids).size !== ids.length) return null;
    return { type: "notes", pageIds: [...ids] };
  }
  if (value.type === "chat" && isRecordId(value.sessionId)) return { type: "chat", sessionId: value.sessionId };
  return null;
}

// 省略した項目は既定値。値があるのに違うものは null。
export function parseOptions(value: unknown): SlidesOptions | null {
  if (value === undefined) return { ...DEFAULT_SLIDES_OPTIONS, theme: { ...DEFAULT_SLIDES_OPTIONS.theme } };
  if (!object(value)) return null;
  const {
    pageCount = DEFAULT_SLIDES_OPTIONS.pageCount, tone = DEFAULT_SLIDES_OPTIONS.tone, audience = DEFAULT_SLIDES_OPTIONS.audience,
    language = DEFAULT_SLIDES_OPTIONS.language, wording = DEFAULT_SLIDES_OPTIONS.wording, theme = {},
  } = value;
  if (pageCount !== "auto" && !(Number.isInteger(pageCount) && (pageCount as number) >= MIN_PAGE_COUNT && (pageCount as number) <= MAX_PAGE_COUNT)) return null;
  if (!SLIDES_TONES.includes(tone as SlidesTone) || !SLIDES_WORDINGS.includes(wording as SlidesWording)) return null;
  if (typeof audience !== "string" || oneLine(audience).length > MAX_AUDIENCE_CHARS) return null;
  if (language !== "auto" && !isLocale(language)) return null;
  if (!object(theme)) return null;
  const { id = DEFAULT_SLIDES_OPTIONS.theme.id, mode = DEFAULT_SLIDES_OPTIONS.theme.mode } = theme;
  if (!SLIDE_THEMES.some((entry) => entry.id === id) || (mode !== "light" && mode !== "dark")) return null;
  return {
    pageCount: pageCount as SlidesOptions["pageCount"], tone: tone as SlidesTone, audience: oneLine(audience), language,
    wording: wording as SlidesWording, theme: { id: id as string, mode },
  };
}

// 空の要点は捨てる。それ以外の欠け・超過は null。
export function parseOutline(value: unknown): SlidesOutline | null {
  if (!object(value)) return null;
  const title = line(value.title, MAX_OUTLINE_TITLE_CHARS);
  if (!title || !Array.isArray(value.slides) || !value.slides.length || value.slides.length > MAX_OUTLINE_SLIDES) return null;
  const slides: SlidesOutline["slides"] = [];
  for (const slide of value.slides) {
    if (!object(slide)) return null;
    const slideTitle = line(slide.title, MAX_SLIDE_TITLE_CHARS);
    const raw = slide.points ?? [];
    if (!slideTitle || !Array.isArray(raw) || !raw.every((point) => typeof point === "string")) return null;
    const points = (raw as string[]).map(oneLine).filter(Boolean);
    if (points.length > MAX_SLIDE_POINTS || points.some((point) => point.length > MAX_POINT_CHARS)) return null;
    slides.push({ title: slideTitle, points });
  }
  return { title, slides };
}
