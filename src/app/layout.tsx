import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./motion.css";
import { Telemetry } from "@/components/telemetry";
import { siteOrigin } from "@/lib/i18n/routing";
import { ThemeSync } from "@/components/theme-sync";
import { THEME_INIT_SCRIPT } from "@/lib/theme-init";

// UI 用の可変フォント。CSS 変数として Tailwind 側から参照する。
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// コードブロック用の等幅フォント。Markdown の pre/code 表示で使う。
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // canonical・hreflang などの URL を絶対 URL にする土台（Google は hreflang に絶対 URL を求める）。本番は Vercel が渡す URL。
  metadataBase: new URL(siteOrigin()),
  // ブラウザタブや検索結果で使われるアプリ名。
  title: "NoteFable",
  // Next.js の Metadata API へ渡すページ説明。
  description: "A personal space for AI conversations, notes, and ideas.",
};

// モバイルのキーボード表示時も本文の表示領域を追従させる。
export const viewport: Viewport = { width: "device-width", initialScale: 1, interactiveWidget: "resizes-content" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 表示言語は proxy.ts と [locale]/layout.tsx が決める。ここで Cookie を読むと全ページが動的になるため読まない。
  // html にフォント変数クラスを付け、全ページで同じフォント設定を使えるようにする。
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}<ThemeSync /><Telemetry /></body>
    </html>
  );
}
