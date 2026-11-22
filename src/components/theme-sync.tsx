"use client";

import { useTheme } from "@/lib/theme";

// どのページでも、OS の配色や別のタブでの選び直しにその場で追従する。
// useTheme を使う部品（ヘルプメニューなど）が画面に無い間も、購読を切らさないために置く。何も描かない。
export function ThemeSync() {
  useTheme();
  return null;
}
