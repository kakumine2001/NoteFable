import type { ColorScheme, ColorMap } from "@/lib/slides/pptx/theme-master";

// DrawingML（a:*）の色指定と変換（lumMod / lumOff / tint / shade / satMod / hueMod / alpha など）を #rrggbb に解決する。

export type ResolvedColor = {
  hex: `#${string}`;
  alpha: number; // 0..1
};

export type ColorContext = {
  scheme: ColorScheme;
  map: ColorMap;
  /** スタイル参照（fillRef / lnRef / fontRef）から渡される phClr。 */
  phClr?: ResolvedColor | null;
};

// DrawingML の既定色（ST_PresetColorVal）の主要・標準一覧。
const PRESET_COLORS: Record<string, string> = {
  aliceBlue: "f0f8ff", antiqueWhite: "faebd7", aqua: "00ffff", aquamarine: "7fffd4", azure: "f0ffff",
  beige: "f5f5dc", bisque: "ffe4c4", black: "000000", blanchedAlmond: "ffebcd", blue: "0000ff",
  blueViolet: "8a2be2", brown: "a52a2a", burlyWood: "deb887", cadetBlue: "5f9ea0", chartreuse: "7fff00",
  chocolate: "d2691e", coral: "ff7f50", cornflowerBlue: "6495ed", cornsilk: "fff8dc", crimson: "dc143c",
  cyan: "00ffff", darkBlue: "00008b", darkCyan: "008b8b", darkGoldenrod: "b8860b", darkGray: "a9a9a9",
  darkGreen: "006400", darkGrey: "a9a9a9", darkKhaki: "bdb76b", darkMagenta: "8b008b", darkOliveGreen: "556b2f",
  darkOrange: "ff8c00", darkOrchid: "9932cc", darkRed: "8b0000", darkSalmon: "e9967a", darkSeaGreen: "8fbc8f",
  darkSlateBlue: "483d8b", darkSlateGray: "2f4f4f", darkSlateGrey: "2f4f4f", darkTurquoise: "00ced1",
  darkViolet: "9400d3", deepPink: "ff1493", deepSkyBlue: "00bfff", dimGray: "696969", dimGrey: "696969",
  dkBlue: "00008b", dkCyan: "008b8b", dkGoldenrod: "b8860b", dkGray: "a9a9a9", dkGreen: "006400",
  dkGrey: "a9a9a9", dkKhaki: "bdb76b", dkMagenta: "8b008b", dkOliveGreen: "556b2f", dkOrange: "ff8c00",
  dkOrchid: "9932cc", dkRed: "8b0000", dkSalmon: "e9967a", dkSeaGreen: "8fbc8f", dkSlateBlue: "483d8b",
  dkSlateGray: "2f4f4f", dkSlateGrey: "2f4f4f", dkTurquoise: "00ced1", dkViolet: "9400d3",
  dodgerBlue: "1e90ff", firebrick: "b22222", floralWhite: "fffaf0", forestGreen: "228b22", fuchsia: "ff00ff",
  gainsboro: "dcdcdc", ghostWhite: "f8f8ff", gold: "ffd700", goldenrod: "daa520", gray: "808080",
  green: "008000", greenYellow: "adff2f", grey: "808080", honeydew: "f0fff0", hotPink: "ff69b4",
  indianRed: "cd5c5c", indigo: "4b0082", ivory: "fffff0", khaki: "f0e68c", lavender: "e6e6fa",
  lavenderBlush: "fff0f5", lawnGreen: "7cfc00", lemonChiffon: "fffacd", lightBlue: "add8e6", lightCoral: "f08080",
  lightCyan: "e0ffff", lightGoldenrodYellow: "fafad2", lightGray: "d3d3d3", lightGreen: "90ee90",
  lightGrey: "d3d3d3", lightPink: "ffb6c1", lightSalmon: "ffa07a", lightSeaGreen: "20b2aa",
  lightSkyBlue: "87cefa", lightSlateGray: "778899", lightSlateGrey: "778899", lightSteelBlue: "b0c4de",
  lightYellow: "ffffe0", lime: "00ff00", limeGreen: "32cd32", linen: "faf0e6", ltBlue: "add8e6",
  ltCoral: "f08080", ltCyan: "e0ffff", ltGoldenrodYellow: "fafad2", ltGray: "d3d3d3", ltGreen: "90ee90",
  ltGrey: "d3d3d3", ltPink: "ffb6c1", ltSalmon: "ffa07a", ltSeaGreen: "20b2aa", ltSkyBlue: "87cefa",
  ltSlateGray: "778899", ltSlateGrey: "778899", ltSteelBlue: "b0c4de", ltYellow: "ffffe0",
  magenta: "ff00ff", maroon: "800000", medAquamarine: "66cdaa", medBlue: "0000cd", medOrchid: "ba55d3",
  medPurple: "9370db", medSeaGreen: "3cb371", medSlateBlue: "7b68ee", medSpringGreen: "00fa9a",
  medTurquoise: "48d1cc", medVioletRed: "c71585", mediumAquamarine: "66cdaa", mediumBlue: "0000cd",
  mediumOrchid: "ba55d3", mediumPurple: "9370db", mediumSeaGreen: "3cb371", mediumSlateBlue: "7b68ee",
  mediumSpringGreen: "00fa9a", mediumTurquoise: "48d1cc", mediumVioletRed: "c71585", midnightBlue: "191970",
  mintCream: "f5fffa", mistyRose: "ffe4e1", moccasin: "ffe4b5", navajoWhite: "ffdead", navy: "000080",
  oldLace: "fdf5e6", olive: "808000", oliveDrab: "6b8e23", orange: "ffa500", orangeRed: "ff4500",
  orchid: "da70d6", paleGoldenrod: "eee8aa", paleGreen: "98fb98", paleTurquoise: "afeeee",
  paleVioletRed: "db7093", papayaWhip: "ffefd5", peachPuff: "ffdab9", peru: "cd853f", pink: "ffc0cb",
  plum: "dda0dd", powderBlue: "b0e0e6", purple: "800080", red: "ff0000", rosyBrown: "bc8f8f",
  royalBlue: "4169e1", saddleBrown: "8b4513", salmon: "fa8072", sandyBrown: "f4a460", seaGreen: "2e8b57",
  seaShell: "fff5ee", sienna: "a0522d", silver: "c0c0c0", skyBlue: "87ceeb", slateBlue: "6a5acd",
  slateGray: "708090", slateGrey: "708090", snow: "fffafa", springGreen: "00ff7f", steelBlue: "4682b4",
  tan: "d2b48c", teal: "008080", thistle: "d8bfd8", tomato: "ff6347", turquoise: "40e0d0",
  violet: "ee82ee", wheat: "f5deb3", white: "ffffff", whiteSmoke: "f5f5f5", yellow: "ffff00",
  yellowGreen: "9acd32",
};

const SYS_COLORS: Record<string, string> = {
  window: "ffffff",
  windowText: "000000",
  btnFace: "f0f0f0",
  btnText: "000000",
  highlight: "0078d7",
  highlightText: "ffffff",
  grayText: "6d6d6d",
  windowFrame: "646464",
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function parseHex6(raw: string | null | undefined): [number, number, number] | null {
  if (!raw) return null;
  const clean = raw.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null;
  return [
    parseInt(clean.slice(0, 2), 16) / 255,
    parseInt(clean.slice(2, 4), 16) / 255,
    parseInt(clean.slice(4, 6), 16) / 255,
  ];
}

export function rgbToHex(r: number, g: number, b: number): `#${string}` {
  const c = (v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 1) + 1) % 1;
  s = clamp01(s);
  l = clamp01(l);
  if (s === 0) return [l, l, l];
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

function pctAttr(el: Element, name = "val"): number | null {
  const raw = el.getAttribute(name);
  if (!raw) return null;
  if (raw.endsWith("%")) {
    const n = Number.parseFloat(raw.slice(0, -1));
    return Number.isFinite(n) ? n / 100 : null;
  }
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n / 100_000 : null;
}

function angleAttr(el: Element, name = "val"): number | null {
  const raw = el.getAttribute(name);
  if (!raw) return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n / 60_000 / 360 : null;
}

function childElements(el: Element): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < el.childNodes.length; i += 1) {
    const node = el.childNodes[i];
    if (node.nodeType === 1) out.push(node as Element);
  }
  return out;
}

function localNameOf(el: Element): string {
  const raw = el.localName || el.tagName || "";
  const colon = raw.indexOf(":");
  return colon >= 0 ? raw.slice(colon + 1) : raw;
}

function applyTransforms(node: Element, rgb: [number, number, number], alpha: number): ResolvedColor {
  let [r, g, b] = rgb;
  let a = alpha;
  for (const mod of childElements(node)) {
    const name = localNameOf(mod);
    const pct = pctAttr(mod);
    switch (name) {
      case "alpha":
        if (pct !== null) a = clamp01(pct);
        break;
      case "alphaMod":
        if (pct !== null) a = clamp01(a * pct);
        break;
      case "alphaOff":
        if (pct !== null) a = clamp01(a + pct);
        break;
      case "tint":
        // OOXML tint: color = color * tint + (1 - tint)
        if (pct !== null) {
          r = clamp01(r * pct + (1 - pct));
          g = clamp01(g * pct + (1 - pct));
          b = clamp01(b * pct + (1 - pct));
        }
        break;
      case "shade":
        // OOXML shade: color = color * shade
        if (pct !== null) {
          r = clamp01(r * pct);
          g = clamp01(g * pct);
          b = clamp01(b * pct);
        }
        break;
      case "lum":
      case "lumMod":
      case "lumOff":
      case "sat":
      case "satMod":
      case "satOff":
      case "hue":
      case "hueMod":
      case "hueOff": {
        let [h, s, l] = rgbToHsl(r, g, b);
        if (name === "lum" && pct !== null) l = clamp01(pct);
        else if (name === "lumMod" && pct !== null) l = clamp01(l * pct);
        else if (name === "lumOff" && pct !== null) l = clamp01(l + pct);
        else if (name === "sat" && pct !== null) s = clamp01(pct);
        else if (name === "satMod" && pct !== null) s = clamp01(s * pct);
        else if (name === "satOff" && pct !== null) s = clamp01(s + pct);
        else if (name === "hue") { const deg = angleAttr(mod); if (deg !== null) h = deg; }
        else if (name === "hueMod" && pct !== null) h = h * pct;
        else if (name === "hueOff") { const deg = angleAttr(mod); if (deg !== null) h = h + deg; }
        [r, g, b] = hslToRgb(h, s, l);
        break;
      }
      case "redMod": if (pct !== null) r = clamp01(r * pct); break;
      case "greenMod": if (pct !== null) g = clamp01(g * pct); break;
      case "blueMod": if (pct !== null) b = clamp01(b * pct); break;
      case "redOff": if (pct !== null) r = clamp01(r + pct); break;
      case "greenOff": if (pct !== null) g = clamp01(g + pct); break;
      case "blueOff": if (pct !== null) b = clamp01(b + pct); break;
      case "inv":
        r = 1 - r; g = 1 - g; b = 1 - b;
        break;
      case "comp": {
        const [h, s, l] = rgbToHsl(r, g, b);
        [r, g, b] = hslToRgb(h + 0.5, s, l);
        break;
      }
      case "gray": {
        const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = y; g = y; b = y;
        break;
      }
      case "gamma":
        r = Math.pow(clamp01(r), 1 / 2.2);
        g = Math.pow(clamp01(g), 1 / 2.2);
        b = Math.pow(clamp01(b), 1 / 2.2);
        break;
      case "invGamma":
        r = Math.pow(clamp01(r), 2.2);
        g = Math.pow(clamp01(g), 2.2);
        b = Math.pow(clamp01(b), 2.2);
        break;
    }
  }
  return { hex: rgbToHex(r, g, b), alpha: a };
}

/** 要素（solidFill / bgRef / fillRef / lnRef / fontRef など）の直接の子から色要素を 1 つ見つけて解決する。 */
export function resolveColorFromParent(parent: Element | null | undefined, ctx: ColorContext): ResolvedColor | null {
  if (!parent) return null;
  for (const child of childElements(parent)) {
    const resolved = resolveColorNode(child, ctx);
    if (resolved) return resolved;
  }
  return null;
}

export function resolveColorNode(node: Element, ctx: ColorContext): ResolvedColor | null {
  const name = localNameOf(node);
  let base: [number, number, number] | null = null;
  let alpha = 1;
  switch (name) {
    case "srgbClr":
      base = parseHex6(node.getAttribute("val"));
      break;
    case "sysClr":
      base = parseHex6(node.getAttribute("lastClr")) ?? parseHex6(SYS_COLORS[node.getAttribute("val") ?? ""]);
      break;
    case "prstClr": {
      const val = node.getAttribute("val") ?? "";
      base = parseHex6(PRESET_COLORS[val]);
      break;
    }
    case "scrgbClr": {
      const r = pctAttr(node, "r");
      const g = pctAttr(node, "g");
      const b = pctAttr(node, "b");
      if (r !== null && g !== null && b !== null) base = [clamp01(r), clamp01(g), clamp01(b)];
      break;
    }
    case "hslClr": {
      const h = angleAttr(node, "hue");
      const s = pctAttr(node, "sat");
      const l = pctAttr(node, "lum");
      if (h !== null && s !== null && l !== null) base = hslToRgb(h, s, l);
      break;
    }
    case "schemeClr": {
      const rawKey = node.getAttribute("val") ?? "";
      if (rawKey === "phClr") {
        if (!ctx.phClr) return null;
        base = parseHex6(ctx.phClr.hex);
        alpha = ctx.phClr.alpha;
      } else {
        const mapped = ctx.map[rawKey] ?? rawKey;
        const hex = ctx.scheme[mapped] ?? ctx.scheme[rawKey];
        base = parseHex6(hex);
      }
      break;
    }
    default:
      return null;
  }
  if (!base) return null;
  return applyTransforms(node, base, alpha);
}

/** #rrggbb の相対輝度（0..1）。背景が暗いかどうか（主題の dark / light 判定）に使う。 */
export function hexLuminance(hex: string): number {
  const rgb = parseHex6(hex);
  if (!rgb) return 1;
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
