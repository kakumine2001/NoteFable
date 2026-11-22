"use client";

import type { ReactNode } from "react";
import { noteIconImageUrl } from "@/lib/note-icon";

// ノートのアイコン。絵文字はそのまま、アップロード画像は所有者確認付きの API から読む <img> にする。
// アイコンがないときは fallback（ファイルのアイコンなど）を出す。imageUrl を渡すと、その URL の画像にする（公開ページ用）。
// 公開ページでは、所有者 ID を含む画像のキーを渡さず、imageUrl（共有用の URL）だけを渡す（icon は絵文字か null）。
export function NoteIcon({ icon, fallback = null, imageUrl }: { icon: string | null | undefined; fallback?: ReactNode; imageUrl?: string | null }) {
  const src = imageUrl ?? noteIconImageUrl(icon);
  // eslint-disable-next-line @next/next/no-img-element -- 所有者確認付き API から返す private 画像のため next/image の最適化は使わない
  if (src) return <img src={src} alt="" draggable={false} loading="lazy" decoding="async" className="note-icon-image" />;
  if (!icon) return <>{fallback}</>;
  return <>{icon}</>;
}
