"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { isUntrackedUrl } from "@/lib/telemetry-filter";

export function Telemetry() {
  return (
    <>
      <Analytics beforeSend={(event) => (isUntrackedUrl(event.url) ? null : event)} />
      <SpeedInsights beforeSend={(event) => (isUntrackedUrl(event.url) ? null : event)} />
    </>
  );
}
