import { msg } from "@/lib/i18n/translate";

// Notes のホーム（パソコン幅）に出す文字と並びの計算。

// 「最近編集したノート」に出す件数。
const RECENT_COUNT = 8;

// 時刻に合わせたあいさつ（5〜11 時は朝、12〜17 時は昼、それ以外は夜）。
export function greetingFor(hour: number) {
  return hour >= 5 && hour < 12 ? msg("Good morning") : hour >= 12 && hour < 18 ? msg("Good afternoon") : msg("Good evening");
}

// 最後に編集した順に、先頭の数件。
export function recentPages<T extends { updatedAt: string }>(pages: readonly T[]): T[] {
  return [...pages].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, RECENT_COUNT);
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];

// 「3 時間前」のような相対時刻。1 分未満は「今」に当たる表現になる。
export function relativeTime(iso: string, now: number, format: Intl.RelativeTimeFormat) {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  for (const [unit, size] of UNITS) if (Math.abs(seconds) >= size) return format.format(Math.trunc(seconds / size), unit);
  return format.format(0, "minute");
}
