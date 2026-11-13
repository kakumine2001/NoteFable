import { useEffect, useState } from "react";

// 「5 min ago」のような相対時刻を、開いたままでも進めるための現在時刻。intervalMs ごとに描き直す。
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
