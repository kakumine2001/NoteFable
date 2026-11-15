"use client";

import { useCallback, useState } from "react";

// サイドバーとスマホのホームで、開いているサブページの木（ページ ID → true）。端末に覚えておき、両方の画面で共有する。
const EXPANDED_KEY = "notefable:note-pages-expanded:v1";

function read(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "{}"); } catch { return {}; }
}

export function useExpandedPages() {
  // この部品は Notes に切り替えた後にだけ作られるので、初期値で読んでもサーバー描画とずれない。
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => typeof window === "undefined" ? {} : read());
  const toggle = useCallback((id: string, open: boolean) => {
    setExpanded((current) => {
      const next = { ...current };
      if (open) next[id] = true; else delete next[id];
      try { localStorage.setItem(EXPANDED_KEY, JSON.stringify(next)); } catch { /* 保存できなくても動作は変えない。 */ }
      return next;
    });
  }, []);
  const expand = useCallback((id: string) => toggle(id, true), [toggle]);
  return [expanded, toggle, expand] as const;
}
