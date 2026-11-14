// 原生 Android 表情选择器的数据（mobile/android/app/src/main/assets/emoji.json）。
// 网页用 emoji-picker-react（src/components/full-emoji-picker.tsx），原生版照着它做，所以表情、分类、顺序、
// 搜索用的关键词（en / zh / zh-Hant / ja）和分类按钮的图标都取自同一个包，不另找数据：
//   - 表情：emoji-picker-react/dist/data/emojis-{en,zh,zh-hant,ja}.json（四份的表情和顺序相同，只是关键词不同）；
//   - 分类按钮图标：包里的 CategoryNavIcon（渲染成 SVG 再拆成路径）；
//   - 搜索框的放大镜和清除按钮：包里 svgIcons.ts 的 MAGNIFIER_ICON / TIMES_ICON 的第一帧（浅色主题的灰色）。
// 生成：npx tsx scripts/gen-native-emoji.ts；src/lib/native-emoji-asset.test.ts 检查资源是否过期（升级包后要重新生成）。
import { createRequire } from "node:module";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

export const NATIVE_EMOJI_ASSET = "mobile/android/app/src/main/assets/emoji.json";

const require = createRequire(import.meta.url);
const packageDir = path.dirname(require.resolve("emoji-picker-react/package.json"));

// 网页 full-emoji-picker.tsx 的 EMOJI_DATA 的键 → 包里的数据文件。
const LOCALES = { en: "en", zh: "zh", "zh-Hant": "zh-hant", ja: "ja" } as const;
type Locale = keyof typeof LOCALES;

// 网页 EMOJI_CATEGORIES 的顺序（suggested 是"最近使用"，没有固定表情）。
export const CATEGORIES = [
  "suggested", "smileys_people", "animals_nature", "food_drink", "travel_places",
  "activities", "objects", "symbols", "flags",
] as const;

type RawEmoji = { n: string[]; u: string; a: string; v?: string[] };
type RawData = { emojis: Record<string, RawEmoji[]> };

/** 一个图形：SVG 的 path（circle 换成等价的 path）和它的画法。坐标仍是原 SVG 的。 */
export type Shape = { d: string; fill: boolean; stroke: boolean; strokeWidth: number; round: boolean; evenOdd: boolean };
export type Icon = { viewBox: [number, number, number, number]; shapes: Shape[] };

export type NativeEmojiData = {
  categories: string[];
  icons: Record<string, Icon>;
  /** 每个表情：u = 码点（-连接），c = categories 的下标，v = 肤色变体，n = 各语言的关键词（最后一个是名称，网页拿它当 aria-label）。 */
  emojis: { u: string; c: number; v?: string[]; n: Record<Locale, string[]> }[];
};

function loadData(file: string): RawData {
  return require(path.join(packageDir, "dist/data", `emojis-${file}.json`)) as RawData;
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of tag.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) out[match[1]] = match[2];
  return out;
}

function circlePath(cx: number, cy: number, r: number) {
  return `M${cx - r},${cy}a${r},${r} 0 1,0 ${r * 2},0a${r},${r} 0 1,0 ${-r * 2},0z`;
}

/** 把一段 SVG 拆成图形。fill / stroke 继承 <svg> 上的默认值（[defaults]）。 */
export function svgShapes(svg: string, defaults: { fill: string; stroke: string }): Shape[] {
  const shapes: Shape[] = [];
  for (const match of svg.matchAll(/<(path|circle)\b[^>]*>/g)) {
    const a = attrs(match[0]);
    const d = match[1] === "path" ? a.d : circlePath(Number(a.cx), Number(a.cy), Number(a.r));
    const fill = (a.fill ?? defaults.fill) !== "none";
    const stroke = (a.stroke ?? defaults.stroke) !== "none";
    shapes.push({
      d,
      fill,
      stroke,
      strokeWidth: a["stroke-width"] ? Number(a["stroke-width"]) : 1,
      round: a["stroke-linecap"] === "round",
      evenOdd: a["fill-rule"] === "evenodd",
    });
  }
  return shapes;
}

async function categoryIcons(): Promise<Record<string, Icon>> {
  const { CategoryNavIcon } = await import(pathToImport("src/components/navigation/CategoryNavIcon.tsx"));
  const icons: Record<string, Icon> = {};
  for (const category of CATEGORIES) {
    const svg = renderToStaticMarkup(createElement(CategoryNavIcon, { category }));
    const viewBox = attrs(svg.slice(0, svg.indexOf(">") + 1)).viewBox.split(/\s+/).map(Number) as Icon["viewBox"];
    icons[category] = { viewBox, shapes: svgShapes(svg, { fill: "none", stroke: "currentColor" }) };
  }
  return icons;
}

function pathToImport(relative: string) {
  return "file://" + path.join(packageDir, relative).replace(/\\/g, "/");
}

/** svgIcons.ts 的雪碧图（每帧 20 高）只取浅色主题的第一帧：灰色 #868686 的那些路径。 */
async function spriteIcons(): Promise<Record<string, Icon>> {
  const sprites = await import(pathToImport("src/components/icons/svgIcons.ts"));
  const firstFrame = (uri: string): Icon => {
    const svg = decodeURIComponent(uri.replace(/^data:image\/svg\+xml,/, ""));
    const gray = [...svg.matchAll(/<path\b[^>]*>/g)].map((m) => m[0]).filter((tag) => /fill='#868686'/.test(tag));
    return { viewBox: [0, 0, 20, 20], shapes: svgShapes(gray.join("").replace(/'/g, '"'), { fill: "black", stroke: "none" }) };
  };
  return { search: firstFrame(sprites.MAGNIFIER_ICON), clear: firstFrame(sprites.TIMES_ICON) };
}

export async function nativeEmojiData(): Promise<NativeEmojiData> {
  const data = Object.fromEntries(
    Object.entries(LOCALES).map(([locale, file]) => [locale, loadData(file)]),
  ) as Record<Locale, RawData>;
  const emojis: NativeEmojiData["emojis"] = [];
  CATEGORIES.forEach((category, index) => {
    const lists = Object.fromEntries(
      (Object.keys(LOCALES) as Locale[]).map((locale) => [locale, data[locale].emojis[category] ?? []]),
    ) as Record<Locale, RawEmoji[]>;
    lists.en.forEach((emoji, position) => {
      const names = {} as Record<Locale, string[]>;
      for (const locale of Object.keys(LOCALES) as Locale[]) {
        const same = lists[locale][position];
        if (!same || same.u !== emoji.u) throw new Error(`emoji data out of order: ${locale} ${category} ${emoji.u}`);
        names[locale] = same.n;
      }
      emojis.push({ u: emoji.u, c: index, ...(emoji.v?.length ? { v: emoji.v } : {}), n: names });
    });
  });
  return { categories: [...CATEGORIES], icons: { ...(await categoryIcons()), ...(await spriteIcons()) }, emojis };
}

export async function nativeEmojiJson(): Promise<string> {
  return JSON.stringify(await nativeEmojiData()) + "\n";
}
