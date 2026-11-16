"use client";

import { AppErrorScreen } from "@/components/app-error-screen";

// 紹介ページと /app の描画が例外で止まったとき、画面全体を落とさずにこの画面を出す（言語は [locale]/layout の辞書を使う）。
export default function LocaleError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <AppErrorScreen error={error} retry={unstable_retry} />;
}
