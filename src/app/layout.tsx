import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

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
  // ブラウザタブや検索結果で使われるアプリ名。
  title: "StudyMate",
  // Next.js の Metadata API へ渡すページ説明。
  description: "AI study assistant powered by OpenAI.",
  // Render などの古い favicon キャッシュを拾いにくくするため、使うアイコンを明示する。
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml", sizes: "any" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // html にフォント変数クラスを付け、全ページで同じフォント設定を使えるようにする。
  return (
    <html lang="zh-CN" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
