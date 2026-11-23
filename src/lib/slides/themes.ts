import { msg } from "@/lib/i18n/translate";
import { isColorRef, type ColorRef, type ColorToken, type DeckTheme, type FontRole } from "@/lib/slides/model";

// スライドの主題：見出しと本文の書体の組み合わせ + 浅色・深色の配色。主題を替えると、主題の色名（ColorToken）と書体の役目
// （heading / body / mono）を使っている要素がそろって替わる。#rrggbb で直接指定した色はそのまま。
// 書体は Google Fonts（SIL OFL）。画面では next/font で自前配信し（src/components/slides/slide-fonts.ts の CSS 変数）、
// PPTX には書体名を書く（Google スライドにはどれもある。PowerPoint は入っていなければ代わりの書体で出す）。

export type SlideFont = { css: string; pptx: string };
export const SLIDE_FONTS = {
  inter: { css: "var(--slide-font-inter), Inter, system-ui, sans-serif", pptx: "Inter" },
  playfair: { css: "var(--slide-font-playfair), 'Playfair Display', Georgia, serif", pptx: "Playfair Display" },
  sourceSerif: { css: "var(--slide-font-source-serif), 'Source Serif 4', Georgia, serif", pptx: "Source Serif 4" },
  montserrat: { css: "var(--slide-font-montserrat), Montserrat, system-ui, sans-serif", pptx: "Montserrat" },
  openSans: { css: "var(--slide-font-open-sans), 'Open Sans', system-ui, sans-serif", pptx: "Open Sans" },
  spaceGrotesk: { css: "var(--slide-font-space-grotesk), 'Space Grotesk', system-ui, sans-serif", pptx: "Space Grotesk" },
  dmSans: { css: "var(--slide-font-dm-sans), 'DM Sans', system-ui, sans-serif", pptx: "DM Sans" },
  fraunces: { css: "var(--slide-font-fraunces), Fraunces, Georgia, serif", pptx: "Fraunces" },
  workSans: { css: "var(--slide-font-work-sans), 'Work Sans', system-ui, sans-serif", pptx: "Work Sans" },
  nunito: { css: "var(--slide-font-nunito), Nunito, system-ui, sans-serif", pptx: "Nunito" },
  jetbrainsMono: { css: "var(--slide-font-jetbrains-mono), 'JetBrains Mono', ui-monospace, monospace", pptx: "JetBrains Mono" },
  notoSerif: { css: "var(--slide-font-noto-serif), 'Noto Serif', Georgia, serif", pptx: "Noto Serif" },
  notoSans: { css: "var(--slide-font-noto-sans), 'Noto Sans', system-ui, sans-serif", pptx: "Noto Sans" },
} satisfies Record<string, SlideFont>;
export type SlideFontId = keyof typeof SLIDE_FONTS;

export type Palette = Record<ColorToken, `#${string}`>;
export type SlideTheme = { id: string; name: string; heading: SlideFontId; body: SlideFontId; light: Palette; dark: Palette };

const palette = (background: string, surface: string, text: string, muted: string, heading: string, accent: string, accent2: string, accent3: string, line: string) =>
  ({ background, surface, text, muted, heading, accent, accent2, accent3, line }) as Palette;

export const SLIDE_THEMES: SlideTheme[] = [
  {
    id: "simple", name: msg("Simple"), heading: "inter", body: "inter",
    light: palette("#ffffff", "#f3f4f6", "#1f2328", "#6b7280", "#111827", "#2563eb", "#f59e0b", "#10b981", "#d1d5db"),
    dark: palette("#111318", "#1e2129", "#e6e8ee", "#9aa1ad", "#ffffff", "#60a5fa", "#fbbf24", "#34d399", "#3a3f4b"),
  },
  {
    id: "editorial", name: msg("Editorial"), heading: "playfair", body: "sourceSerif",
    light: palette("#fbf8f3", "#f0ebe1", "#2b2622", "#7a7067", "#1a1512", "#9b2c2c", "#b7791f", "#2c5282", "#d8cfc2"),
    dark: palette("#1a1714", "#26221d", "#ece6dc", "#a89f93", "#fff8ee", "#f08b7c", "#e8b65c", "#8fb3e8", "#403a32"),
  },
  {
    id: "geometric", name: msg("Geometric"), heading: "montserrat", body: "openSans",
    light: palette("#ffffff", "#eef2ff", "#1e1b4b", "#6366a0", "#1e1b4b", "#6d28d9", "#db2777", "#0891b2", "#c7d2fe"),
    dark: palette("#13111f", "#1f1c33", "#e5e3ff", "#a19ecb", "#ffffff", "#a78bfa", "#f472b6", "#22d3ee", "#37335a"),
  },
  {
    id: "grotesk", name: msg("Bold"), heading: "spaceGrotesk", body: "dmSans",
    light: palette("#f7f7f2", "#ebebe3", "#18181b", "#71717a", "#0a0a0a", "#e4572e", "#17bebb", "#ffc914", "#d4d4cc"),
    dark: palette("#0f0f0f", "#1c1c1c", "#ededed", "#a1a1a1", "#ffffff", "#ff7a50", "#2ee6e3", "#ffd54a", "#333333"),
  },
  {
    id: "bookish", name: msg("Warm"), heading: "fraunces", body: "workSans",
    light: palette("#fffdf7", "#f5efe0", "#2d2a24", "#8a8170", "#3b2f1e", "#c2410c", "#4d7c0f", "#0e7490", "#e2d9c3"),
    dark: palette("#1c1a16", "#2a2620", "#efe8d8", "#b0a68f", "#fff4dc", "#fb923c", "#a3e635", "#67e8f9", "#433d32"),
  },
  {
    id: "friendly", name: msg("Friendly"), heading: "nunito", body: "nunito",
    light: palette("#fdfcff", "#f1effa", "#2e2a3b", "#7c7791", "#2e2a3b", "#ec4899", "#8b5cf6", "#14b8a6", "#e0dcef"),
    dark: palette("#18161f", "#24212e", "#ebe8f5", "#a7a2bb", "#ffffff", "#f472b6", "#a78bfa", "#2dd4bf", "#3b3747"),
  },
  {
    id: "tech", name: msg("Tech"), heading: "jetbrainsMono", body: "inter",
    light: palette("#f8fafc", "#e9eef5", "#0f172a", "#64748b", "#0f172a", "#0ea5e9", "#22c55e", "#f43f5e", "#cbd5e1"),
    dark: palette("#0b1120", "#151e32", "#e2e8f0", "#94a3b8", "#f8fafc", "#38bdf8", "#4ade80", "#fb7185", "#1e293b"),
  },
  {
    id: "classic", name: msg("Classic"), heading: "notoSerif", body: "notoSans",
    light: palette("#ffffff", "#f5f5f4", "#292524", "#78716c", "#1c1917", "#0f766e", "#b45309", "#7c3aed", "#d6d3d1"),
    dark: palette("#161514", "#23211f", "#e7e5e4", "#a8a29e", "#fafaf9", "#2dd4bf", "#fbbf24", "#a78bfa", "#3a3633"),
  },
];

export function slideTheme(id: string): SlideTheme {
  return SLIDE_THEMES.find((theme) => theme.id === id) ?? SLIDE_THEMES[0];
}

// 実際に描く色と書体（主題 + 浅色 / 深色）。
export type ResolvedTheme = { theme: SlideTheme; mode: "light" | "dark"; palette: Palette; fonts: Record<FontRole, SlideFont> };
export function resolveTheme(deckTheme: DeckTheme): ResolvedTheme {
  const theme = slideTheme(deckTheme.id);
  return {
    theme, mode: deckTheme.mode, palette: deckTheme.mode === "dark" ? theme.dark : theme.light,
    fonts: { heading: SLIDE_FONTS[theme.heading], body: SLIDE_FONTS[theme.body], mono: SLIDE_FONTS.jetbrainsMono },
  };
}

// 色の参照を #rrggbb にする（主題の色名は配色から引く）。
export function resolveColor(ref: ColorRef | string | null | undefined, theme: ResolvedTheme, fallback: ColorToken = "text"): string {
  if (typeof ref === "string" && /^#[0-9a-f]{6}$/i.test(ref)) return ref;
  if (isColorRef(ref)) return theme.palette[ref as ColorToken];
  return theme.palette[fallback];
}

// 色を選ぶときの見本（主題の色 + よく使う固定色）。
export const PALETTE_TOKENS: ColorToken[] = ["text", "heading", "muted", "accent", "accent2", "accent3", "surface", "background", "line"];
export const FIXED_COLORS = ["#000000", "#ffffff", "#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#64748b"] as const;
