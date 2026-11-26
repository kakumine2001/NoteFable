"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { usePathname } from "next/navigation";
import { isEmbedPath, isUntrackedUrl } from "@/lib/telemetry-filter";

export function Telemetry() {
  // アプリの WebView（/note-embed）では計測のスクリプト自体を読み込まない。
  const pathname = usePathname();
  if (isEmbedPath(pathname ?? "")) return null;
  return (
    <>
      <Analytics beforeSend={(event) => (isUntrackedUrl(event.url) ? null : event)} />
      <SpeedInsights beforeSend={(event) => (isUntrackedUrl(event.url) ? null : event)} />
    </>
  );
}
