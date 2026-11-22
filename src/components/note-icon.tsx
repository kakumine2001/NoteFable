"use client";

import type { ReactNode } from "react";
import { noteIconImageUrl } from "@/lib/note-icon";

// ノートのアイコン。絵文字はそのまま、アップロード画像は所有者確認付きの API から読む <img> にする。
// アイコンがないときは fallback（ファイルのアイコンなど）を出す。imageUrl を渡すと、その URL の画像にする（公開ページ用）。
export function NoteIcon({ icon, fallback = null, imageUrl }: { icon: string | null | undefined; fallback?: ReactNode; imageUrl?: string | null }) {
  if (!icon) return <>{fallback}</>;
  const src = noteIconImageUrl(icon, imageUrl);
  // eslint-disable-next-line @next/next/no-img-element -- 所有者確認付き API から返す private 画像のため next/image の最適化は使わない
  if (src) return <img src={src} alt="" draggable={false} className="note-icon-image" />;
  return <>{icon}</>;
}
