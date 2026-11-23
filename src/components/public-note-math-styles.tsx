"use client";

import dynamic from "next/dynamic";

// 公開ページの数式用の KaTeX スタイル。数式のあるページでだけ描く（public-note-view.tsx）。
// next/dynamic はサーバー描画の時にこのチャンクの CSS を <head> の stylesheet として出すので、数式は最初から整った形で表示される。
// サブページへの移動（クライアント遷移）では、CSS を読み終えてから新しいページに切り替わる（Suspense の境界を置かない）。
const KatexStylesheet = dynamic(() => import("@/components/katex-stylesheet"));

export function PublicMathStyles() {
  return <KatexStylesheet />;
}
