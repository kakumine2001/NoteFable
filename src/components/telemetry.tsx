"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

// 公開共有リンク /s/<token> のトークンが計測ツールへ送られないよう、/s/ 配下のイベントは送信しない。
function isShareUrl(url: string): boolean {
  try {
    return new URL(url).pathname.startsWith("/s/");
  } catch {
    return url.includes("/s/");
  }
}

export function Telemetry() {
  return (
    <>
      <Analytics beforeSend={(event) => (isShareUrl(event.url) ? null : event)} />
      <SpeedInsights beforeSend={(event) => (isShareUrl(event.url) ? null : event)} />
    </>
  );
}
